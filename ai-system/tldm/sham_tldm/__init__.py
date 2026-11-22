"""SHAM T-LDM: the working implementation of the owner's reference script (sham_tldm_reference.txt). Same pieces, same names; each one trains."""
from .bitlinear import BitLinear, make_linear, pack_ternary, unpack_ternary, bitnet_size_bytes  # noqa: F401
from .mamba import MambaBlock  # noqa: F401
from .compressor import Compressor  # noqa: F401
from .thinker import LatentThinker  # noqa: F401
from .writer import DiffusionWriter  # noqa: F401
from .model import Sham1_TLDM, ShamBodyTLDM, encode_bytes, decode_bytes  # noqa: F401
from .tokenizer import ByteTokenizer, BPETokenizer, from_state  # noqa: F401
from .fast import fast_inference, cpu_has_amx  # noqa: F401
