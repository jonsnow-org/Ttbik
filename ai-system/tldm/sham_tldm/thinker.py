"""Latent Thinker: `steps` rounds of z <- cell(z) on the latent vectors (h_{t+1} = f(h_t); the cell already carries its own residual connections), no word is written. Early exit stops when a step no longer changes the latents (relative change < eps);
the report's learned confidence head cannot mean anything before it is trained, so the exit rule is the measurable change itself."""
import torch
import torch.nn as nn


class LatentThinker(nn.Module):
    def __init__(self, d: int, steps: int = 5, heads: int = 4, min_steps: int = 2):
        super().__init__()
        self.steps, self.min_steps = steps, min_steps
        self.cell = nn.TransformerEncoderLayer(d, heads, 4 * d, dropout=0.0, batch_first=True, norm_first=True)

    def forward(self, z, early_exit: bool = False, eps: float = 1e-2):
        used = self.steps
        for i in range(self.steps):
            nz = self.cell(z)
            if early_exit and i + 1 >= self.min_steps and ((nz - z).norm() / (z.norm() + 1e-6)).item() < eps:
                return nz, i + 1
            z = nz
        return z, used
