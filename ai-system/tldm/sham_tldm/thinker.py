"""Latent Thinker: `steps` rounds of z <- cell(z) on the latent vectors (h_{t+1} = f(h_t); the cell already carries its own residual connections), no word is written. Early exit stops when a step no longer changes the latents (relative change < eps);
the report's learned confidence head cannot mean anything before it is trained, so the exit rule is the measurable change itself."""
import torch
import torch.nn as nn


class LatentThinker(nn.Module):
    def __init__(self, d: int, steps: int = 5, heads: int = 4, min_steps: int = 2, exit_rule: str = "change", conf_threshold: float = 0.95):
        """exit_rule "change" (default): stop when a step changes the latents by < eps. exit_rule "confidence" (the book: "exit after step 7 when confidence > 0.95"):
        a small head reads the mean latent and stops when sigmoid(head) > conf_threshold, from step `min_steps` on. The head only means something once trained
        (train_0.3b trains it to predict "the writer's block is already right from these latents" when thinker_confidence is on)."""
        super().__init__()
        self.steps, self.min_steps, self.exit_rule, self.conf_threshold = steps, min_steps, exit_rule, conf_threshold
        self.cell = nn.TransformerEncoderLayer(d, heads, 4 * d, dropout=0.0, batch_first=True, norm_first=True)
        if exit_rule == "confidence":
            self.conf = nn.Linear(d, 1)

    def confidence(self, z):
        return torch.sigmoid(self.conf(z.mean(1)))[..., 0]

    def forward(self, z, early_exit: bool = False, eps: float = 1e-2):
        used = self.steps
        for i in range(self.steps):
            nz = self.cell(z)
            if early_exit and i + 1 >= self.min_steps:
                if self.exit_rule == "confidence":
                    if bool((self.confidence(nz) > self.conf_threshold).all()):
                        return nz, i + 1
                elif ((nz - z).norm() / (z.norm() + 1e-6)).item() < eps:
                    return nz, i + 1
            z = nz
        return z, used
