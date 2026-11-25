"""Async episode runner. Yields the exact SSE event payloads from CONTRACT.md."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, AsyncIterator

from .adapters import ModelAdapter, describe
from .geometry import check_success, clamp_pitch, wrap_yaw
from .panorama import render_view
from .parser import parse_model_output
from .prompting import build_messages, load_official_prompt, prompt_sha256
from .store import EpisodeStore, new_episode_id, utc_now_iso

STEP_KEYS = ("t", "pose", "image", "raw", "think", "action", "parse_ok", "latency_ms")
RESULT_KEYS = ("status", "final", "success", "error")


def _cancelled(flag: Any) -> bool:
    """Accept a threading.Event, an asyncio.Event-like object, or a callable."""
    if flag is None:
        return False
    is_set = getattr(flag, "is_set", None)
    if callable(is_set):
        return bool(is_set())
    if callable(flag):
        return bool(flag())
    return False


def _make_result(
    status: str,
    yaw: float,
    pitch: float,
    *,
    success: bool | None = None,
    error: str | None = None,
) -> dict:
    return {
        "status": status,
        "final": {"yaw": yaw, "pitch": pitch},
        "success": success,
        "error": error,
    }


async def run_episode(
    pano_rgb: Any,
    adapter: ModelAdapter,
    *,
    task: str,
    instruction: str,
    model: str | None = None,
    episode_id: str | None = None,
    pano_id: str = "pano_x",
    start: dict | None = None,
    max_steps: int = 8,
    fov: float = 90,
    view_px: int = 448,
    context_turns: int = 2,
    ground_truth: dict | None = None,
    prompt_path: str | Path | None = None,
    store: EpisodeStore | None = None,
    cancel: Any = None,
) -> AsyncIterator[dict]:
    """Run one episode, persisting it step by step for replay.

    Events (each a JSON-serializable dict) in order:
    ``episode_started``, ``step_started {t,pose}``, ``step_completed {step}``
    (repeated), ``episode_finished {result}``; ``error {message}`` may precede
    the final event. A missing official prompt raises before the first event.
    """
    # Fail before creating any files or events: no prompt, no live episode.
    prompt = load_official_prompt(prompt_path)

    episode_id = episode_id or new_episode_id()
    store = store or EpisodeStore()
    start = start or {}
    yaw = wrap_yaw(float(start.get("yaw", 0.0)))
    pitch = clamp_pitch(float(start.get("pitch", 0.0)))
    max_steps = int(max_steps)
    view_px = int(view_px)
    fov = float(fov)
    context_turns = int(context_turns)

    def evaluate(pose_yaw: float, pose_pitch: float) -> bool | None:
        if not isinstance(ground_truth, dict):
            return None
        try:
            return check_success(
                task,
                pose_yaw,
                pose_pitch,
                float(ground_truth["yaw"]),
                float(ground_truth["pitch"]),
            )
        except (KeyError, TypeError, ValueError):
            return None

    run: dict[str, Any] = {
        "id": episode_id,
        "created_at": utc_now_iso(),
        "model": model or describe(adapter)["id"],
        "task": task,
        "instruction": instruction,
        "pano": {
            "id": pano_id,
            "width": int(pano_rgb.shape[1]),
            "height": int(pano_rgb.shape[0]),
            "file": "panorama.jpg",
        },
        "config": {
            "fov": fov,
            "view_px": view_px,
            "max_steps": max_steps,
            "context_turns": context_turns,
            "start": {"yaw": yaw, "pitch": pitch},
            "prompt_sha": prompt_sha256(prompt),
        },
        "ground_truth": ground_truth,
        "steps": [],
        "result": _make_result("error", yaw, pitch, error="episode did not finish"),
    }
    store.save_panorama(episode_id, pano_rgb)
    store.save_run(run)
    yield {"type": "episode_started", "episode_id": episode_id, "run": dict(run)}

    loop = asyncio.get_running_loop()
    history_images: list[Any] = []

    async def generate(messages: list[dict], images: list) -> str:
        return await loop.run_in_executor(None, adapter.generate, messages, images)

    for t in range(1, max_steps + 1):
        if _cancelled(cancel):
            break

        pose = {"yaw": yaw, "pitch": pitch}
        started_at = time.perf_counter()
        try:
            view = render_view(pano_rgb, yaw, pitch, fov, view_px)
            image_name = f"step_{t}.jpg"
            store.save_image(episode_id, image_name, view)
            messages, model_images = build_messages(
                prompt,
                instruction,
                task,
                run["steps"],
                history_images,
                view,
                current_pose=pose,
                context_turns=context_turns,
            )
            yield {"type": "step_started", "t": t, "pose": dict(pose)}

            raw = await generate(messages, model_images)
            parsed = parse_model_output(raw, yaw, pitch)
            if not parsed["parse_ok"]:
                # One retry at the same pose with the same context.
                raw = await generate(messages, model_images)
                parsed = parse_model_output(raw, yaw, pitch)
                if not parsed["parse_ok"]:
                    message = f"Invalid model output at step {t} after one retry"
                    yield {"type": "error", "message": message}
                    run["result"] = _make_result("error", yaw, pitch, error=message)
                    store.save_run(run)
                    yield {"type": "episode_finished", "result": dict(run["result"])}
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            message = f"{type(exc).__name__}: {exc}"
            yield {"type": "error", "message": message}
            run["result"] = _make_result("error", yaw, pitch, error=message)
            store.save_run(run)
            yield {"type": "episode_finished", "result": dict(run["result"])}
            return

        action = parsed["action"]
        if not isinstance(action, dict) or action.get("type") not in {"rotate", "submit"}:
            message = f"Invalid action at step {t}"
            yield {"type": "error", "message": message}
            run["result"] = _make_result("error", yaw, pitch, error=message)
            store.save_run(run)
            yield {"type": "episode_finished", "result": dict(run["result"])}
            return

        kind = action["type"]
        if kind == "rotate":
            yaw = wrap_yaw(yaw + float(action.get("dyaw", 0.0)))
            pitch = clamp_pitch(pitch + float(action.get("dpitch", 0.0)))
        else:
            # Rule 2: parser already defaults bare submit to the current pose,
            # but never crash if a caller supplies an incomplete action.
            yaw = wrap_yaw(float(action.get("yaw", yaw)))
            pitch = clamp_pitch(float(action.get("pitch", pitch)))

        step = {
            "t": t,
            "pose": dict(pose),
            "image": image_name,
            "raw": raw,
            "think": parsed["think"],
            "action": dict(action),
            "parse_ok": bool(parsed["parse_ok"]),
            "latency_ms": int(round((time.perf_counter() - started_at) * 1000)),
        }
        run["steps"].append(step)
        history_images.append(view)
        store.save_run(run)
        yield {"type": "step_completed", "step": dict(step)}

        if kind == "submit":
            run["result"] = _make_result(
                "submitted", yaw, pitch, success=evaluate(yaw, pitch)
            )
            break
    else:
        run["result"] = _make_result(
            "max_steps", yaw, pitch, success=evaluate(yaw, pitch)
        )

    if _cancelled(cancel) and run["result"]["status"] != "submitted":
        run["result"] = _make_result("cancelled", yaw, pitch)

    store.save_run(run)
    yield {"type": "episode_finished", "result": dict(run["result"])}
