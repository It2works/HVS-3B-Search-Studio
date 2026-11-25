"""Tolerant parser for the model's action text.

This module must never raise: malformed model output is a failed step, not a
crashed episode. The returned shape is stable for the run-file writer:

    {"think": str, "action": dict | None, "parse_ok": bool}
"""

from __future__ import annotations

import re

from .geometry import clamp_pitch, wrap_yaw

# Optional whitespace inside the tag brackets, e.g. "< think >", "< /think >".
_THINK_RE = re.compile(r"<\s*think\s*>(.*?)<\s*/\s*think\s*>", re.IGNORECASE | re.DOTALL)
_ANSWER_RE = re.compile(
    r"<\s*answer\s*>(.*?)<\s*/\s*answer\s*>", re.IGNORECASE | re.DOTALL
)

# "rotate(45, 0)", "SUBMIT ( 90 , -5 )", or a bare "submit".
# group(1) = action name, group(2) = argument list (None when no parentheses).
_ACTION_RE = re.compile(r"\b(rotate|submit)\b\s*(?:\(([^()]*)\))?", re.IGNORECASE)
_NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")

_FAILURE = {"think": "", "action": None, "parse_ok": False}


def _parse_numbers(raw_args: str | None) -> list[float] | None:
    """Return the comma-separated numeric arguments, or None if malformed."""
    if raw_args is None or not raw_args.strip():
        return []
    parts = [part.strip() for part in raw_args.split(",")]
    if any(not part for part in parts):
        return None
    values: list[float] = []
    for part in parts:
        if _NUMBER_RE.fullmatch(part) is None:
            return None
        values.append(float(part))
    return values


def parse_model_output(
    raw_text: str, current_yaw: float, current_pitch: float
) -> dict:
    """Extract the first thought and the first valid action from model output.

    ``<think>``/``<answer>`` tags are optional and whitespace/case tolerant.
    A bare ``submit`` (or ``submit()``) reuses the current pose. Submit yaw is
    wrapped and pitch is clamped. Only the first action found is used.
    """
    try:
        if not isinstance(raw_text, str):
            return dict(_FAILURE)

        think_match = _THINK_RE.search(raw_text)
        think = think_match.group(1).strip() if think_match else ""

        # Remove reasoning before looking for actions so verbs mentioned in a
        # <think> block cannot be mistaken for the chosen action.
        candidate = _THINK_RE.sub(" ", raw_text)
        answer_match = _ANSWER_RE.search(candidate)
        if answer_match:
            candidate = answer_match.group(1)

        action_match = _ACTION_RE.search(candidate)
        if action_match is None:
            return {"think": think, "action": None, "parse_ok": False}

        kind = action_match.group(1).lower()
        values = _parse_numbers(action_match.group(2))
        if values is None:
            return {"think": think, "action": None, "parse_ok": False}

        if kind == "rotate":
            if len(values) != 2:
                return {"think": think, "action": None, "parse_ok": False}
            action: dict = {
                "type": "rotate",
                "dyaw": float(values[0]),
                "dpitch": float(values[1]),
            }
        else:
            if len(values) > 2:
                return {"think": think, "action": None, "parse_ok": False}
            yaw = float(values[0]) if values else float(current_yaw)
            pitch = float(values[1]) if len(values) == 2 else float(current_pitch)
            action = {
                "type": "submit",
                "yaw": wrap_yaw(yaw),
                "pitch": clamp_pitch(pitch),
            }

        return {"think": think, "action": action, "parse_ok": True}
    except Exception:
        return dict(_FAILURE)
