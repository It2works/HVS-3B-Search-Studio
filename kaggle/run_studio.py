"""Kaggle notebook helper for HVS-3B Search Studio.

Copy this file into the notebook's working directory (or put the cloned repo's
``kaggle/`` folder on ``sys.path``) and import it as ``run_studio``. All
``hvs_backend`` imports are deliberately lazy: cells import this module BEFORE
the backend zip is pip-installed.

This module owns the threading/subprocess work so the notebook cells stay
small. It never loads model weights and never writes secrets to disk.
"""

from __future__ import annotations

import os
import re
import subprocess
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_PUBLIC_URL_RE = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
_CLOUDFLARED_URL = (
    "https://github.com/cloudflare/cloudflared/releases/latest/download/"
    "cloudflared-linux-amd64"
)


@dataclass
class StudioHandle:
    """Live server + optional tunnel, with a single ``stop()``."""

    server: Any
    thread: threading.Thread
    tunnel: subprocess.Popen | None = None
    public_url: str | None = None

    def stop(self, timeout: float = 5.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=timeout)
        if self.tunnel is not None and self.tunnel.poll() is None:
            self.tunnel.terminate()


def kill_existing_processes(*, port: int = 8000, patterns: tuple[str, ...] = ("uvicorn", "cloudflared")) -> None:
    """Free the port and clear stale binaries between notebook runs.

    Avoids the classic Kaggle errors ``address already in use`` and
    ``Text file busy`` when a previous cell left a server or tunnel running.
    """
    for pattern in patterns:
        try:
            subprocess.run(
                ["pkill", "-f", pattern],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            pass
    try:
        subprocess.run(
            ["fuser", "-k", f"{port}/tcp"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass
    time.sleep(1.0)
    print(f"Cleared existing uvicorn/cloudflared processes on port {port}.")


def install_cloudflared(dest: str | Path | None = None) -> Path:
    """wget + chmod the cloudflared binary and put it on ``PATH``."""
    target = Path(dest) if dest is not None else Path("/usr/local/bin/cloudflared")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        target = Path("/kaggle/working/cloudflared")
        target.parent.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        ["wget", "-q", "-O", str(target), _CLOUDFLARED_URL], check=True
    )
    target.chmod(0o755)
    os.environ["PATH"] = f"{target.parent}{os.pathsep}{os.environ.get('PATH', '')}"
    subprocess.run([str(target), "--version"], check=False)
    print(f"cloudflared installed at {target}")
    return target


def verify_backend_installed() -> Path:
    """Fail early with a clear message if the backend zip was not installed."""
    import hvs_backend
    from hvs_backend.api import create_app  # noqa: F401
    from hvs_backend.adapters import TransformersAdapter  # noqa: F401

    location = Path(hvs_backend.__file__).resolve()
    print(f"hvs_backend installed from {location}")
    return location


def get_api_key(label: str = "HVS_API_KEY") -> str:
    """Read the key from Kaggle Secrets; fall back to the process environment."""
    key = ""
    try:
        from kaggle_secrets import UserSecretsClient

        try:
            key = UserSecretsClient().get_secret(label)
        except Exception as exc:
            raise RuntimeError(
                f"Add {label} to this notebook's Kaggle Secrets: {exc}"
            ) from exc
    except ImportError:
        key = os.environ.get(label, "")
    if not key or not key.strip():
        raise RuntimeError(f"{label} is empty. Add it to Kaggle Secrets.")
    os.environ[label] = key  # so `!curl -H "X-API-Key: $HVS_API_KEY" ...` works
    return key


def build_adapters(
    model_sft: Any,
    proc_sft: Any,
    model_rl: Any,
    proc_rl: Any,
    *,
    device_sft: str = "cuda:0",
    device_rl: str = "cuda:1",
    max_new_tokens: int = 512,
) -> dict[str, Any]:
    """Wrap the ALREADY LOADED models. No weights are loaded or moved here."""
    from hvs_backend.adapters import TransformersAdapter

    return {
        "hvs-3b-sft": TransformersAdapter(
            model_sft,
            proc_sft,
            id="hvs-3b-sft",
            label="HVS-3B SFT",
            device=device_sft,
            max_new_tokens=max_new_tokens,
        ),
        "hvs-3b": TransformersAdapter(
            model_rl,
            proc_rl,
            id="hvs-3b",
            label="HVS-3B RL",
            device=device_rl,
            max_new_tokens=max_new_tokens,
        ),
    }


def install_official_prompt(source_path: str | Path) -> Path:
    """Copy the user-supplied official prompt into the installed backend.

    Refuses to continue on a missing or empty file — the backend must never
    invent a fallback prompt.
    """
    import hashlib

    from hvs_backend.prompting import OFFICIAL_PROMPT_PATH

    source = Path(source_path).expanduser()
    if not source.is_file():
        raise FileNotFoundError(f"Official prompt not found at {source}")
    text = source.read_text(encoding="utf-8")
    if not text.strip():
        raise RuntimeError(f"Official prompt at {source} is empty; refusing to continue.")

    target = Path(OFFICIAL_PROMPT_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(
        f"Prompt installed at {target} "
        f"(sha256={hashlib.sha256(text.encode('utf-8')).hexdigest()})"
    )
    return target


def start_studio(
    app: Any,
    api_key: str,
    *,
    tunnel: bool = True,
    host: str = "127.0.0.1",
    port: int = 8000,
    url_timeout: float = 120.0,
) -> StudioHandle:
    """Run uvicorn in a daemon thread, optionally open a cloudflared tunnel."""
    import uvicorn

    os.environ["HVS_API_KEY"] = api_key
    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="hvs-uvicorn", daemon=True)
    thread.start()

    deadline = time.monotonic() + 30.0
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("uvicorn failed to start (is port 8000 still in use?)")

    handle = StudioHandle(server=server, thread=thread)
    local_url = f"http://{host}:{port}"

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
                match = _PUBLIC_URL_RE.search(line)
                if match and handle.public_url is None:
                    handle.public_url = match.group(0)
                    print(f"Public URL: {handle.public_url}")

        threading.Thread(target=watch_output, name="hvs-cloudflared", daemon=True).start()

        deadline = time.monotonic() + url_timeout
        while handle.public_url is None and time.monotonic() < deadline:
            time.sleep(0.5)
        if handle.public_url is None:
            raise RuntimeError(
                "cloudflared did not print a trycloudflare.com URL; "
                "check the tunnel output above"
            )

    public = handle.public_url or local_url
    print("\nReady. Health-check command (paste into a notebook cell):")
    print(f'!curl -H "X-API-Key: $HVS_API_KEY" {public}/api/health\n')
    return handle


def export_runs(runs_dir: str | Path, output: str | Path | None = None) -> Path:
    """Zip ``runs/`` into /kaggle/working for download into the frontend demo."""
    source = Path(runs_dir)
    if not source.is_dir():
        raise FileNotFoundError(f"Runs directory not found: {source}")
    target = Path(output) if output is not None else Path("/kaggle/working/hvs_runs.zip")
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source))
    print(f"Exported {source} -> {target} ({target.stat().st_size} bytes)")
    return target
