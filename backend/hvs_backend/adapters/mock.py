"""Deterministic scripted adapter for tests and GPU-free UI work."""

from __future__ import annotations


class MockAdapter:
    """Replays a fixed script: rotate a few times, then submit.

    The default script deliberately uses the spaced tag formatting the real
    model was trained on. Pass ``script=`` to exercise other paths (e.g. an
    invalid output followed by a valid one).
    """

    id = "mock"
    label = "Mock (scripted)"
    device = "cpu"

    DEFAULT_SCRIPT = (
        "< think > scan the scene < /think > < answer > rotate(30, 0) < /answer >",
        "< think > keep looking < /think > < answer > rotate(30, 0) < /answer >",
        "< think > found it < /think > < answer > submit < /answer >",
    )

    def __init__(self, script: list[str] | tuple[str, ...] | None = None) -> None:
        self.script = list(script) if script is not None else list(self.DEFAULT_SCRIPT)
        self.calls = 0

    def generate(self, messages: list[dict], images: list) -> str:
        del messages, images
        if not self.script:
            self.calls += 1
            return ""
        index = min(self.calls, len(self.script) - 1)
        self.calls += 1
        return self.script[index]
