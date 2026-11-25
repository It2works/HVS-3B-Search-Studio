"""Model adapters. All implementations share the same generate() interface."""

from .base import AdapterDescriptor, ModelAdapter, describe
from .mock import MockAdapter
from .openai_adapter import OpenAICompatAdapter
from .transformers_adapter import TransformersAdapter

__all__ = [
    "AdapterDescriptor",
    "ModelAdapter",
    "MockAdapter",
    "OpenAICompatAdapter",
    "TransformersAdapter",
    "describe",
]
