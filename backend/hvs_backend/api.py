"""FastAPI surface from docs/CONTRACT.md (everything except /bench).

The notebook calls ``create_app(adapters, runs_dir, api_key, frontend_origin)``
with already-loaded model adapters; this module never loads weights and never
reads the API key from anywhere except the caller.
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import threading
from io import BytesIO
from pathlib import Path
from typing import Any, AsyncIterator

import numpy as np
from fastapi import APIRouter, Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .adapters import describe
from .agent import run_episode
from .prompting import PromptNotConfigured, load_official_prompt
from .store import EpisodeStore, new_episode_id

MAX_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_PANO_WIDTH = 4096
VIEW_PX = 448
CONTEXT_TURNS = 2
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class EpisodeRequest(BaseModel):
    pano_id: str
    task: str
    instruction: str
    model: str
    start: dict[str, float] | None = None
    max_steps: int = 8
    fov: float = 90
    ground_truth: dict[str, float] | None = None


class CompareRequest(EpisodeRequest):
    models: list[str]


class EpisodeHub:
    """Fan-out bus: exact events are kept for replay and streamed to subscribers."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self.subscribers: list[asyncio.Queue] = []
        self.closed = False
        self.lock = asyncio.Lock()

    async def publish(self, event: dict) -> None:
        async with self.lock:
            self.events.append(event)
            for queue in self.subscribers:
                queue.put_nowait(event)

    async def subscribe(self) -> tuple[list[dict], asyncio.Queue]:
        async with self.lock:
            snapshot = list(self.events)
            queue: asyncio.Queue = asyncio.Queue()
            self.subscribers.append(queue)
            if self.closed:
                # The episode ended before this subscriber arrived; still send
                # the end sentinel so the SSE generator can finish.
                queue.put_nowait(None)
            return snapshot, queue

    async def unsubscribe(self, queue: asyncio.Queue) -> None:
        async with self.lock:
            if queue in self.subscribers:
                self.subscribers.remove(queue)

    async def close(self) -> None:
        async with self.lock:
            self.closed = True
            for queue in self.subscribers:
                queue.put_nowait(None)

    async def stream(self, queue: asyncio.Queue) -> AsyncIterator[dict]:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def _safe_path(root: Path, identifier: str, suffix: str = ".jpg") -> Path:
    """Build a path inside ``root`` and reject traversal-style ids."""
    if not _SAFE_ID.fullmatch(identifier):
        raise HTTPException(400, {"error": "Invalid id"})
    return root / f"{identifier}{suffix}"


def _replay_events(run: dict) -> list[dict]:
    """Synthesize the contract event stream from a stored run file."""
    events: list[dict] = [
        {"type": "episode_started", "episode_id": run["id"], "run": run}
    ]
    for step in run.get("steps", []):
        events.append({"type": "step_started", "t": step["t"], "pose": step["pose"]})
        events.append({"type": "step_completed", "step": step})
    events.append({"type": "episode_finished", "result": run["result"]})
    return events


def _gpu_list(adapters: dict) -> list[dict]:
    """Report only devices actually claimed by an injected adapter."""
    devices: list[str] = []
    for adapter in adapters.values():
        device = str(getattr(adapter, "device", "unknown"))
        if device not in devices and device.lower() not in {"cpu", "remote", "unknown"}:
            devices.append(device)
    return [{"index": index, "name": name} for index, name in enumerate(devices)]


