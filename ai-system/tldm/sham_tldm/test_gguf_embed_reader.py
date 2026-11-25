"""GgufEmbedReader reads a GGUF's token_embd rows (plain and quantised) with the LlamaReader interface. Run: python sham_tldm/test_gguf_embed_reader.py"""
import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import gguf  # noqa: E402
from gguf.quants import quantize  # noqa: E402
from sham_tldm.gguf_embed_reader import GgufEmbedReader  # noqa: E402


def make(path, emb, qtype):
    w = gguf.GGUFWriter(path, "test")
    data = emb if qtype == gguf.GGMLQuantizationType.F32 else quantize(emb, qtype)
    w.add_tensor("token_embd.weight", data, raw_shape=data.shape, raw_dtype=qtype)
    w.write_header_to_file(); w.write_kv_data_to_file(); w.write_tensors_to_file(); w.close()


def main():
    rng = np.random.default_rng(0)
    emb = rng.standard_normal((50, 64)).astype(np.float32)        # 50 tokens, width 64
    for qt, tol in ((gguf.GGMLQuantizationType.F32, 1e-6), (gguf.GGMLQuantizationType.Q8_0, 0.05)):
        d = tempfile.mkdtemp(); p = os.path.join(d, "m.gguf")
        make(p, emb, qt)
        r = GgufEmbedReader(p)
        assert r.d == 64 and r.n_vocab == 50, (r.d, r.n_vocab)
        assert r.probe() == 64
        got = r.rows([3, 7]) * r.scale
        assert np.allclose(got, emb[[3, 7]], atol=tol * 4), np.abs(got - emb[[3, 7]]).max()
        x, pad = r.feats([[1, 2, 3], [4]], 5)
        assert tuple(x.shape) == (2, 5, 64) and pad[0].tolist() == [False, False, False, True, True] and pad[1].tolist() == [False, True, True, True, True]
        assert len(r.cache) == 2
    print("ok")


if __name__ == "__main__":
    main()
