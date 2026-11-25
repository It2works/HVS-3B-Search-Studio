"""The adapter contract used by the episode loop and the health endpoint."""

from __future__ import annotations

from typing import Protocol, TypedDict, runtime_checkable


class AdapterDescriptor(TypedDict):
    """Public description of a loaded model (no URLs or keys)."""

    id: str
    label: str
    device: str


@runtime_checkable
class ModelAdapter(Protocol):
    """An injected model. ``messages`` are chat messages; ``images`` are RGB arrays."""

    id: str
    label: str
    device: str

    def generate(self, messages: list[dict], images: list) -> str:
        """Return the model's raw output text."""
        ...


def describe(adapter: ModelAdapter) -> AdapterDescriptor:
    """Build the descriptor dict without ever exposing credentials or endpoints."""
    adapter_id = str(getattr(adapter, "id", "unknown"))
    return {
        "id": adapter_id,
        "label": str(getattr(adapter, "label", adapter_id)),
        "device": str(getattr(adapter, "device", "unknown")),
    }