def create_app(
    adapters: dict,
    runs_dir: Path,
    api_key: str,
    frontend_origin: str,
    prompt_path: Path | None = None,
) -> FastAPI:
    """Build the app. ``prompt_path`` defaults to the official prompt file."""
    app = FastAPI(title="HVS-3B Search Studio API")

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        content = detail if isinstance(detail, dict) and "error" in detail else {"error": str(detail)}
        return JSONResponse(
            status_code=exc.status_code, content=content, headers=exc.headers
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    store = EpisodeStore(runs_dir)
    panorama_dir = Path(runs_dir) / "panoramas"
    prompt_file = Path(prompt_path) if prompt_path is not None else None
    locks = {model_id: asyncio.Lock() for model_id in adapters}
    hubs: dict[str, EpisodeHub] = {}
    tasks: dict[str, asyncio.Task] = {}
    cancels: dict[str, threading.Event] = {}

    def require_api_key(
        x_api_key: str | None = Header(None, alias="X-API-Key"),
        api_key_query: str | None = Query(None, alias="api_key"),
    ) -> None:
        # EventSource cannot set headers, so the SSE route also accepts the key
        # as a query parameter. Both paths use the same constant-time compare.
        supplied = x_api_key or api_key_query
        if supplied is None or not secrets.compare_digest(supplied, api_key):
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing API key",
                headers={"WWW-Authenticate": "X-API-Key"},
            )

    api = APIRouter(prefix="/api", dependencies=[Depends(require_api_key)])

    def check_prompt() -> JSONResponse | None:
        try:
            load_official_prompt(prompt_file)
        except PromptNotConfigured:
            return JSONResponse(
                status_code=400, content={"error": "Prompt not configured"}
            )
        return None

    def episode_path(episode_id: str, filename: str) -> Path:
        if not _SAFE_ID.fullmatch(episode_id):
            raise HTTPException(400, {"error": "Invalid id"})
        return store.image_path(episode_id, filename)

    def load_pano(pano_id: str) -> np.ndarray:
        path = _safe_path(panorama_dir, pano_id)
        if not path.is_file():
            raise HTTPException(404, {"error": "Panorama not found"})
        with Image.open(path) as image:
            return np.asarray(image.convert("RGB"))

    def launch(
        episode_id: str,
        adapter: Any,
        model_id: str,
        payload: EpisodeRequest,
        pano_rgb: np.ndarray,
    ) -> EpisodeHub:
        cancel_event = threading.Event()
        cancels[episode_id] = cancel_event
        hub = EpisodeHub()
        hubs[episode_id] = hub

        async def runner() -> None:
            try:
                async with locks[model_id]:
                    async for event in run_episode(
                        pano_rgb,
                        adapter,
                        task=payload.task,
                        instruction=payload.instruction,
                        model=model_id,
                        episode_id=episode_id,
                        pano_id=payload.pano_id,
                        start=payload.start,
                        max_steps=payload.max_steps,
                        fov=payload.fov,
                        ground_truth=payload.ground_truth,
                        prompt_path=prompt_file,
                        store=store,
                        cancel=cancel_event,
                    ):
                        await hub.publish(event)
            except PromptNotConfigured:
                await hub.publish({"type": "error", "message": "Prompt not configured"})
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await hub.publish(
                    {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
                )
            finally:
                tasks.pop(episode_id, None)
                await hub.close()

        tasks[episode_id] = asyncio.create_task(runner(), name=f"episode-{episode_id}")
        return hub

    @api.get("/health")
    async def health() -> dict:
        return {
            "gpus": _gpu_list(adapters),
            "models": [
                {
                    "id": descriptor["id"],
                    "label": descriptor["label"],
                    "loaded": True,
                    "device": descriptor["device"],
                }
                for descriptor in (describe(adapter) for adapter in adapters.values())
            ],
        }

    @api.post("/panoramas")
    async def upload_panorama(file: UploadFile = File(...)) -> dict:
        content_type = (file.content_type or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(400, {"error": "Unsupported image content type"})
        data = await file.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(400, {"error": "Panorama exceeds 40 MB"})
        try:
            with Image.open(BytesIO(data)) as image:
                rgb = image.convert("RGB")
                if rgb.width > MAX_PANO_WIDTH:
                    height = max(1, round(rgb.height * MAX_PANO_WIDTH / rgb.width))
                    rgb = rgb.resize((MAX_PANO_WIDTH, height), Image.LANCZOS)
                width, height = rgb.size
                pano_id = _new_id("pano")
                path = _safe_path(panorama_dir, pano_id)
                path.parent.mkdir(parents=True, exist_ok=True)
                rgb.save(path, format="JPEG")
        except (OSError, ValueError):
            raise HTTPException(400, {"error": "Invalid image data"})
        return {"pano_id": pano_id, "width": width, "height": height}

    @api.get("/panoramas/{pano_id}/image")
    async def get_panorama_image(pano_id: str) -> FileResponse:
        path = _safe_path(panorama_dir, pano_id)
        if not path.is_file():
            raise HTTPException(404, {"error": "Panorama not found"})
        return FileResponse(path, media_type="image/jpeg")

    @api.post("/episodes")
    async def post_episode(payload: EpisodeRequest) -> dict:
        if payload.task not in {"HOS", "HPS"}:
            raise HTTPException(400, {"error": "Invalid task"})
        adapter = adapters.get(payload.model)
        if adapter is None:
            raise HTTPException(400, {"error": "Unknown model"})
        prompt_error = check_prompt()
        if prompt_error is not None:
            return prompt_error
        pano_rgb = load_pano(payload.pano_id)
        episode_id = new_episode_id()
        launch(episode_id, adapter, payload.model, payload, pano_rgb)
        return {"episode_id": episode_id}

    @api.get("/episodes")
    async def list_episodes() -> list[dict]:
        return store.list_summaries()

    @api.get("/episodes/{episode_id}")
    async def get_episode(episode_id: str) -> dict:
        path = episode_path(episode_id, "episode.json")
        if not path.is_file():
            raise HTTPException(404, {"error": "Episode not found"})
        try:
            return store.load(episode_id)
        except (OSError, ValueError):
            raise HTTPException(404, {"error": "Episode not found"})

    @api.get("/episodes/{episode_id}/events")
    async def episode_events(episode_id: str) -> EventSourceResponse:
        hub = hubs.get(episode_id)
        if hub is None:
            path = episode_path(episode_id, "episode.json")
            if not path.is_file():
                raise HTTPException(404, {"error": "Episode not found"})
            replay = _replay_events(store.load(episode_id))

            async def replay_stream() -> AsyncIterator[dict]:
                for event in replay:
                    yield {"event": event["type"], "data": json.dumps(event)}

            return EventSourceResponse(replay_stream(), ping=None)

        snapshot, queue = await hub.subscribe()

        async def live_stream() -> AsyncIterator[dict]:
            try:
                for event in snapshot:
                    yield {"event": event["type"], "data": json.dumps(event)}
                async for event in hub.stream(queue):
                    yield {"event": event["type"], "data": json.dumps(event)}
            finally:
                await hub.unsubscribe(queue)

        return EventSourceResponse(live_stream(), ping=None)

    @api.post("/episodes/{episode_id}/cancel")
    async def cancel_episode(episode_id: str) -> dict:
        event = cancels.get(episode_id)
        if event is None:
            raise HTTPException(404, {"error": "Episode not found or already finished"})
        event.set()
        return {"episode_id": episode_id, "cancelled": True}

    @api.get("/episodes/{episode_id}/steps/{step_t}/image")
    async def step_image(episode_id: str, step_t: int) -> FileResponse:
        path = episode_path(episode_id, f"step_{step_t}.jpg")
        if not path.is_file():
            raise HTTPException(404, {"error": "Step image not found"})
        return FileResponse(path, media_type="image/jpeg")

    @api.post("/compare")
    async def compare(payload: CompareRequest) -> dict:
        if len(payload.models) != 2 or any(model not in adapters for model in payload.models):
            raise HTTPException(400, {"error": "Compare requires two known models"})
        prompt_error = check_prompt()
        if prompt_error is not None:
            return prompt_error
        pano_rgb = load_pano(payload.pano_id)
        episode_ids = [new_episode_id(), new_episode_id()]
        for episode_id, model_id in zip(episode_ids, payload.models):
            launch(
                episode_id,
                adapters[model_id],
                model_id,
                EpisodeRequest(**payload.model_dump(exclude={"models"})),
                pano_rgb,
            )
        return {"comparison_id": _new_id("cmp"), "episodes": episode_ids}

    app.include_router(api)
    return app
