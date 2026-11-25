"""End-to-end agent tests using the GPU-free MockAdapter."""

import asyncio
import threading

import numpy as np
import pytest

from hvs_backend.adapters import MockAdapter
from hvs_backend.agent import run_episode
from hvs_backend.prompting import PromptNotConfigured, prompt_sha256
from hvs_backend.store import EpisodeStore

STEP_KEYS = {"t", "pose", "image", "raw", "think", "action", "parse_ok", "latency_ms"}
RESULT_KEYS = {"status", "final", "success", "error"}
PROMPT = (
    "You are a 360 search agent.\n"
    "Reply with < think > reasoning < /think > then < answer > rotate(dyaw,dpitch) < /answer >."
)


@pytest.fixture
def prompt_file(tmp_path):
    path = tmp_path / "official.txt"
    path.write_text(PROMPT, encoding="utf-8")
    return path


def _collect(episode):
    async def consume():
        return [event async for event in episode]

    return asyncio.run(consume())


def _assert_contract_run(run, prompt=PROMPT):
    assert set(run) == {
        "id", "created_at", "model", "task", "instruction", "pano",
        "config", "ground_truth", "steps", "result",
    }
    assert set(run["pano"]) == {"id", "width", "height", "file"}
    assert set(run["config"]) == {
        "fov", "view_px", "max_steps", "context_turns", "start", "prompt_sha",
    }
    assert set(run["config"]["start"]) == {"yaw", "pitch"}
    assert run["config"]["prompt_sha"] == prompt_sha256(prompt)
    for step in run["steps"]:
        assert set(step) == STEP_KEYS
        assert set(step["pose"]) == {"yaw", "pitch"}
        assert isinstance(step["t"], int)
        assert isinstance(step["latency_ms"], int)
        assert isinstance(step["parse_ok"], bool)
        assert step["image"] == f"step_{step['t']}.jpg"
        assert step["action"]["type"] in {"rotate", "submit"}
    assert set(run["result"]) == RESULT_KEYS
    assert run["result"]["status"] in {"submitted", "max_steps", "error", "cancelled"}
    assert 0.0 <= run["result"]["final"]["yaw"] < 360.0
    assert -90.0 <= run["result"]["final"]["pitch"] <= 90.0


def test_mock_adapter_produces_contract_valid_run(tmp_path, prompt_file):
    store = EpisodeStore(tmp_path / "runs")
    pano = np.zeros((256, 512, 3), dtype=np.uint8)
    events = _collect(
        run_episode(
            pano,
            MockAdapter(),
            task="HOS",
            instruction="look for the red exit sign",
            model="mock",
            store=store,
            prompt_path=prompt_file,
            max_steps=5,
            ground_truth={"yaw": 60, "pitch": 0},
        )
    )

    types = [event["type"] for event in events]
    assert types[0] == "episode_started"
    assert types[-1] == "episode_finished"
    assert types.count("step_started") == 3
    assert types.count("step_completed") == 3

    for event in events:
        if event["type"] == "step_started":
            assert set(event) == {"type", "t", "pose"}
            assert set(event["pose"]) == {"yaw", "pitch"}
        if event["type"] == "step_completed":
            assert set(event) == {"type", "step"}
            assert set(event["step"]) == STEP_KEYS  # exact CONTRACT.md shape

    result = events[-1]["result"]
    assert result["status"] == "submitted"
    assert result["final"] == {"yaw": 60.0, "pitch": 0.0}
    assert result["success"] is True

    episode_id = events[0]["episode_id"]
    run = store.load(episode_id)
    _assert_contract_run(run)
    assert run["result"] == result
    assert [step["t"] for step in run["steps"]] == [1, 2, 3]
    assert run["steps"][0]["pose"] == {"yaw": 0.0, "pitch": 0.0}
    assert store.image_path(episode_id, "panorama.jpg").is_file()
    assert store.image_path(episode_id, "step_1.jpg").is_file()
    assert store.list_summaries()[0]["status"] == "submitted"


