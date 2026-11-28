"""Media as tokens with NO fixed size: an image is any rows x columns of codes, a video is any number of frames, audio is any number of frames of
residual-codebook codes. Geometry lives in (a) ROW_END / FRAME_END markers in the stream and (b) the row / column / time rotary axes, so a longer or larger
signal is just a longer stream (a video past `max_time` continues in a new window with `time_offset`). The codecs that turn pixels / waveforms into these
codes are separate trained parts (stage 2); this module is the format and the parallel generator the codecs plug into."""
from __future__ import annotations

from dataclasses import dataclass

import torch

from .config import ModelConfig
from .model import Qalam


@dataclass
class Layout:
    ids: torch.Tensor     # [T] token ids
    grid: torch.Tensor    # [T, 3] (row, column, time) of each token

    def __len__(self) -> int:
        return int(self.ids.shape[0])


def _cat(parts: list[tuple[list[int], list[tuple[int, int, int]]]]) -> Layout:
    ids = [i for p in parts for i in p[0]]
    grid = [g for p in parts for g in p[1]]
    return Layout(torch.tensor(ids, dtype=torch.long), torch.tensor(grid, dtype=torch.long).reshape(-1, 3))


def image_layout(cfg: ModelConfig, codes: torch.Tensor, time: int = 0) -> Layout:
    """codes [h, w] of image-code indices (0 .. image_codes-1) -> IMG_BEGIN, each row followed by ROW_END, IMG_END."""
    if codes.ndim != 2 or min(codes.shape) < 1:
        raise ValueError("codes must be a non-empty [rows, columns] tensor")
    if int(codes.min()) < 0 or int(codes.max()) >= cfg.image_codes:
        raise ValueError("image code out of range")
    h, w = codes.shape
    ids, grid = [cfg.special_id("IMG_BEGIN")], [(0, 0, time)]
    for r in range(h):
        ids += [cfg.image_base + int(c) for c in codes[r]] + [cfg.special_id("ROW_END")]
        grid += [(r, c, time) for c in range(w)] + [(r, w, time)]
    ids.append(cfg.special_id("IMG_END"))
    grid.append((h, 0, time))
    return _cat([(ids, grid)])


def parse_image(cfg: ModelConfig, ids: torch.Tensor) -> torch.Tensor:
    """Inverse of image_layout: the [rows, columns] code grid, whatever its size. Rows must all have the same width."""
    ids = ids.tolist()
    if not ids or ids[0] != cfg.special_id("IMG_BEGIN") or ids[-1] != cfg.special_id("IMG_END"):
        raise ValueError("not an image stream")
    rows, row = [], []
    for t in ids[1:-1]:
        if t == cfg.special_id("ROW_END"):
            rows.append(row)
            row = []
        elif cfg.modality_of(t) == "image":
            row.append(t - cfg.image_base)
        else:
            raise ValueError("unexpected token inside an image")
    if row or not rows or len({len(r) for r in rows}) != 1:
        raise ValueError("ragged or empty image rows")
    return torch.tensor(rows, dtype=torch.long)


def video_layout(cfg: ModelConfig, codes: torch.Tensor, time_offset: int = 0) -> Layout:
    """codes [frames, h, w] -> VID_BEGIN, then per frame its rows and FRAME_END, VID_END. Any number of frames; `time_offset` continues a long video in a new window."""
    if codes.ndim != 3 or min(codes.shape) < 1:
        raise ValueError("codes must be a non-empty [frames, rows, columns] tensor")
    if int(codes.min()) < 0 or int(codes.max()) >= cfg.image_codes:
        raise ValueError("video code out of range")
    f, h, w = codes.shape
    ids, grid = [cfg.special_id("VID_BEGIN")], [(0, 0, time_offset)]
    for t in range(f):
        for r in range(h):
            ids += [cfg.image_base + int(c) for c in codes[t, r]] + [cfg.special_id("ROW_END")]
            grid += [(r, c, time_offset + t) for c in range(w)] + [(r, w, time_offset + t)]
        ids.append(cfg.special_id("FRAME_END"))
        grid.append((h, 0, time_offset + t))
    ids.append(cfg.special_id("VID_END"))
    grid.append((0, 0, time_offset + f))
    return _cat([(ids, grid)])


def parse_video(cfg: ModelConfig, ids: torch.Tensor) -> torch.Tensor:
    ids = ids.tolist()
    if not ids or ids[0] != cfg.special_id("VID_BEGIN") or ids[-1] != cfg.special_id("VID_END"):
        raise ValueError("not a video stream")
    frames, rows, row = [], [], []
    for t in ids[1:-1]:
        if t == cfg.special_id("ROW_END"):
            rows.append(row)
            row = []
        elif t == cfg.special_id("FRAME_END"):
            frames.append(rows)
            rows = []
        elif cfg.modality_of(t) == "image":
            row.append(t - cfg.image_base)
        else:
            raise ValueError("unexpected token inside a video")
    if row or rows or not frames or len({len(r) for f in frames for r in f}) != 1 or len({len(f) for f in frames}) != 1:
        raise ValueError("ragged or empty video")
    return torch.tensor(frames, dtype=torch.long)


