"""
Sham's codebook-revival training for the image/audio tokenizers
("إحياء القاموس") — the fix for gray/pink images, texture-only video and
chirping audio.

Diagnosis (from the owner's live bot): every image, whatever the prompt, is
the same flat texture. The tokenizers are vanilla VQ-VAEs whose 8,192-entry
(image) / 2,048-entry (audio) codebooks start as tiny random vectors near zero
(uniform ±1/num_codes) with nothing to revive codes that never win the
nearest-neighbour match. That setup is well known to COLLAPSE: a handful of
codes win every patch, only they get trained, and the vocabulary Sham's brain
speaks in shrinks to a few "average colour" tokens. Then no amount of training
of the main model can produce a real picture — there are no words for one.

This trainer keeps the tokenizer classes, file format and every shape exactly
as they are (image_tokenizer.py / audio_tokenizer.py are untouched; the model,
serve.py and tokenizer_select see no difference) and changes only HOW they are
trained:
  1. Data-driven codebook start: codes are initialised from real encoder
     outputs of real images/sounds (not ±1e-4 noise), so every code starts
     somewhere the data actually lives.
  2. Dead-code revival: every `revive_every` steps, codes that were not chosen
     in that window are moved onto randomly chosen current encoder outputs —
     the vocabulary keeps being fully used instead of shrinking.
  3. Sharper reconstruction: L1 + MSE + an edge (image-gradient) term, so the
     decoder learns edges and textures instead of the blurry average MSE
     alone rewards.
It returns the same TrainStats as the original trainers, so notebooks only
swap which function they call.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F


def _latents(tokenizer, x: torch.Tensor) -> torch.Tensor:
    z = tokenizer.encoder(x)
    return z.permute(0, 2, 3, 1).reshape(-1, z.shape[1])


@torch.no_grad()
def data_init_codebook(tokenizer, data: torch.Tensor, device: str, batch_size: int = 32) -> None:
    cb = tokenizer.quantizer.codebook.weight
    zs, need = [], cb.shape[0]
    for s in range(0, data.shape[0], batch_size):
        zs.append(_latents(tokenizer, data[s:s + batch_size].to(device)))
        if sum(z.shape[0] for z in zs) >= need * 2:
            break
    z = torch.cat(zs)
    idx = torch.randint(0, z.shape[0], (need,), device=z.device)
    cb.copy_(z[idx] + 0.01 * z.std() * torch.randn_like(z[idx]))


def _edge_loss(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    loss = 0.0
    for dim in (-1, -2):
        loss = loss + F.l1_loss(torch.diff(a, dim=dim), torch.diff(b, dim=dim))
    return loss


def train_vq_revive(
    tokenizer,
    data: torch.Tensor,
    num_epochs: int,
    batch_size: int,
    lr: float = 3e-4,
    device: str | None = None,
    log_every: int = 1,
    revive_every: int = 50,
    fresh_codebook: bool | None = None,
    time_limit_seconds: float | None = None,
):
    """data: images (N, 3, H, W) in [-1, 1] or mels (N, 1, n_mels, T).
    fresh_codebook=None → re-initialise from data only if the codebook looks
    collapsed (under 10% of codes used on this data)."""
    import time
    from train_image_tokenizer import TrainStats

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer.to(device).train()
    num_codes = tokenizer.quantizer.codebook.weight.shape[0]

    usage_before = codebook_usage(tokenizer, data[:512], device)
    # Too few samples (e.g. a notebook's 8-image speed calibration) can't seed a
    # whole vocabulary; the real training call right after does it.
    enough = data.shape[0] >= 256
    collapsed = usage_before < 0.10 * num_codes or is_collapsed(tokenizer)
    if enough and (fresh_codebook or (fresh_codebook is None and collapsed)):
        data_init_codebook(tokenizer, data, device)
        print(f"  القاموس منهار أو جديد ({usage_before}/{num_codes} رمز مستخدم) — أُعيد بناؤه من بيانات حقيقية.")

    opt = torch.optim.AdamW(tokenizer.parameters(), lr=lr)
    counts = torch.zeros(num_codes, device=device)
    epoch_losses, step, t0 = [], 0, time.time()
    last_ids = []
    for epoch in range(num_epochs):
        perm = torch.randperm(data.shape[0])
        total = 0.0
        for s in range(0, data.shape[0], batch_size):
            x = data[perm[s:s + batch_size]].to(device)
            z = tokenizer.encoder(x)
            quantized, ids, vq_loss = tokenizer.quantizer(z)
            rec = tokenizer.decoder(quantized)
            loss = F.l1_loss(rec, x) + F.mse_loss(rec, x) + 0.5 * _edge_loss(rec, x) + vq_loss
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss.detach()) * x.shape[0]
            counts += torch.bincount(ids.reshape(-1), minlength=num_codes).float()
            if epoch == num_epochs - 1:
                last_ids.append(ids.detach().reshape(-1))
            step += 1
            if step % revive_every == 0:
                with torch.no_grad():
                    dead = (counts == 0).nonzero().squeeze(1)
                    if dead.numel():
                        zf = z.detach().permute(0, 2, 3, 1).reshape(-1, z.shape[1])
                        pick = torch.randint(0, zf.shape[0], (dead.numel(),), device=device)
                        tokenizer.quantizer.codebook.weight[dead] = zf[pick] + 0.01 * zf.std() * torch.randn_like(zf[pick])
                counts.zero_()
            if time_limit_seconds and time.time() - t0 > time_limit_seconds:
                break
        epoch_losses.append(total / data.shape[0])
        if epoch % log_every == 0 or epoch == num_epochs - 1:
            print(f"  epoch {epoch + 1}/{num_epochs}: loss {epoch_losses[-1]:.4f}")
        if time_limit_seconds and time.time() - t0 > time_limit_seconds:
            break
    usage = int(torch.unique(torch.cat(last_ids)).numel()) if last_ids else codebook_usage(tokenizer, data[:512], device)
    tokenizer.to("cpu").eval()
    return TrainStats(epoch_losses=epoch_losses, final_codebook_usage=usage, codebook_size=num_codes)


@torch.no_grad()
def codebook_usage(tokenizer, data: torch.Tensor, device: str = "cpu", batch_size: int = 64) -> int:
    tokenizer.to(device).eval()
    used = set()
    for s in range(0, data.shape[0], batch_size):
        _, ids, _ = tokenizer.quantizer(tokenizer.encoder(data[s:s + batch_size].to(device)))
        used.update(ids.reshape(-1).tolist())
    return len(used)


@torch.no_grad()
def reconstruction_psnr(tokenizer, data: torch.Tensor, device: str = "cpu") -> float:
    """PSNR (dB) of encode→decode on held-out data in [-1, 1]; higher is better
    (~20 dB recognisable, ~25+ dB good)."""
    tokenizer.to(device).eval()
    rec = tokenizer.decode(tokenizer.encode(data.to(device)))
    mse = F.mse_loss((rec.clamp(-1, 1) + 1) / 2, (data.to(device) + 1) / 2).item()
    return 10 * torch.log10(torch.tensor(1.0 / max(mse, 1e-10))).item()


def live_codes(tokenizer) -> int:
    """Data-free collapse check: codes still sitting at their tiny ±1/num_codes
    initialisation were never trained (never won a match). A collapsed
    tokenizer has only a handful of live codes; a revived one has thousands."""
    w = tokenizer.quantizer.codebook.weight.detach()
    init_norm = (w.shape[1] / 3) ** 0.5 / w.shape[0]
    norms = w.norm(dim=1)
    moved = norms > 20 * init_norm
    if not bool(moved.any()):
        return 0
    # tokenizer_select.fit_codebook parks added slots far outside the trained
    # region, all at one identical norm (never chosen) — not live either.
    top = norms.max()
    parked = (norms - top).abs() <= 1e-4 * top
    if int(parked.sum()) > 1:
        moved = moved & ~parked
    return int(moved.sum())


def is_collapsed(tokenizer) -> bool:
    return live_codes(tokenizer) < 0.05 * tokenizer.quantizer.codebook.weight.shape[0]


def train_vqvae_revive(tokenizer, data, num_epochs, batch_size, lr=3e-4, device=None, log_every=10):
    """Same signature and return as train_image_tokenizer/train_audio_tokenizer.train_vqvae."""
    return train_vq_revive(tokenizer, data, num_epochs, batch_size, lr=lr, device=device, log_every=log_every)


def install() -> None:
    """Every notebook that trains a tokenizer imports sham_inputs first; this
    swaps both trainers for the reviving one (notebook cells unchanged)."""
    import train_audio_tokenizer
    import train_image_tokenizer

    train_image_tokenizer.train_vqvae = train_vqvae_revive
    train_audio_tokenizer.train_vqvae = train_vqvae_revive
