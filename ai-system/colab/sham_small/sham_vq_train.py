"""
Sham — a real trainer for the image tokenizer (and, through the same loop, any VQ model with encoder / quantizer / decoder submodules).

Why a new trainer (found by reading train_vqvae and measuring the shipped checkpoints, 2026-10-11): the old loop loads EVERY image into memory,
trains a fixed number of epochs on whatever ~90 images a run collected, starts the codebook at ±1/8192 (so the encoder's outputs sit far from
every code and only a few codes are ever picked: 180-723 of 8192 used), never revives a code that died, and has no learning-rate schedule or
mixed precision. Everything here works on the SAME ImageTokenizer class and checkpoint format, so no existing file changes meaning.

  train_stream(tokenizer, manifest, minutes, batch_size, ...)  -> StreamStats
      * images are decoded lazily from the manifest by DataLoader workers (any number of images, constant memory)
      * codebook initialised from real encoder outputs (data-dependent init), dead codes re-seeded from the current batch (EMA usage)
      * the encoder/decoder run under autocast (bf16/fp16 on a GPU), the quantizer's distance search stays float32
      * warm-up + cosine learning-rate decay over the time budget, gradient clipping, a real step counter (optimizer steps, not epochs)
      * res_mix={64: .55, 128: .30, 256: .15}: each step trains at ONE size drawn from the mix (the batch is average-pooled down). The tokenizer
        is fully convolutional, so the SAME weights encode a 256px image as 16x16 = 256 tokens, 128px as 8x8 = 64, 64px as 4x4 = 16: a CPU
        spends most steps on cheap small pictures and a few on the full size, and the full-size ability and the 38.9M capacity are kept
        (owner, 2026-10-11: never go smaller). Video frames can use the 64-token size: four times as many frames in the same window.
        multires=p is the two-size shortcut (half size with probability p)
      * stops at the time budget, so a Kaggle session spends all of it training

Offline self-test: `python sham_vq_train.py` — compares this loop against train_vqvae on a synthetic structured set (same steps): codebook use
and reconstruction must both be better, or the self-test fails.
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import torch
import torch.nn.functional as F


@dataclass
class StreamStats:
    steps: int = 0
    samples: int = 0
    seconds: float = 0.0
    losses: list[float] = field(default_factory=list)       # one value per `log_every` steps
    recon: list[float] = field(default_factory=list)
    codebook_usage: int = 0
    codebook_size: int = 0
    perplexity: float = 0.0
    restarts: int = 0

    def summary(self) -> str:
        first = self.recon[0] if self.recon else float("nan")
        last = self.recon[-1] if self.recon else float("nan")
        return (f"{self.steps:,} خطوة، {self.samples:,} عيّنة، {self.seconds / 60:.1f} د | إعادة البناء {first:.4f}→{last:.4f} | "
                f"القاموس {self.codebook_usage}/{self.codebook_size} (تنوّع {self.perplexity:.0f}) | رموز أُحييت {self.restarts:,}")


class ManifestImages(torch.utils.data.Dataset):
    """Records of manifest.jsonl ({"image": path, ...}) -> float tensor (3, S, S) in [-1, 1]. A broken file yields another record."""

    def __init__(self, manifest: str | Path, size: int):
        self.size = size
        self.paths: list[str] = []
        root = Path(manifest).parent
        for line in Path(manifest).read_text(encoding="utf-8").splitlines():
            if line.strip():
                rec = json.loads(line)
                if isinstance(rec.get("image"), str):
                    self.paths.append(str((root / rec["image"])))

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, i: int) -> torch.Tensor:
        from sham_media_load import load_image_any
        for k in range(8):
            try:
                return load_image_any(self.paths[(i + k) % len(self.paths)], self.size)     # any format/mode/aspect; a broken file moves on
            except Exception:
                continue
        return torch.zeros(3, self.size, self.size)


class ManifestAudio(torch.utils.data.Dataset):
    """Records of manifest.jsonl ({"audio": path, ...}) -> one RANDOM segment (1, n_mels, segment_frames) of the clip. Every consecutive segment
    of a clip can come up (waveform_to_mel_segments), not just the center crop the old loader kept."""

    def __init__(self, manifest: str | Path, n_mels: int, segment_frames: int, max_segments: int = 12):
        self.n_mels, self.segment_frames, self.max_segments = n_mels, segment_frames, max_segments
        self.paths: list[str] = []
        root = Path(manifest).parent
        for line in Path(manifest).read_text(encoding="utf-8").splitlines():
            if line.strip():
                rec = json.loads(line)
                if isinstance(rec.get("audio"), str):
                    self.paths.append(str(root / rec["audio"]))

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, i: int) -> torch.Tensor:
        import random

        from mel_spectrogram import waveform_to_mel_segments
        from sham_media_load import load_audio_any
        for k in range(8):
            try:
                wave = load_audio_any(self.paths[(i + k) % len(self.paths)])      # any format, any rate -> mono 16 kHz
                if wave is None or wave.size < 1600:
                    continue
                mels = waveform_to_mel_segments(torch.from_numpy(wave), 16000, self.n_mels, self.segment_frames, self.max_segments)
                return mels[random.randrange(mels.shape[0])]
            except Exception:
                continue
        return torch.zeros(1, self.n_mels, self.segment_frames)


def _forward(tok, x: torch.Tensor, amp_dtype, frozen_front: bool = False):
    """Same maths as ImageTokenizer.forward, with the quantizer's distance search in float32 under autocast.
    frozen_front: the encoder and the codebook are not trained (decoder-only refinement): the codes are computed without gradients and the loss is the
    reconstruction alone."""
    dev = x.device.type
    if frozen_front:
        with torch.no_grad():
            z = tok.encoder(x)
            quantized, ids, _vq = tok.quantizer(z.float())
        rec = tok.decoder(quantized.detach())
        recon = F.mse_loss(rec.float(), x)
        return recon, recon, ids, z
    with torch.autocast(device_type=dev, dtype=amp_dtype, enabled=amp_dtype is not None):
        z = tok.encoder(x)
    with torch.autocast(device_type=dev, enabled=False):
        quantized, ids, vq_loss = tok.quantizer(z.float())
    with torch.autocast(device_type=dev, dtype=amp_dtype, enabled=amp_dtype is not None):
        rec = tok.decoder(quantized)
    recon = F.mse_loss(rec.float(), x)
    return recon + vq_loss, recon, ids, z


@torch.no_grad()
def init_codebook_from_data(tok, batches: list[torch.Tensor]) -> None:
    """Codebook := real encoder outputs (random rows), so every code starts where the encoder actually puts its features."""
    tok.train(False)
    zs = []
    for x in batches:
        z = tok.encoder(x)
        zs.append(z.permute(0, 2, 3, 1).reshape(-1, z.shape[1]).float())
    zf = torch.cat(zs)
    n = tok.quantizer.num_codes
    idx = torch.randint(0, zf.shape[0], (n,))
    cb = zf[idx] + 0.01 * zf.std() * torch.randn(n, zf.shape[1])
    tok.quantizer.codebook.weight.copy_(cb)
    tok.train()


@torch.no_grad()
def revive_dead_codes(tok, ema_usage: torch.Tensor, z: torch.Tensor, threshold: float) -> int:
    dead = (ema_usage < threshold).nonzero(as_tuple=True)[0]
    if dead.numel() == 0:
        return 0
    zf = z.permute(0, 2, 3, 1).reshape(-1, z.shape[1]).float().detach()
    pick = zf[torch.randint(0, zf.shape[0], (dead.numel(),), device=zf.device)]
    tok.quantizer.codebook.weight[dead] = pick + 0.01 * zf.std() * torch.randn_like(pick)
    ema_usage[dead] = threshold * 4        # a revived code gets a grace period before it can be called dead again
    return int(dead.numel())


def train_stream(tok, manifest: str | Path, minutes: float, batch_size: int = 16, lr: float = 3e-4, device: str | None = None,
                 workers: int = 2, warmup: int = 100, restart_every: int = 100, log_every: int = 50, max_steps: int | None = None,
                 init_batches: int = 4, size: int | None = None, kind: str = "image", multires: float = 0.0,
                 res_mix: dict[int, float] | None = None, decoder_only: bool = False) -> StreamStats:
    """decoder_only=True (2026-10-17): train ONLY the decoder. The encoder and the codebook stay exactly as they are, so every image / sound is still
    turned into the SAME token ids — everything the language model learned about those ids stays valid — while the pictures / sounds the decoder
    writes from them get better. Measured by reconstruction error before and after (sham_decoder_refine.py), never adopted unless better."""
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    if kind == "audio":
        ds = ManifestAudio(manifest, tok.cfg.n_mels, tok.cfg.segment_frames)
    else:
        ds = ManifestImages(manifest, size or tok.cfg.image_size)
    assert len(ds) > 0, "empty manifest"
    amp = None
    if device == "cuda":
        amp = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=(amp == torch.float16))
    tok.to(device).train()
    if decoder_only:
        tok.encoder.train(False)
        tok.quantizer.train(False)
        for part in (tok.encoder, tok.quantizer):
            for prm in part.parameters():
                prm.requires_grad_(False)
    loader = torch.utils.data.DataLoader(ds, batch_size=batch_size, shuffle=True, num_workers=workers, drop_last=len(ds) >= batch_size,
                                         persistent_workers=workers > 0)
    opt = torch.optim.AdamW([q for q in tok.parameters() if q.requires_grad], lr=lr, betas=(0.9, 0.95), weight_decay=0.0)
    n_codes = tok.quantizer.num_codes
    stats = StreamStats(codebook_size=n_codes)
    last_used = torch.zeros(n_codes, device=device)       # step at which each code was last picked (a code idle for a whole restart window is dead)
    budget = minutes * 60.0
    t0 = time.time()
    it = iter(loader)

    def next_batch():
        nonlocal it
        try:
            return next(it)
        except StopIteration:
            it = iter(loader)
            return next(it)

    # data-dependent init only for a codebook that is still (nearly) the untouched uniform init
    if not decoder_only and float(tok.quantizer.codebook.weight.detach().abs().max()) < 0.01:
        init_codebook_from_data(tok, [next_batch().to(device) for _ in range(init_batches)])
    run_recon, run_loss, window = 0.0, 0.0, 0
    last_ids = []
    step = 0
    while True:
        elapsed = time.time() - t0
        if elapsed >= budget or (max_steps is not None and step >= max_steps):
            break
        progress = elapsed / budget if max_steps is None else step / max_steps
        cur = lr * min(1.0, (step + 1) / warmup) * (0.5 * (1 + math.cos(math.pi * min(progress, 1.0))) * 0.9 + 0.1)
        for g in opt.param_groups:
            g["lr"] = cur
        x = next_batch().to(device, non_blocking=True)
        if kind == "image":
            mix = res_mix or ({x.shape[-1] // 2: multires, x.shape[-1]: 1.0 - multires} if multires > 0 else None)
            if mix:                                           # one size per step, drawn from the mix (the weights are size-agnostic)
                sizes, probs = zip(*sorted(mix.items()))
                pick = sizes[int(torch.multinomial(torch.tensor(probs, dtype=torch.float), 1))]
                if pick < x.shape[-1] and x.shape[-1] % pick == 0:
                    x = F.avg_pool2d(x, x.shape[-1] // pick)
        loss, recon, ids, z = _forward(tok, x, amp, frozen_front=decoder_only)
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_([q for q in tok.parameters() if q.requires_grad], 1.0)
        scaler.step(opt)
        scaler.update()
        step += 1
        stats.samples += x.shape[0]
        counts = torch.bincount(ids.flatten(), minlength=n_codes).float()
        last_used[counts > 0] = step
        last_ids.append(ids.detach().flatten().cpu())
        if len(last_ids) > 20:
            last_ids.pop(0)
        if step % restart_every == 0 and not decoder_only:
            # measured on the CPU run (2026-10-11): an EMA that starts at 1 never fell below the threshold inside a 150-step chunk, so
            # only 313 of 8192 codes were ever used and none was revived. Idle for a whole window = dead, whatever the chunk length.
            alive = (step - last_used < restart_every).float()
            n_dead = revive_dead_codes(tok, alive, z.detach(), threshold=0.5)
            last_used[alive > 1.5] = step                  # revived codes (marked 2.0 by the function) start a fresh window
            stats.restarts += n_dead
        run_recon += float(recon.detach())
        run_loss += float(loss.detach())
        window += 1
        if step % log_every == 0:
            stats.recon.append(run_recon / window)
            stats.losses.append(run_loss / window)
            print(f"  خطوة {step:,}: إعادة البناء {stats.recon[-1]:.4f} | خسارة كلية {stats.losses[-1]:.4f} | lr {cur:.2e} | "
                  f"{stats.samples / max(time.time() - t0, 1e-9):.1f} صورة/ث", flush=True)
            run_recon = run_loss = 0.0
            window = 0
    if window:
        stats.recon.append(run_recon / window)
        stats.losses.append(run_loss / window)
    stats.steps, stats.seconds = step, time.time() - t0
    if last_ids:
        flat = torch.cat(last_ids)
        probs = torch.bincount(flat, minlength=n_codes).float()
        stats.codebook_usage = int((probs > 0).sum())
        p = probs[probs > 0] / probs.sum()
        stats.perplexity = float(torch.exp(-(p * p.log()).sum()))
    tok.to("cpu")
    return stats


if __name__ == "__main__":
    import tempfile

    from PIL import Image

    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from train_image_tokenizer import make_synthetic_image_dataset, train_vqvae

    torch.manual_seed(0)
    cfg = ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2), code_dim=16, num_codes=256)
    # a RICH set: smooth random fields (every 4x4 patch is different), so using more of the codebook really lowers the error
    g = torch.Generator().manual_seed(1)
    low = torch.randn(512, 3, 8, 8, generator=g)
    data = torch.nn.functional.interpolate(low, size=32, mode="bicubic", align_corners=False).clamp(-2, 2) / 2
    train, held = data[:384], data[384:]

    # the old loop: same architecture, same number of optimizer steps
    old = ImageTokenizer(cfg)
    bs, steps = 16, 480
    epochs = steps // (384 // bs)
    s_old = train_vqvae(old, train.clone(), num_epochs=epochs, batch_size=bs, log_every=999)
    with torch.no_grad():
        old.train(False)
        rec_old = float(((old.decode(old.encode(held)) - held) ** 2).mean())

    # the new loop on the same data written as image files + a manifest
    with tempfile.TemporaryDirectory() as d:
        for i in range(384):
            arr = ((train[i].permute(1, 2, 0).numpy() + 1) * 127.5).clip(0, 255).astype("uint8")
            Image.fromarray(arr).save(Path(d) / f"{i}.png")
        Path(d, "manifest.jsonl").write_text("\n".join(json.dumps({"image": f"{i}.png", "caption": "x"}) for i in range(384)), encoding="utf-8")
        new = ImageTokenizer(cfg)
        s_new = train_stream(new, Path(d) / "manifest.jsonl", minutes=10, batch_size=bs, max_steps=steps, workers=0, warmup=10,
                             restart_every=20, log_every=160)
        with torch.no_grad():
            new.train(False)
            rec_new = float(((new.decode(new.encode(held)) - held) ** 2).mean())
    print(f"قديم: استعمال {s_old.final_codebook_usage}/{cfg.num_codes} | إعادة بناء {rec_old:.4f}")
    print(f"جديد: {s_new.summary()} | إعادة بناء على صور لم تُدرَّب {rec_new:.4f}")
    assert s_new.steps == steps and s_new.samples == steps * bs
    assert s_new.codebook_usage > s_old.final_codebook_usage, "the new loop must use more of the codebook"
    assert rec_new < rec_old, "the new loop must reconstruct better at equal steps"
    assert s_new.recon[-1] < s_new.recon[0], "loss must go down"

    # decoder-only refinement: the codes of every image stay IDENTICAL, the reconstruction gets better
    with tempfile.TemporaryDirectory() as d:
        for i in range(96):
            arr = ((train[i].permute(1, 2, 0).numpy() + 1) * 127.5).clip(0, 255).astype("uint8")
            Image.fromarray(arr).save(Path(d) / f"{i}.png")
        Path(d, "manifest.jsonl").write_text("\n".join(json.dumps({"image": f"{i}.png", "caption": "x"}) for i in range(96)), encoding="utf-8")
        dec = ImageTokenizer(cfg)
        train_stream(dec, Path(d) / "manifest.jsonl", minutes=5, batch_size=16, max_steps=20, workers=0, warmup=5, restart_every=20, log_every=20)
        with torch.no_grad():
            dec.train(False)
            ids0 = dec.encode(held)
            rec0 = float(((dec.decode(ids0) - held) ** 2).mean())
        before = {k: v.clone() for k, v in dec.state_dict().items() if k.startswith(("encoder", "quantizer"))}
        r_stats = train_stream(dec, Path(d) / "manifest.jsonl", minutes=5, batch_size=16, max_steps=120, workers=0, warmup=5, log_every=40,
                               decoder_only=True)
        with torch.no_grad():
            dec.train(False)
            ids1 = dec.encode(held)
            rec1 = float(((dec.decode(ids1) - held) ** 2).mean())
        assert torch.equal(ids0, ids1), "decoder-only refinement must not change a single code"
        assert all(torch.equal(before[k], v) for k, v in dec.state_dict().items() if k in before), "encoder / codebook must stay bit-identical"
        assert r_stats.steps == 120 and rec1 < rec0, (rec0, rec1)
        print(f"فكّ فقط: إعادة البناء {rec0:.4f} → {rec1:.4f}، الرموز لم تتغيّر")

    # multires: the same tokenizer trained on both sizes encodes 32px and 16px inputs (grids 8x8 and 4x4 for the 2-stage toy)
    with tempfile.TemporaryDirectory() as d:
        for i in range(64):
            arr = ((train[i].permute(1, 2, 0).numpy() + 1) * 127.5).clip(0, 255).astype("uint8")
            Image.fromarray(arr).save(Path(d) / f"{i}.png")
        Path(d, "manifest.jsonl").write_text("\n".join(json.dumps({"image": f"{i}.png", "caption": "x"}) for i in range(64)), encoding="utf-8")
        mr = ImageTokenizer(cfg)
        m_stats = train_stream(mr, Path(d) / "manifest.jsonl", minutes=5, batch_size=8, max_steps=40, workers=0, warmup=5, restart_every=20,
                               log_every=20, res_mix={16: 0.5, 32: 0.5})
        with torch.no_grad():
            mr.train(False)
            assert mr.encode(train[:2]).shape[-1] == 8 and mr.encode(torch.nn.functional.avg_pool2d(train[:2], 2)).shape[-1] == 4
        assert m_stats.steps == 40
    # the same loop on audio segments: runs, loss goes down, and a long clip yields several different segments
    import numpy as np
    import soundfile as sf

    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
    acfg = AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=8, channel_multipliers=(1, 2), code_dim=8, num_codes=64)
    with tempfile.TemporaryDirectory() as d:
        sr = 16000
        for i in range(24):
            t = np.arange(sr * 4) / sr
            sf.write(str(Path(d) / f"{i}.wav"), (0.3 * np.sin(2 * np.pi * (150 + 40 * i) * t) * (1 + np.sin(t * (i + 1)))).astype("float32"), sr)
        Path(d, "manifest.jsonl").write_text("\n".join(json.dumps({"audio": f"{i}.wav", "sentence": "x"}) for i in range(24)), encoding="utf-8")
        ds = ManifestAudio(Path(d) / "manifest.jsonl", 16, 32)
        segs = {round(float(ds[0].mean()), 5) for _ in range(30)}
        assert len(segs) > 1, "a long clip must yield different segments"
        atok = AudioTokenizer(acfg)
        a_stats = train_stream(atok, Path(d) / "manifest.jsonl", minutes=5, batch_size=8, max_steps=60, workers=0, warmup=5, restart_every=20,
                               log_every=20, kind="audio")
        assert a_stats.steps == 60 and a_stats.recon[-1] < a_stats.recon[0], a_stats.recon
    print("sham_vq_train self-test OK")
