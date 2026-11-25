"""Official-prompt loading and multi-turn message construction.

The prompt is never invented: if ``backend/prompts/official.txt`` is absent or
empty, callers get a clear :class:`PromptNotConfigured` error. The official
text is embedded verbatim — its ``< think >`` / ``< answer >`` formatting (with
spaces) must reach the model unchanged, and assistant turns keep the model's
raw output verbatim for the same reason.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

OFFICIAL_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "official.txt"


class PromptNotConfigured(RuntimeError):
    """The official prompt file is missing, unreadable, or empty."""


def load_official_prompt(path: str | Path | None = None) -> str:
    """Read the official prompt verbatim; refuse to run without it."""
    target = Path(path) if path is not None else OFFICIAL_PROMPT_PATH
    if not target.is_file():
        raise PromptNotConfigured(
            f"Official prompt not found at {target}. "
            "Add backend/prompts/official.txt before running a live episode."
        )
    try:
        text = target.read_text(encoding="utf-8")
    except OSError as exc:
        raise PromptNotConfigured(f"Cannot read official prompt at {target}: {exc}") from exc
    if not text.strip():
        raise PromptNotConfigured(
            f"Official prompt at {target} is empty. Refusing to invent a fallback."
        )
    return text


def prompt_sha256(prompt: str) -> str:
    """Hash recorded in ``config.prompt_sha`` of the run file."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def _direction_text(pose: dict) -> str:
    return f"Viewing direction: yaw={pose['yaw']:g}°, pitch={pose['pitch']:g}°"


def build_messages(
    prompt: str,
    instruction: str,
    task: str,
    history: list[dict],
    history_images: list[Any],
    current_image: Any,
    *,
    current_pose: dict,
    context_turns: int = 2,
) -> tuple[list[dict], list[Any]]:
    """Build chat messages for one step plus the image list they reference.

    Image parts carry an ``index`` into the returned ``images`` list, so every
    adapter can consume the same message structure. Only the last
    ``context_turns`` completed steps are included.
    """
    images: list[Any] = []
    messages: list[dict] = [
        {"role": "system", "content": [{"type": "text", "text": prompt}]}
    ]

    turns = max(0, int(context_turns))
    recent = list(history)[-turns:] if turns else []
    recent_images = list(history_images)[-len(recent):] if recent else []
    for step, image in zip(recent, recent_images):
        index = len(images)
        images.append(image)
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "image", "index": index},
                    {
                        "type": "text",
                        "text": f"Step {step['t']}. {_direction_text(step['pose'])}",
                    },
                ],
            }
        )
        messages.append(
            {
                "role": "assistant",
                "content": [{"type": "text", "text": str(step.get("raw", ""))}],
            }
        )

    index = len(images)
    images.append(current_image)
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "image", "index": index},
                {
                    "type": "text",
                    "text": (
                        f"Task: {task}\nInstruction: {instruction}\n"
                        f"Current step. {_direction_text(current_pose)}"
                    ),
                },
            ],
        }
    )
    return messages, images
