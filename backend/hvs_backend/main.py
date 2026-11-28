"""Local development server backed by the scripted mock model (no GPU).

The Kaggle notebook injects the real models by calling
``create_app(adapters, runs_dir, api_key, frontend_origin)``. This entry point
exists so the API can be exercised locally without a GPU::

    HVS_API_KEY=dev-key make dev-backend

Never use a real key here; this server is for local development only.
"""

from __future__ import annotations

import os
from pathlib import Path

from .adapters import MockAdapter
from .api import create_app

DEFAULT_RUNS_DIR = Path(__file__).resolve().parents[2] / "runs"


def _runs_dir() -> Path:
    configured = os.environ.get("HVS_RUNS_DIR")
    return Path(configured).expanduser() if configured else DEFAULT_RUNS_DIR


_api_key = os.environ.get("HVS_API_KEY", "").strip()
if not _api_key:
    raise RuntimeError(
        "Set HVS_API_KEY before starting the dev server, "
        "for example: HVS_API_KEY=dev-key make dev-backend"
    )

app = create_app(
    {"mock": MockAdapter()},
    _runs_dir(),
    _api_key,
    os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173"),
)