def delay_codes(codes: torch.Tensor, pad: int) -> torch.Tensor:
    """Residual codebooks of one audio frame depend on the coarser ones, so codebook k is delayed by k steps: [frames, books] -> [frames + books - 1, books]."""
    f, k = codes.shape
    out = torch.full((f + k - 1, k), pad, dtype=codes.dtype, device=codes.device)
    for b in range(k):
        out[b:b + f, b] = codes[:, b]
    return out


def undelay_codes(delayed: torch.Tensor, frames: int) -> torch.Tensor:
    k = delayed.shape[1]
    return torch.stack([delayed[b:b + frames, b] for b in range(k)], dim=1)


def audio_layout(cfg: ModelConfig, codes: torch.Tensor, time_offset: int = 0) -> Layout:
    """codes [frames, books] of audio-code indices -> AUD_BEGIN, then per (delayed) step its `books` codes, AUD_END. Any duration; rows = codebook index."""
    if codes.ndim != 2 or min(codes.shape) < 1:
        raise ValueError("codes must be a non-empty [frames, books] tensor")
    if int(codes.min()) < 0 or int(codes.max()) >= cfg.audio_codes:
        raise ValueError("audio code out of range")
    f, k = codes.shape
    d = delay_codes(codes, -1)
    ids, grid = [cfg.special_id("AUD_BEGIN")], [(0, 0, time_offset)]
    for step in range(d.shape[0]):
        for b in range(k):
            v = int(d[step, b])
            ids.append(cfg.special_id("PAD") if v < 0 else cfg.audio_base + v)
            grid.append((b, 0, time_offset + step))
    ids.append(cfg.special_id("AUD_END"))
    grid.append((0, 0, time_offset + d.shape[0]))
    return _cat([(ids, grid)])


def parse_audio(cfg: ModelConfig, ids: torch.Tensor, books: int, frames: int) -> torch.Tensor:
    body = ids.tolist()[1:-1]
    if ids[0] != cfg.special_id("AUD_BEGIN") or ids[-1] != cfg.special_id("AUD_END") or len(body) != (frames + books - 1) * books:
        raise ValueError("not an audio stream of that shape")
    if books < 1 or frames < 1:
        raise ValueError("books and frames must be positive")
    pad = cfg.special_id("PAD")
    bad = [t for t in body if t != pad and not cfg.audio_base <= t < cfg.audio_base + cfg.audio_codes]
    if bad:
        raise ValueError(f"audio stream holds a token that is neither an audio code nor PAD (id {bad[0]})")
    steps = torch.tensor([[cfg.audio_codes if t == pad else t - cfg.audio_base for t in body[i * books:(i + 1) * books]]
                          for i in range(frames + books - 1)], dtype=torch.long)
    return undelay_codes(steps, frames)


# --------------------------------------------------------------------------------------- parallel generation of an image of ANY size
@torch.no_grad()
def generate_image_codes(model: Qalam, prefix: torch.Tensor, rows: int, columns: int, steps: int = 8, cycles: int | None = None) -> torch.Tensor:
    """An image of `rows` x `columns` codes written in `steps` parallel refinement passes by the native T-LDM writer (not one token at a time). The ROW_END
    markers are fixed in the template, so the shape is exact; only image codes can be written. Returns the code grid [rows, columns]."""
    cfg = model.cfg
    if rows < 1 or columns < 1 or rows > cfg.max_grid or columns + 1 > cfg.max_grid:
        raise ValueError("image size outside max_grid")
    mask, row_end = cfg.special_id("MASK"), cfg.special_id("ROW_END")
    body = []
    grid = []
    for r in range(rows):
        body += [mask] * columns + [row_end]
        grid += [(r, c, 0) for c in range(columns)] + [(r, columns, 0)]
    dev = prefix.device
    template = torch.tensor([[cfg.special_id("IMG_BEGIN")] + body], dtype=torch.long, device=dev).expand(prefix.shape[0], -1).contiguous()
    gridt = torch.tensor([(0, 0, 0)] + grid, dtype=torch.long, device=dev)
    if prefix.shape[1] + template.shape[1] > cfg.max_seq:
        raise ValueError("prefix + image exceeds max_seq")
    allowed = list(range(cfg.image_base, cfg.image_base + cfg.image_codes))          # only masked positions are written, and only with image codes
    was = model.training
    model.eval()
    try:
        cyc = model._cycles(cycles)
        h, cache = model.prefill(prefix, cyc)
        out = model._draft(cache, h, template.shape[1], steps, allowed, cyc, template=template, grid=gridt)
    finally:
        model.train(was)
    return torch.stack([row[1:][r * (columns + 1):r * (columns + 1) + columns] - cfg.image_base for r in range(rows) for row in out[:1]])