def test_bare_submit_uses_current_pose(tmp_path, prompt_file):
    store = EpisodeStore(tmp_path / "runs")
    events = _collect(
        run_episode(
            np.zeros((64, 128, 3), dtype=np.uint8),
            MockAdapter(["< answer > submit < /answer >"]),
            task="HPS",
            instruction="stop here",
            start={"yaw": 350, "pitch": 15},
            store=store,
            prompt_path=prompt_file,
            view_px=64,
        )
    )
    assert events[-1]["result"]["final"] == {"yaw": 350.0, "pitch": 15.0}


def test_cancel_stops_between_steps(tmp_path, prompt_file):
    cancel = threading.Event()

    class CancelAfterFirst(MockAdapter):
        def generate(self, messages, images):
            output = super().generate(messages, images)
            cancel.set()
            return output

    store = EpisodeStore(tmp_path / "runs")
    events = _collect(
        run_episode(
            np.zeros((64, 128, 3), dtype=np.uint8),
            CancelAfterFirst(),
            task="HOS",
            instruction="look",
            store=store,
            prompt_path=prompt_file,
            view_px=64,
            max_steps=8,
            cancel=cancel,
        )
    )
    result = events[-1]["result"]
    assert result["status"] == "cancelled"
    assert result["final"] == {"yaw": 30.0, "pitch": 0.0}
    assert [event["type"] for event in events].count("step_completed") == 1
    run = store.load(events[0]["episode_id"])
    _assert_contract_run(run)
    assert len(run["steps"]) == 1


def test_invalid_output_retries_once_and_continues(tmp_path, prompt_file):
    adapter = MockAdapter(
        [
            "total garbage",
            "< answer > rotate(45, 0) < /answer >",
            "< answer > submit(45, 0) < /answer >",
        ]
    )
    store = EpisodeStore(tmp_path / "runs")
    events = _collect(
        run_episode(
            np.zeros((64, 128, 3), dtype=np.uint8),
            adapter,
            task="HOS",
            instruction="look",
            store=store,
            prompt_path=prompt_file,
            view_px=64,
        )
    )
    assert adapter.calls == 3  # two attempts on step 1, one on step 2
    assert not any(event["type"] == "error" for event in events)
    run = store.load(events[0]["episode_id"])
    assert len(run["steps"]) == 2
    assert run["steps"][0]["raw"] == "< answer > rotate(45, 0) < /answer >"
    assert run["steps"][0]["parse_ok"] is True
    assert events[-1]["result"]["status"] == "submitted"
    _assert_contract_run(run)


def test_double_invalid_output_finishes_with_error(tmp_path, prompt_file):
    adapter = MockAdapter(["garbage", "still garbage"])
    store = EpisodeStore(tmp_path / "runs")
    events = _collect(
        run_episode(
            np.zeros((64, 128, 3), dtype=np.uint8),
            adapter,
            task="HOS",
            instruction="look",
            store=store,
            prompt_path=prompt_file,
            view_px=64,
        )
    )
    assert adapter.calls == 2
    errors = [event for event in events if event["type"] == "error"]
    assert len(errors) == 1
    assert "Invalid model output" in errors[0]["message"]
    assert events[-1]["result"]["status"] == "error"
    run = store.load(events[0]["episode_id"])
    assert run["steps"] == []
    assert run["result"] == events[-1]["result"]
    _assert_contract_run(run)


@pytest.mark.parametrize("write_empty", [False, True])
def test_missing_or_empty_prompt_raises_before_any_event(tmp_path, write_empty):
    path = tmp_path / "official.txt"
    if write_empty:
        path.write_text("   ", encoding="utf-8")
    store = EpisodeStore(tmp_path / "runs")
    with pytest.raises(PromptNotConfigured):
        _collect(
            run_episode(
                np.zeros((64, 128, 3), dtype=np.uint8),
                MockAdapter(),
                task="HOS",
                instruction="look",
                store=store,
                prompt_path=path,
                view_px=64,
            )
        )
    assert not (tmp_path / "runs").exists()
