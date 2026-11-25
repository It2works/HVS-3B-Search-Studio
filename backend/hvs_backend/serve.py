"""Notebook-friendly launcher for the API and an optional Cloudflare tunnel."""

from __future__ import annotations

import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import uvicorn

from .api import create_app

_PUBLIC_URL_RE = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
DEFAULT_RUNS_DIR = Path(__file__).resolve().parents[2] / "runs"


def extract_public_url(line: str) -> str | None:
    """Pull the trycloudflare URL out of one line of cloudflared output."""
    match = _PUBLIC_URL_RE.search(line)
    return match.group(0) if match else None


@dataclass
class ServerHandle:
    """Handle returned to the notebook so it can stop both processes."""

    thread: threading.Thread
    server: Any
    tunnel: subprocess.Popen | None = None
    public_url: str | None = None

    def stop(self, timeout: float = 5.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=timeout)
        if self.tunnel is not None and self.tunnel.poll() is None:
            self.tunnel.terminate()


def start_server(
    adapters: dict,
    *,
    runs_dir: str | Path | None = None,
    api_key: str | None = None,
    frontend_origin: str | None = None,
    host: str = "127.0.0.1",
    port: int = 8000,
    tunnel: bool = False,
    prompt_path: str | Path | None = None,
) -> ServerHandle:
    """Start uvicorn in a daemon thread; optionally expose it via cloudflared.

    Defaults come from ``HVS_API_KEY`` and ``FRONTEND_ORIGIN`` in the
    environment. Nothing secret is written to disk.
    """
    key = api_key or os.environ.get("HVS_API_KEY", "")
    if not key:
        raise RuntimeError("Set HVS_API_KEY or pass api_key= to start_server()")
    origin = frontend_origin or os.environ.get(
        "FRONTEND_ORIGIN", "http://localhost:5173"
    )
    runs = Path(runs_dir) if runs_dir is not None else DEFAULT_RUNS_DIR

    app = create_app(adapters, runs, key, origin, Path(prompt_path) if prompt_path else None)
    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="hvs-uvicorn", daemon=True)
    thread.start()

    deadline = time.monotonic() + 30.0
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("uvicorn failed to start")
    print(f"Local API: http://{host}:{port}")

    handle = ServerHandle(thread=thread, server=server)
    if tunnel:
        process = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        handle.tunnel = process

        def watch_output() -> None:
            if process.stdout is None:
                return
            for line in process.stdout:
                print(line, end="")
                url = extract_public_url(line)
                if url and handle.public_url is None:
                    handle.public_url = url
                    print(f"Public URL: {url}")

        threading.Thread(
            target=watch_output, name="hvs-cloudflared", daemon=True
        ).start()
    return handle
