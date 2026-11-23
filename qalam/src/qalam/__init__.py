"""Qalam: from-scratch native model. Imports nothing from Sham, Nova or OneCore."""
from .config import ModelConfig, SPECIAL_NAMES
from .model import Qalam

__all__ = ["ModelConfig", "SPECIAL_NAMES", "Qalam"]
