"""Sham v1 video must be trained in the SAME layout the Studio generates.

The owner's complaint was that video came out as stitched frames, not a real
clip. The cause: the live trainer (sham_live.py) trained video as N independent
keyframes + audio, while sham_studio_media._video_result generates — and
video_tokenizer.decode_clip decodes — a keyframe PLUS motion (flow) tokens:
    <VIDEO_START> <IMAGE_START> key <IMAGE_END>
                  <MOTION_START> (frames-1) x vectors_per_frame <MOTION_END> <VIDEO_END>
A checkpoint trained without that layout can never answer it, so the served
video came back as the honest NO_VIDEO notice or as stills.

These tests pin the training layout to the decode layout, and exercise the real
motion-encoding path in sham_live.Encoder.
"""

from __future__ import annotations

import io
import json
import random

import torch
from PIL import Image

from image_tokenizer import build_default_tokenizer
from model import SpecialTokens
from motion_tokenizer import build_default_motion_tokenizer
from sham_chat import build_motion_video_chat_examples
from video_tokenizer import decode_clip, encode_clip


def _clip(batch=1, num_frames=4, size=256):
    """A real moving square: a genuine temporal clip, not random noise."""
    frames = torch.zeros(batch, num_frames, 3, size, size)
    for t in range(num_frames):
        x = 8 + t * 12
        frames[:, t, :, :, x:x + 40] = 1.0
    return frames * 2 - 1


def test_training_span_matches_the_studio_decode_layout():
    img = build_default_tokenizer()
    motion = build_default_motion_tokenizer()
    frames = _clip(num_frames=4)
    span = encode_clip(img, motion, frames)[0].tolist()

    # pull the keyframe and motion tokens back out of the reference span ...
    i = span.index(SpecialTokens.IMAGE_START)
    j = span.index(SpecialTokens.IMAGE_END)
    key_ids = span[i + 1:j]
    a = span.index(SpecialTokens.MOTION_START)
    b = span.index(SpecialTokens.MOTION_END)
    motion_ids = span[a + 1:b]

    # ... and rebuild the span the way the trainer now does
    ex = build_motion_video_chat_examples(lambda t: [1 + (ord(c) % 90) for c in t], "مربع يتحرك", key_ids, motion_ids, random.Random(0))
    gen = ex[1]  # (c_prefix + span + EOS)
    ids = gen[0]
    start = ids.index(SpecialTokens.VIDEO_START)
    end = ids.index(SpecialTokens.VIDEO_END)
    assert ids[start:end + 1] == span, "training span differs from the encode_clip/decode_clip layout"

    # the decode the Studio runs must accept the very span the trainer produces
    decoded = decode_clip(img, motion, torch.tensor([span], dtype=torch.long), 4)
    assert decoded.shape == (1, 4, 3, img.cfg.image_size, img.cfg.image_size)


def test_motion_layout_is_inside_the_trained_context():
    img = build_default_tokenizer()
    motion = build_default_motion_tokenizer()
    num_frames = 8
    total = 1 + (2 + img.cfg.tokens_per_image) + 2 + (num_frames - 1) * motion.cfg.vectors_per_frame + 1
    assert total <= 1024, f"{num_frames}-frame clip needs {total} tokens, above the 1024 default context"


def test_encoder_uses_motion_when_a_motion_tokenizer_is_present():
    import sham_live

    img = build_default_tokenizer()
    motion = build_default_motion_tokenizer()

    class _Text:
        def encode(self, text):
            return [1 + (ord(c) % 90) for c in text]

    enc = sham_live.Encoder(_Text(), img, None, max_len=1024, device="cpu", motion_tok=motion)

    frames = []
    for t in range(sham_live.VIDEO_MOTION_FRAMES):
        im = Image.new("RGB", (64, 64), (t * 20 % 255, 40, 200))
        b = io.BytesIO()
        im.save(b, format="PNG")
        frames.append(b.getvalue().hex())
    item = type("Item", (), {"kind": "video", "text": "مربع يتحرك", "source": "mirror_test",
                             "data": json.dumps({"frames": frames, "caption": "مربع يتحرك"})})()

    examples = enc(item, random.Random(0))
    assert examples, "the motion video branch produced no example"
    for ids, labels in examples:
        assert SpecialTokens.MOTION_START in ids and SpecialTokens.MOTION_END in ids, "trained span has no motion tokens"
        assert len(ids) == len(labels) and len(ids) <= 1024
