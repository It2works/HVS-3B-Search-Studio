"""Tests for atomic run-file and image storage."""

import json

import numpy as np

from hvs_backend.store import EpisodeStore, new_episode_id, utc_now_iso


def _run(episode_id):
    return {
        "id": episode_id,
        "created_at": utc_now_iso(),
        "model": "mock",
        "task": "HOS",
        "instruction": "find the sign",
        "steps": [],
        "result": {"status": "submitted", "final": {"yaw": 0, "pitch": 0},
                   "success": None, "error": None},
    }


def test_episode_id_shape():
    episode_id = new_episode_id()
    assert episode_id.startswith("ep_")
    assert len(episode_id.split("_")) == 3


def test_save_load_and_atomic_no_temp_files(tmp_path):
    store = EpisodeStore(tmp_path / "runs")
    episode_id = new_episode_id()
    run = _run(episode_id)
    store.save_run(run)

    path = store.image_path(episode_id, "episode.json")
    assert path.is_file()
    assert store.load(episode_id) == run
    assert json.loads(path.read_text(encoding="utf-8")) == run
    assert not list(path.parent.glob("*.tmp"))
    assert not list(path.parent.glob(".*.tmp"))


def test_save_panorama_and_step_image(tmp_path):
    store = EpisodeStore(tmp_path / "runs")
    episode_id = new_episode_id()
    frame = np.zeros((16, 32, 3), dtype=np.uint8)
    frame[0, 0] = (255, 0, 0)

    pano_path = store.save_panorama(episode_id, frame)
    step_path = store.save_image(episode_id, "step_1.jpg", frame)
    assert pano_path.is_file() and step_path.is_file()
    assert pano_path.read_bytes()[:2] == b"\xff\xd8"  # JPEG magic


def test_list_summaries(tmp_path):
    store = EpisodeStore(tmp_path / "runs")
    for model in ("mock", "hvs-3b"):
        episode_id = new_episode_id()
        run = _run(episode_id)
        run["model"] = model
        run["created_at"] = f"2026-11-21T00:00:0{1 if model == 'mock' else 2}+00:00"
        store.save_run(run)
    (store.root / "broken").mkdir()
    (store.root / "broken" / "episode.json").write_text("not json", encoding="utf-8")

    summaries = store.list_summaries()
    assert len(summaries) == 2
    assert summaries[0]["model"] == "hvs-3b"  # newest first
    assert set(summaries[0]) == {
        "id", "created_at", "model", "task", "instruction",
        "status", "success", "step_count", "final",
    }
    assert summaries[0]["status"] == "submitted"
