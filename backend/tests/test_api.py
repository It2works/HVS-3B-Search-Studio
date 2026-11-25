"""Contract-route tests with FastAPI TestClient and MockAdapter."""

import json
import threading
import time
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from hvs_backend import api as api_module
from hvs_backend.adapters import MockAdapter
from hvs_backend.api import create_app, _replay_events
from hvs_backend.store import EpisodeStore

PROMPT = "Use < think > reasoning < /think > then < answer > rotate(dyaw,dpitch) < /answer >."
HEADERS = {"X-API-Key": "test-key"}
ORIGIN = "http://localhost:5173"


def _png(width=256, height=128):
    buffer = BytesIO()
    Image.new("RGB", (width, height), (20, 30, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def env(tmp_path):
    prompt = tmp_path / "official.txt"
    prompt.write_text(PROMPT, encoding="utf-8")
    runs = tmp_path / "runs"
    adapters = {"mock": MockAdapter()}
    app = create_app(adapters, runs, "test-key", ORIGIN, prompt_path=prompt)
    return SimpleNamespace(app=app, adapters=adapters, runs=runs, prompt=prompt)


@pytest.fixture
def client(env):
    with TestClient(env.app) as test_client:
        yield test_client


def _upload(client, width=256, height=128):
    response = client.post(
        "/api/panoramas",
        files={"file": ("pano.png", _png(width, height), "image/png")},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _episode_payload(pano_id, model="mock", **overrides):
    return {
        "pano_id": pano_id,
        "task": "HOS",
        "instruction": "look for the red exit sign",
        "model": model,
        **overrides,
    }


def _events(response):
    return [
        json.loads(line.removeprefix("data:").strip())
        for line in response.text.splitlines()
        if line.startswith("data:")
    ]


def _finish(client, episode_id):
    response = client.get(f"/api/episodes/{episode_id}/events", headers=HEADERS)
    assert response.status_code == 200
    return _events(response)


def test_api_key_required_on_all_routes(client, env):
    assert client.get("/api/health").status_code == 401
    assert client.get("/api/health", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/api/episodes", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.post("/api/episodes", json={}, headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/api/health", headers=HEADERS).status_code == 200


def test_events_accept_api_key_query_param(client):
    """EventSource cannot send headers; the SSE route accepts api_key in the URL."""
    pano = _upload(client)
    episode_id = client.post(
        "/api/episodes", json=_episode_payload(pano["pano_id"]), headers=HEADERS
    ).json()["episode_id"]
    response = client.get(f"/api/episodes/{episode_id}/events?api_key=test-key")
    assert response.status_code == 200
    assert any(event["type"] == "episode_finished" for event in _events(response))
    assert client.get(
        f"/api/episodes/{episode_id}/events?api_key=wrong"
    ).status_code == 401


def test_health_exact_contract_shape(client):
    body = client.get("/api/health", headers=HEADERS).json()
    assert set(body) == {"gpus", "models"}
    assert isinstance(body["gpus"], list)
    assert len(body["models"]) == 1
    assert body["models"][0] == {
        "id": "mock",
        "label": "Mock (scripted)",
        "loaded": True,
        "device": "cpu",
    }


def test_cors_limited_to_frontend_origin(client):
    allowed = client.get("/api/health", headers={**HEADERS, "Origin": ORIGIN})
    assert allowed.headers.get("access-control-allow-origin") == ORIGIN
    other = client.get("/api/health", headers={**HEADERS, "Origin": "https://evil.test"})
    assert other.headers.get("access-control-allow-origin") is None


def test_upload_validation_and_downsize(client, monkeypatch):
    response = client.post(
        "/api/panoramas",
        files={"file": ("x.txt", b"hello", "text/plain")},
        headers=HEADERS,
    )
    assert response.status_code == 400
    assert "content type" in response.json()["error"]

    monkeypatch.setattr(api_module, "MAX_UPLOAD_BYTES", 100)
    response = client.post(
        "/api/panoramas",
        files={"file": ("big.png", _png(), "image/png")},
        headers=HEADERS,
    )
    assert response.status_code == 400
    assert "40 MB" in response.json()["error"]
    monkeypatch.setattr(api_module, "MAX_UPLOAD_BYTES", 40 * 1024 * 1024)

    monkeypatch.setattr(api_module, "MAX_PANO_WIDTH", 64)
    resized = _upload(client, width=256, height=128)
    assert resized["width"] == 64
    assert resized["height"] == 32

    image = client.get(
        f"/api/panoramas/{resized['pano_id']}/image", headers=HEADERS
    )
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    assert client.get("/api/panoramas/does_not_exist/image", headers=HEADERS).status_code == 404


def test_full_episode_sse_stream(client, env):
    pano = _upload(client)
    response = client.post("/api/episodes", json=_episode_payload(pano["pano_id"]), headers=HEADERS)
    assert response.status_code == 200
    episode_id = response.json()["episode_id"]

    events = _finish(client, episode_id)
    types = [event["type"] for event in events]
    assert types == [
        "episode_started",
        "step_started", "step_completed",
        "step_started", "step_completed",
        "step_started", "step_completed",
        "episode_finished",
    ]
    for event in events:
        if event["type"] == "step_completed":
            assert set(event["step"]) == {
                "t", "pose", "image", "raw", "think", "action", "parse_ok", "latency_ms",
            }
        if event["type"] == "episode_started":
            assert event["episode_id"] == episode_id

    assert events[-1]["result"]["status"] == "submitted"
    assert events[-1]["result"]["final"] == {"yaw": 60.0, "pitch": 0.0}

    run = client.get(f"/api/episodes/{episode_id}", headers=HEADERS).json()
    assert run["result"] == events[-1]["result"]
    assert len(run["steps"]) == 3
    step_image = client.get(
        f"/api/episodes/{episode_id}/steps/1/image", headers=HEADERS
    )
    assert step_image.status_code == 200
    assert step_image.headers["content-type"] == "image/jpeg"
    assert client.get(
        f"/api/episodes/{episode_id}/steps/99/image", headers=HEADERS
    ).status_code == 404

    summaries = client.get("/api/episodes", headers=HEADERS).json()
    assert summaries[0]["id"] == episode_id
    assert summaries[0]["status"] == "submitted"


def test_late_subscriber_replays_stored_steps(client, env):
    pano = _upload(client)
    episode_id = client.post(
        "/api/episodes", json=_episode_payload(pano["pano_id"]), headers=HEADERS
    ).json()["episode_id"]
    _finish(client, episode_id)

    late = _finish(client, episode_id)
    completed = [e for e in late if e["type"] == "step_completed"]
    assert len(completed) == 3
    assert [e["step"]["t"] for e in completed] == [1, 2, 3]
    assert late[-1]["type"] == "episode_finished"


def test_replay_events_from_run_file(tmp_path):
    run = {
        "id": "ep_fixture",
        "steps": [{"t": 1, "pose": {"yaw": 0, "pitch": 0}, "raw": "rotate(1,0)"}],
        "result": {"status": "submitted", "final": {"yaw": 1, "pitch": 0},
                   "success": None, "error": None},
    }
    events = _replay_events(run)
    assert [event["type"] for event in events] == [
        "episode_started", "step_started", "step_completed", "episode_finished"
    ]
    assert events[2]["step"] == run["steps"][0]


def test_cancel_stops_the_episode(tmp_path):
    class SlowAdapter(MockAdapter):
        def generate(self, messages, images):
            time.sleep(0.1)
            return super().generate(messages, images)

    prompt = tmp_path / "official.txt"
    prompt.write_text(PROMPT, encoding="utf-8")
    runs = tmp_path / "runs"
    app = create_app(
        {"mock": SlowAdapter()}, runs, "test-key", ORIGIN, prompt_path=prompt
    )
    with TestClient(app) as client:
        pano = _upload(client)
        episode_id = client.post(
            "/api/episodes", json=_episode_payload(pano["pano_id"]), headers=HEADERS
        ).json()["episode_id"]
        cancelled = client.post(
            f"/api/episodes/{episode_id}/cancel", headers=HEADERS
        )
        assert cancelled.status_code == 200
        assert cancelled.json() == {"episode_id": episode_id, "cancelled": True}

        events = _finish(client, episode_id)
        assert events[-1]["result"]["status"] == "cancelled"
        run = EpisodeStore(runs).load(episode_id)
        assert run["result"]["status"] == "cancelled"
        assert len(run["steps"]) < 3


def test_compare_runs_two_episodes_in_parallel(tmp_path):
    shared = {"active": 0, "peak": 0}
    guard = threading.Lock()

    class TrackingAdapter(MockAdapter):
        def generate(self, messages, images):
            with guard:
                shared["active"] += 1
                shared["peak"] = max(shared["peak"], shared["active"])
            try:
                time.sleep(0.1)
                return super().generate(messages, images)
            finally:
                with guard:
                    shared["active"] -= 1

    prompt = tmp_path / "official.txt"
    prompt.write_text(PROMPT, encoding="utf-8")
    runs = tmp_path / "runs"
    adapters = {"mock": TrackingAdapter(), "mock-sft": TrackingAdapter()}
    app = create_app(adapters, runs, "test-key", ORIGIN, prompt_path=prompt)

    with TestClient(app) as client:
        pano = _upload(client)
        response = client.post(
            "/api/compare",
            json={**_episode_payload(pano["pano_id"]), "models": ["mock", "mock-sft"]},
            headers=HEADERS,
        )
        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"comparison_id", "episodes"}
        assert len(body["episodes"]) == 2

        for episode_id in body["episodes"]:
            assert _finish(client, episode_id)[-1]["result"]["status"] == "submitted"
        assert shared["peak"] >= 2, f"expected overlapping generations, peak={shared['peak']}"


def test_missing_prompt_returns_clean_400(tmp_path):
    runs = tmp_path / "runs"
    app = create_app(
        {"mock": MockAdapter()},
        runs,
        "test-key",
        ORIGIN,
        prompt_path=tmp_path / "no-official-prompt.txt",
    )
    with TestClient(app) as client:
        pano = _upload(client)
        response = client.post(
            "/api/episodes", json=_episode_payload(pano["pano_id"]), headers=HEADERS
        )
        assert response.status_code == 400
        assert response.json() == {"error": "Prompt not configured"}
        assert client.post(
            "/api/compare",
            json={**_episode_payload(pano["pano_id"]), "models": ["mock", "mock"]},
            headers=HEADERS,
        ).status_code == 400
    assert not list(runs.glob("ep_*"))
