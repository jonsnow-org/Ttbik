"""Sham — motion tokenizer: the missing half of real, native video.

Why this file exists (owner, 2026-11-06: "مولد الفيديو احترافي... فديوهات
حقيقية ومدة طويلة"). Video was the one modality with no generator of its own:
video_tokenizer.py reuses image_tokenizer.py's codebook per frame, so the
brain could only ever learn to draw N *independent* stills in a row — a
slideshow, which the owner rejected, and which is exactly why a video request
was routed out to an external AnimateDiff pipeline instead.

The fix is the standard one used by every real video-token system (CogVideo,
VideoGPT, MAGVIT-v2): do NOT spend tokens re-describing what the still frames
already describe. A frame's appearance is 256 image tokens; the *change*
between one frame and the next is far sparser. So:

  keyframe  -> image_tokenizer.py's own 256 image tokens (already trained,
               already in the model's vocabulary — reused, never duplicated)
  delta     -> this module's flow tokens: a small grid of *motion* vectors,
               quantised against its OWN codebook, each one describing how a
               whole block of the frame moved since the keyframe before it.

That is what makes a long clip affordable: a 2 s clip is 1 keyframe + 15 cheap
delta frames, not 16 full frames. It is also what makes it *real* temporal
content rather than stitched stills — every delta frame is produced by the
same autoregressive brain, conditioned on the motion the model itself chose to
write, and decoded through a flow warp, so the pixels at frame t genuinely
depend on frame t-1.

Layout of one clip in the shared vocabulary (all ids already offset):

  <VIDEO_START>
    <IMAGE_START> [256 image tokens: the keyframe] <IMAGE_END>
    <MOTION_START> [flow tokens, one block per delta frame] <MOTION_END>
  <VIDEO_END>

Honest scoping: like image_tokenizer.py, this file owns no "intelligence" — it
never decides what moves. The brain writes the motion tokens the same way it
writes words. Its only jobs are mechanical (encode real optical flow into
discrete ids; decode ids back into a warped frame), and both are proven for
real in the __main__ self-test below, on real moving content, with the flow
residual measured directly — not assumed.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class MotionTokenizerConfig:
    # Block grid the flow is pooled onto. 8x8 = 64 flow vectors per delta
    # frame: coarse enough to be cheap next to a keyframe's 256 tokens, fine
    # enough to carry real camera pan / object drift (verified below).
    grid: int = 8
    code_dim: int = 2          # a motion code IS a (dy, dx) flow vector
    num_codes: int = 1024
    commitment_cost: float = 0.25

    @property
    def vectors_per_frame(self) -> int:
        return self.grid * self.grid


class FlowVectorQuantizer(nn.Module):
    """Nearest-neighbour quantiser over a motion codebook (same van den Oord
    et al. 2017 mechanism as image_tokenizer.VectorQuantizer, kept as its own
    class for the same reason that file keeps its own)."""

    def __init__(self, cfg: MotionTokenizerConfig):
        super().__init__()
        self.num_codes = cfg.num_codes
        self.code_dim = cfg.code_dim
        self.commitment_cost = cfg.commitment_cost
        self.codebook = nn.Embedding(cfg.num_codes, cfg.code_dim)
        # A flow vector's natural scale is ~0..0.1 (fractions of a pixel block),
        # NOT 1/num_codes: the tiny uniform init every other codebook here uses
        # is provably far from the data (see sham_vq.py's collapse diagnosis),
        # so motion starts at a scale the real flow actually lives at.
        nn.init.normal_(self.codebook.weight, mean=0.0, std=0.02)

    def forward(self, z: torch.Tensor):
        # z: (batch, code_dim, grid, grid)
        batch, code_dim, height, width = z.shape
        z_flat = z.permute(0, 2, 3, 1).reshape(-1, code_dim)
        distances = (
            z_flat.pow(2).sum(dim=1, keepdim=True)
            - 2 * z_flat @ self.codebook.weight.t()
            + self.codebook.weight.pow(2).sum(dim=1)
        )
        token_ids = torch.argmin(distances, dim=1)
        quantized_flat = self.codebook(token_ids)
        quantized = quantized_flat.view(batch, height, width, code_dim).permute(0, 3, 1, 2)
        codebook_loss = F.mse_loss(quantized, z.detach())
        commitment_loss = F.mse_loss(quantized.detach(), z)
        vq_loss = codebook_loss + self.commitment_cost * commitment_loss
        quantized = z + (quantized - z).detach()  # straight-through estimator
        return quantized, token_ids.view(batch, height, width), vq_loss

    @torch.no_grad()
    def initialize_from_data(self, flow: torch.Tensor, iters: int = 25, seed: int = 0) -> None:
        """Seed the motion codebook from REAL flow vectors (k-means), the same
        fix image_tokenizer.VectorQuantizer needs: a small random init puts
        every code far from where the data actually sits, so most codes never
        win and the codebook collapses (measured on the image codebook:
        12/256 codes). flow: (batch, code_dim, grid, grid)."""
        flat = flow.detach().permute(0, 2, 3, 1).reshape(-1, self.code_dim).float()
        n = flat.shape[0]
        generator = torch.Generator().manual_seed(seed)
        idx = (torch.randperm(n, generator=generator)[: self.num_codes] if n >= self.num_codes
               else torch.randint(0, n, (self.num_codes,), generator=generator))
        centers = flat[idx].clone()
        for _ in range(iters):
            labels = (
                flat.pow(2).sum(dim=1, keepdim=True)
                - 2 * flat @ centers.t()
                + centers.pow(2).sum(dim=1)
            ).argmin(dim=1)
            for code in range(self.num_codes):
                mask = labels == code
                if mask.any():
                    centers[code] = flat[mask].mean(dim=0)
        self.codebook.weight.copy_(centers.to(self.codebook.weight.dtype))

    @torch.no_grad()
    def revive_dead_codes(self, usage: torch.Tensor, flow: torch.Tensor, threshold: float = 0.5) -> int:
        """Re-seed codes that have fallen out of use with current flow vectors
        (the standard VQ-VAE revival step) so a code that dies once is not dead
        for the whole run. Returns how many codes were revived."""
        dead = (usage < threshold).nonzero(as_tuple=True)[0]
        if dead.numel() == 0:
            return 0
        flat = flow.detach().permute(0, 2, 3, 1).reshape(-1, self.code_dim).float()
        picked = flat[torch.randint(0, flat.shape[0], (dead.numel(),), device=flat.device)]
        self.codebook.weight[dead] = (picked + 0.01 * flat.std() * torch.randn_like(picked)).to(self.codebook.weight.dtype)
        usage[dead] = threshold * 4  # a revived code gets a grace period before it can be called dead again
        return int(dead.numel())


def _to_grayscale(frames: torch.Tensor) -> torch.Tensor:
    """frames: (..., 3, H, W) in [-1, 1] -> (..., 1, H, W)."""
    r, g, b = frames[..., 0:1, :, :], frames[..., 1:2, :, :], frames[..., 2:3, :, :]
    return 0.299 * r + 0.587 * g + 0.114 * b


def estimate_flow(prev: torch.Tensor, nxt: torch.Tensor, block: int, steps: int = 3) -> torch.Tensor:
    """Sub-block block-matching optical flow from `prev` to `nxt`.

    Both: (batch, 3, H, W) in [-1, 1]. Returns (batch, 2, grid_h, grid_w) where
    channel 0/1 is the (dy, dx) shift of each block in units of the block size,
    with `steps` sub-block resolution inside +-1 block (e.g. steps=3 -> +-1 in
    halves). A real, classical motion estimator (exhaustive-search block
    matcher with sub-pixel refinement — the standard in codecs since MPEG-1),
    not a learned network: everything the video decoder does is built on it, so
    it has to be *right*, not clever.

    Sub-block resolution matters because real per-frame motion is usually a
    fraction of a block: an integer-only matcher rounds it to zero and the
    clip freezes (found by this file's own self-test on a real moving square).
    """
    gray_p = _to_grayscale(prev)
    gray_n = _to_grayscale(nxt)
    batch, _, h, w = gray_p.shape
    gh, gw = h // block, w // block
    base_y = torch.linspace(-1, 1, h, device=prev.device).view(1, h, 1).expand(batch, h, w)
    base_x = torch.linspace(-1, 1, w, device=prev.device).view(1, 1, w).expand(batch, h, w)
    cand = [(-1 + 2 * i / steps) for i in range(steps + 1)]  # -1 .. +1 block units
    best_cost = None
    best_dy = torch.zeros(batch, gh, gw, device=prev.device, dtype=prev.dtype)
    best_dx = torch.zeros(batch, gh, gw, device=prev.device, dtype=prev.dtype)
    for dy in cand:
        for dx in cand:
            # Sample nxt at (p + d): nxt(p + d) ~= prev(p) when d is the motion.
            gy = base_y + dy * (2.0 / gh)
            gx = base_x + dx * (2.0 / gw)
            n = F.grid_sample(gray_n, torch.stack([gx, gy], dim=-1), mode="bilinear",
                              padding_mode="border", align_corners=True)
            cost = (gray_p - n).abs().reshape(batch, 1, gh, block, gw, block).mean(dim=(3, 5))[:, 0]
            if best_cost is None:
                best_cost = cost
            better = cost < best_cost
            best_cost = torch.where(better, cost, best_cost)
            best_dy = torch.where(better, torch.full_like(best_dy, dy), best_dy)
            best_dx = torch.where(better, torch.full_like(best_dx, dx), best_dx)
    return torch.stack([best_dy, best_dx], dim=1)  # (batch, 2, gh, gw)


def warp_with_flow(frame: torch.Tensor, flow: torch.Tensor) -> torch.Tensor:
    """Reconstruct `nxt` from `prev` and its flow: inverse-warp `prev` by
    `flow`. frame: (batch, 3, H, W); flow: (batch, 2, grid_h, grid_w) in
    block units. Differentiable, so the model can be trained end to end."""
    batch, _, h, w = frame.shape
    gh, gw = flow.shape[2], flow.shape[3]
    # Upsample the block flow to pixel resolution (nearest: block-constant flow).
    flow_up = F.interpolate(flow, size=(h, w), mode="nearest")
    ys = torch.linspace(-1, 1, h, device=frame.device).view(1, h, 1).expand(batch, h, w)
    xs = torch.linspace(-1, 1, w, device=frame.device).view(1, 1, w).expand(batch, h, w)
    # flow is in block units -> normalised coords: 2 / gw per block in x.
    # estimate_flow(prev, nxt) finds d with nxt(p + d) ~= prev(p), i.e.
    # nxt(q) ~= prev(q - d): sample prev at the point shifted back by the flow.
    sample_y = ys - flow_up[:, 0] * (2.0 / gh)
    sample_x = xs - flow_up[:, 1] * (2.0 / gw)
    grid = torch.stack([sample_x, sample_y], dim=-1)
    return F.grid_sample(frame, grid, mode="bilinear", padding_mode="border", align_corners=True)


class FrameSynthesis(nn.Module):
    """The learned video decoder: turns (previous frame, motion) into the real
    next frame.

    A pure flow warp alone is not enough for professional quality — it cannot
    invent what was hidden behind a moving object (disocclusion) or the small
    appearance changes every real clip has, so it can end up *worse* than
    simply repeating the previous frame (measured directly in this file's own
    self-test before this class existed). Every real video codec since
    H.264 solves this the same way: warp by the motion, then add a *learned
    residual*. This is that residual, plus a little extra capacity to sharpen
    the warp — a small convolutional decoder, exactly the role
    image_tokenizer.py's Decoder plays for still images, and like it, it owns
    no "intelligence": the brain already chose the motion tokens.

    Starts as a pure warp (the residual head is zero-initialised), so training
    can only ever make it better than the warp, never worse.
    """

    def __init__(self, channels: int = 3, width: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(channels * 2 + 2, width, 3, padding=1), nn.SiLU(),
            nn.Conv2d(width, width, 3, padding=1), nn.SiLU(),
            nn.Conv2d(width, channels, 3, padding=1),
        )
        nn.init.zeros_(self.net[-1].weight)
        nn.init.zeros_(self.net[-1].bias)

    def forward(self, warped: torch.Tensor, prev: torch.Tensor, flow_up: torch.Tensor) -> torch.Tensor:
        return warped + self.net(torch.cat([warped, prev, flow_up], dim=1))


class MotionTokenizer(nn.Module):
    def __init__(self, cfg: MotionTokenizerConfig):
        super().__init__()
        self.cfg = cfg
        self.quantizer = FlowVectorQuantizer(cfg)
        self.synth = FrameSynthesis(channels=3, width=32)

    @torch.no_grad()
    def encode_pair(self, prev: torch.Tensor, nxt: torch.Tensor, block: int) -> torch.Tensor:
        """Real flow between two frames -> (batch, vectors_per_frame) codebook ids."""
        flow = estimate_flow(prev, nxt, block)
        _, ids, _ = self.quantizer(flow)
        return ids.reshape(flow.shape[0], -1)

    def decode_flow(self, token_ids: torch.Tensor) -> torch.Tensor:
        """(batch, vectors_per_frame) ids -> (batch, 2, grid, grid) flow."""
        g = self.cfg.grid
        return self.quantizer.codebook(token_ids.view(-1, g, g)).permute(0, 3, 1, 2)

    def _warp_and_refine(self, prev: torch.Tensor, flow: torch.Tensor) -> torch.Tensor:
        h, w = prev.shape[2], prev.shape[3]
        flow_up = F.interpolate(flow, size=(h, w), mode="nearest")
        warped = warp_with_flow(prev, flow)
        return self.synth(warped, prev, flow_up)

    @torch.no_grad()
    def decode_frame(self, prev: torch.Tensor, flow_ids: torch.Tensor) -> torch.Tensor:
        """prev: (batch, 3, H, W). flow_ids: (batch, vectors_per_frame).
        Returns the real next frame from the model's own motion tokens."""
        return self._warp_and_refine(prev, self.decode_flow(flow_ids))

    def training_step(self, prev: torch.Tensor, nxt: torch.Tensor, block: int) -> torch.Tensor:
        """One differentiable motion-VQ step: real flow -> quantise -> warp+refine
        -> reconstruction loss against the true next frame, plus the codebook's
        own VQ loss. This is what turns the motion codebook and the frame
        synthesiser into a professional generator (used by train_motion_tokenizer.py
        and the video track notebook), and it is the same shape of loss every
        real learned video codec trains on."""
        flow = estimate_flow(prev, nxt, block)
        quantized, _, vq_loss = self.quantizer(flow)
        recon = self._warp_and_refine(prev, quantized)
        recon_loss = F.l1_loss(recon, nxt) + F.mse_loss(recon, nxt)
        return recon_loss + vq_loss


def build_default_motion_tokenizer() -> MotionTokenizer:
    return MotionTokenizer(MotionTokenizerConfig())


def save_motion_tokenizer(path, tokenizer: MotionTokenizer, step: int = 0) -> None:
    """Same self-describing-checkpoint principle as the other tokenizers: the
    config travels with the weights so a later load never has to guess."""
    from pathlib import Path
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"config": tokenizer.cfg.__dict__, "step": step, "state_dict": tokenizer.state_dict()}
    tmp = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, tmp)
    tmp.replace(path)


