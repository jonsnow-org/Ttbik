"""
Sham — checkpoint save/load. A checkpoint that is just a raw
state_dict is a real, well-documented trap for exactly the "grow this
later" future the owner wants: load it back in six months, at a bigger
config, from a different script, and nothing on disk says what shape
it was trained at, what step it reached, or what optimizer state goes
with it — a Kaggle session that produces such a file is one bad guess
away from being unusable.

Every checkpoint this module writes is self-describing: it carries its
own ShamSmallConfig (via ShamSmallConfig.to_dict(), added in model.py
specifically for this), the training step, and (optionally) optimizer
state, all in one file loadable without any other context. This is
also the file format expand_model.py reads from and writes to when
growing a trained small checkpoint into a larger config.
"""

from dataclasses import dataclass
from pathlib import Path

import torch

from model import ShamSmall, ShamSmallConfig


@dataclass
class CheckpointMetadata:
    step: int
    config: dict


def save_checkpoint(
    path: str | Path,
    model: ShamSmall,
    step: int,
    optimizer: torch.optim.Optimizer | None = None,
    extra: dict | None = None,
) -> None:
    """Writes one self-contained file: the model's own config (so a
    future load never has to guess d_model/n_layers/vocab_size/etc.),
    its weights, the training step reached, and — when given, since
    resuming training without it silently restarts the optimizer's
    momentum/Adam moment estimates from zero, a real, documented cause
    of a training-loss spike right after resuming — the optimizer
    state too."""
    payload = {
        "config": model.cfg.to_dict(),
        "step": step,
        "model_state_dict": model.state_dict(),
    }
    if optimizer is not None:
        payload["optimizer_state_dict"] = optimizer.state_dict()
    if extra:
        payload["extra"] = extra

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # NOTE (2026-09-16): this used to write to a temp file and rename()
    # atomically -- safe on a real local disk, but a real, confirmed
    # incident on a Google-Drive-mounted checkpoint_dir: Drive's FUSE
    # mount does not reliably honor rename() for large (>1GB) files --
    # tmp_path.replace(path) returned with no exception, "saved
    # checkpoint" printed, and the destination file never actually
    # existed afterward (every checkpoint silently vanishing). Writing
    # directly to the final path avoids the broken rename; the
    # existence+size check below turns any future silent write failure
    # into a loud, catchable error instead of hours of lost training
    # discovered only when trying to resume.
    torch.save(payload, path)
    if not path.exists() or path.stat().st_size == 0:
        raise IOError(f"checkpoint write to {path} did not take effect (Drive sync issue?)")


def load_checkpoint(
    path: str | Path,
    map_location: str | torch.device = "cpu",
    load_optimizer_into: torch.optim.Optimizer | None = None,
) -> tuple[ShamSmall, int, dict]:
    """The inverse of save_checkpoint(): rebuilds the model at EXACTLY
    the config it was saved with (never the caller's possibly-stale
    idea of what config to use), loads its weights, and returns
    (model, step, extra). Pass load_optimizer_into=<an optimizer built
    for this same model> to also resume its state."""
    payload = torch.load(path, map_location=map_location, weights_only=False)

    cfg = ShamSmallConfig.from_dict(payload["config"])
    model = ShamSmall(cfg)
    model.load_state_dict(payload["model_state_dict"])
    model.to(map_location)

    if load_optimizer_into is not None:
        if "optimizer_state_dict" not in payload:
            raise ValueError(f"checkpoint at {path} has no optimizer state to load")
        load_optimizer_into.load_state_dict(payload["optimizer_state_dict"])

    return model, payload["step"], payload.get("extra", {})


if __name__ == "__main__":
    import tempfile

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=256, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64)
    model = ShamSmall(cfg)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)

    # Take one real optimizer step so its internal Adam moment buffers
    # are non-trivial — otherwise a bug that dropped the optimizer
    # state entirely would still "round-trip" a set of all-zero buffers
    # and this test would pass for the wrong reason.
    dummy_input = torch.randint(0, cfg.vocab_size, (2, 8))
    _, loss = model(dummy_input, labels=dummy_input)
    loss.backward()
    optimizer.step()
    optimizer.zero_grad()

    with tempfile.TemporaryDirectory() as tmpdir:
        ckpt_path = Path(tmpdir) / "step_100.pt"
        save_checkpoint(ckpt_path, model, step=100, optimizer=optimizer, extra={"note": "smoke test"})
        assert ckpt_path.exists() and not ckpt_path.with_suffix(".pt.tmp").exists(), (
            "checkpoint save did not land at the final path (or left a stray .tmp file behind)"
        )

        loaded_model, loaded_step, loaded_extra = load_checkpoint(ckpt_path)
        assert loaded_step == 100, f"step did not round-trip: {loaded_step}"
        assert loaded_extra == {"note": "smoke test"}, f"extra metadata did not round-trip: {loaded_extra}"
        assert loaded_model.cfg == cfg, "config did not round-trip through the checkpoint"
        for (name, p_orig), (_, p_loaded) in zip(model.named_parameters(), loaded_model.named_parameters()):
            assert torch.equal(p_orig, p_loaded), f"weight mismatch after load: {name}"
        print(f"save/load OK: config, step ({loaded_step}), weights, and extra metadata all round-tripped exactly.")

        fresh_optimizer = torch.optim.AdamW(loaded_model.parameters(), lr=1e-3)
        _, loaded_step2, _ = load_checkpoint(ckpt_path, load_optimizer_into=fresh_optimizer)
        orig_state = optimizer.state_dict()["state"]
        loaded_state = fresh_optimizer.state_dict()["state"]
        assert len(orig_state) == len(loaded_state) and len(orig_state) > 0, "optimizer state did not round-trip"
        for key in orig_state:
            assert torch.equal(orig_state[key]["exp_avg"], loaded_state[key]["exp_avg"]), (
                f"optimizer Adam moment buffer mismatch for param group {key} — resuming training "
                f"would silently restart momentum from zero"
            )
        print("optimizer state OK: real Adam moment buffers (not just zeros) round-tripped exactly.")

    print("\nAll checkpoint checks passed — a saved checkpoint is genuinely self-describing and resumable.")
