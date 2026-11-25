"""Atomic on-disk storage for replayable episodes.

Layout: ``runs/<episode_id>/episode.json`` with ``panorama.jpg`` and
``step_<t>.jpg`` beside it. Every write goes to a temp file in the same
directory followed by ``os.replace``, so a crash cannot leave a half-written
run file.
"""

from __future__ import annotations

import json
import os
import secrets
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

DEFAULT_RUNS_ROOT = Path(__file__).resolve().parents[2] / "runs"


def new_episode_id() -> str:
    """Contract-style id, e.g. ``ep_20261121_ab12``."""
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"ep_{day}_{secrets.token_hex(2)}"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def _jpeg_bytes(image: Any) -> bytes:
    pil = image if isinstance(image, Image.Image) else Image.fromarray(np.asarray(image))
    buffer = BytesIO()
    pil.convert("RGB").save(buffer, format="JPEG")
    return buffer.getvalue()


class EpisodeStore:
    """Read/write access to the run directory."""

    def __init__(self, root: str | Path | None = None) -> None:
        self.root = Path(root) if root is not None else DEFAULT_RUNS_ROOT

    def episode_dir(self, episode_id: str) -> Path:
        return self.root / episode_id

    def image_path(self, episode_id: str, filename: str) -> Path:
        return self.episode_dir(episode_id) / filename

    def save_run(self, run: dict) -> Path:
        path = self.image_path(run["id"], "episode.json")
        payload = json.dumps(run, indent=2, ensure_ascii=False).encode("utf-8")
        _atomic_write_bytes(path, payload)
        return path

    def load(self, episode_id: str) -> dict:
        path = self.image_path(episode_id, "episode.json")
        return json.loads(path.read_text(encoding="utf-8"))

    def save_image(self, episode_id: str, filename: str, image: Any) -> Path:
        data = image if isinstance(image, (bytes, bytearray)) else _jpeg_bytes(image)
        path = self.image_path(episode_id, filename)
        _atomic_write_bytes(path, bytes(data))
        return path

    def save_panorama(self, episode_id: str, image: Any) -> Path:
        return self.save_image(episode_id, "panorama.jpg", image)

    def list_summaries(self) -> list[dict]:
        """Compact summaries for ``GET /episodes``, newest first."""
        summaries: list[dict] = []
        for episode_dir in sorted(self.root.glob("ep_*")):
            path = episode_dir / "episode.json"
            if not path.is_file():
                continue
            try:
                run = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            result = run.get("result", {})
            final = result.get("final")
            summaries.append(
                {
                    "id": run.get("id", episode_dir.name),
                    "created_at": run.get("created_at"),
                    "model": run.get("model"),
                    "task": run.get("task"),
                    "instruction": run.get("instruction"),
                    "status": result.get("status"),
                    "success": result.get("success"),
                    "step_count": len(run.get("steps", [])),
                    "final": dict(final) if isinstance(final, dict) else None,
                }
            )
        summaries.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return summaries