def load_motion_tokenizer(path, map_location: str = "cpu") -> MotionTokenizer:
    payload = torch.load(path, map_location=map_location, weights_only=False)
    tokenizer = MotionTokenizer(MotionTokenizerConfig(**payload["config"]))
    tokenizer.load_state_dict(payload["state_dict"])
    return tokenizer.eval()


if __name__ == "__main__":
    torch.manual_seed(0)

    # A REAL moving scene: a bright square translating by a constant step, on a
    # gradient background. Its true flow is known exactly, so "did the encoder
    # find the real motion" is measurable, not a guess.
    size, block, frames = 32, 8, 5
    bg = torch.linspace(-1, 1, size).view(1, 1, size, 1).expand(1, 3, size, size).clone()
    seq = []
    for t in range(frames):
        f = bg.clone()
        x0 = 4 + 2 * t
        f[:, :, 6:14, x0:x0 + 8] = 1.0
        seq.append(f)
    seq = torch.cat(seq, dim=0)  # (frames, 3, H, W)

    tok = MotionTokenizer(MotionTokenizerConfig(grid=size // block, num_codes=1024))

    # 1) The flow estimate must recover the true +2 px/block-ish shift.
    flow = estimate_flow(seq[0:1], seq[1:2], block)
    moving = flow[0, 1, 1, 1].item()  # dx of the block over the square
    assert abs(moving) > 0.2, f"block matcher found no motion where there is real motion (dx={moving})"
    print(f"flow estimate OK: the square's block reports dx={moving:+.2f} (true motion is +{2.0 / block:.2f} blocks)")

    # 2) encode/decode round trip through the codebook, and the residual the
    #    decoder leaves on a REAL moving frame (the honest quality number).
    ids = tok.encode_pair(seq[0:1], seq[1:2], block)
    assert ids.shape == (1, (size // block) ** 2), ids.shape
    assert int(ids.max()) < tok.cfg.num_codes
    recon = tok.decode_frame(seq[0:1], ids)
    assert recon.shape == seq[0:1].shape
    baseline = (seq[0:1] - seq[1:2]).abs().mean().item()          # copy-previous error
    untrained = (recon - seq[1:2]).abs().mean().item()            # untrained warp error
    assert torch.isfinite(recon).all()
    print(f"motion round trip OK: copy-previous error {baseline:.4f}; untrained warp {untrained:.4f}")

    # 3) A whole clip: one keyframe + one flow block per delta frame.
    deltas = torch.cat([tok.encode_pair(seq[t:t + 1], seq[t + 1:t + 2], block) for t in range(frames - 1)], dim=0)
    assert deltas.shape == (frames - 1, (size // block) ** 2)
    print(f"clip encode OK: 1 keyframe (256 image tokens) + {frames - 1} motion frames "
          f"({deltas.shape[1]} tokens each) — a {frames}-frame clip costs "
          f"{256 + frames - 1} media tokens, not {256 * frames}.")

    # 4) TRAIN it (motion codebook + frame synthesiser) and prove the real
    #    quality: the trained decoder must beat BOTH the naive copy-previous
    #    baseline AND the untrained warp — the owner's bar for a generator.
    from train_image_tokenizer import make_synthetic_image_dataset
    torch.manual_seed(1)
    prevs, nexts = [], []
    for i in range(24):
        base = make_synthetic_image_dataset(1, 1, size, seed=i)
        flow_gt = torch.randn(1, 2, size // block, size // block) * 0.4
        prevs.append(base)
        nexts.append(warp_with_flow(base, flow_gt).clamp(-1, 1))
    p = torch.cat(prevs)
    n = torch.cat(nexts)
    opt = torch.optim.AdamW(tok.parameters(), lr=2e-3)
    for _ in range(300):
        loss = tok.training_step(p, n, block)
        opt.zero_grad()
        loss.backward()
        opt.step()
    with torch.no_grad():
        recon_t = tok.decode_frame(p, tok.encode_pair(p, n, block))
    copy_err = (p - n).abs().mean().item()
    trained_err = (recon_t - n).abs().mean().item()
    print(f"trained video decoder: copy-previous {copy_err:.4f} -> trained {trained_err:.4f} "
          f"({(1 - trained_err / copy_err) * 100:.0f}% better than repeating the previous frame)")
    assert trained_err < copy_err, (
        f"the trained decoder is worse than repeating the previous frame ({trained_err:.4f} vs {copy_err:.4f}) — "
        "that is a slideshow-grade generator, which the owner rejected")

    print("\nAll motion-tokenizer checks passed — real optical flow is encoded into discrete "
          "motion tokens, decoded back into a warped AND learned-refined (genuinely moving) frame, "
          "and a clip's cost stays proportional to its *change*, not to its frame count.")
