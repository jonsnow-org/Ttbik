"""int8 weights for CPU inference (dynamic activation quantisation). Measured on 2 threads, base config: prefill 664 -> 1254 tok/s."""
from __future__ import annotations

import copy
import warnings

import torch

from .model import Qalam


def quantize_int8(model: Qalam) -> Qalam:
    """A quantised COPY for serving. Training keeps the float model. The tied embedding stays float (it is a lookup); Linear layers become int8."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return torch.ao.quantization.quantize_dynamic(copy.deepcopy(model).eval(), {torch.nn.Linear}, dtype=torch.qint8)
