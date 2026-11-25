"""Tests for the Kaggle notebook helper (no Kaggle runtime required)."""

import os
import sys
import zipfile
from io import StringIO
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "kaggle"))
import run_studio as studio  # noqa: E402

PROMPT = "Use < think > reasoning < /think > then < answer > rotate(1,0) < /answer >."


def test_kill_existing_processes(monkeypatch):
    calls = []
    monkeypatch.setattr(studio.subprocess, "run", lambda args, **kwargs: calls.append(args))
    monkeypatch.setattr(studio.time, "sleep", lambda _: None)
    studio.kill_existing_processes(port=8000)
    assert ["pkill", "-f", "uvicorn"] in calls
    assert ["pkill", "-f", "cloudflared"] in calls
    assert ["fuser", "-k", "8000/tcp"] in calls


def test_install_cloudflared(tmp_path, monkeypatch):
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[0] == "wget":
            destination = Path(args[3])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"binary")

    monkeypatch.setattr(studio.subprocess, "run", fake_run)
    target = studio.install_cloudflared(tmp_path / "bin" / "cloudflared")
    assert target.is_file()
    assert target.stat().st_mode & 0o111
    assert calls[0][0] == "wget" and calls[0][4] == studio._CLOUDFLARED_URL
    assert calls[1][0] == str(target) and calls[1][1] == "--version"
    assert str(tmp_path / "bin") in os.environ["PATH"]


def test_get_api_key_from_env(monkeypatch):
    monkeypatch.setenv("HVS_TEST_KEY", "abc123")
    assert studio.get_api_key("HVS_TEST_KEY") == "abc123"
    monkeypatch.setenv("HVS_TEST_KEY", "   ")
    with pytest.raises(RuntimeError):
        studio.get_api_key("HVS_TEST_KEY")


def test_build_adapters_uses_injected_models():
    class FakeModel:
        def __init__(self):
            self.eval_called = False

        def eval(self):
            self.eval_called = True

    sft, rl = FakeModel(), FakeModel()
    adapters = studio.build_adapters(sft, object(), rl, object())
    assert list(adapters) == ["hvs-3b-sft", "hvs-3b"]
    assert adapters["hvs-3b-sft"].id == "hvs-3b-sft"
    assert adapters["hvs-3b-sft"].label == "HVS-3B SFT"
    assert adapters["hvs-3b-sft"].device == "cuda:0"
    assert adapters["hvs-3b"].device == "cuda:1"
    assert sft.eval_called and rl.eval_called


def test_install_official_prompt_refuses_empty_and_writes_file(tmp_path, monkeypatch):
    import hvs_backend.prompting as prompting

    target = tmp_path / "installed" / "official.txt"
    monkeypatch.setattr(prompting, "OFFICIAL_PROMPT_PATH", target)

    missing = tmp_path / "missing.txt"
    with pytest.raises(FileNotFoundError):
        studio.install_official_prompt(missing)

    empty = tmp_path / "empty.txt"
    empty.write_text("   ", encoding="utf-8")
    with pytest.raises(RuntimeError, match="empty"):
        studio.install_official_prompt(empty)

    source = tmp_path / "official.txt"
    source.write_text(PROMPT, encoding="utf-8")
    assert studio.install_official_prompt(source) == target
    assert target.read_text(encoding="utf-8") == PROMPT


def test_export_runs(tmp_path):
    runs = tmp_path / "runs"
    episode = runs / "ep_1"
    episode.mkdir(parents=True)
    (episode / "episode.json").write_text("{}", encoding="utf-8")
    (episode / "step_1.jpg").write_bytes(b"\xff\xd8")

    output = studio.export_runs(runs, tmp_path / "hvs_runs.zip")
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == {"ep_1/episode.json", "ep_1/step_1.jpg"}


def test_start_studio_prints_url_and_curl(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HVS_API_KEY", "test-key")

    class FakeServer:
        def __init__(self, config):
            self.config = config
            self.started = True
            self.should_exit = False

        def run(self):
            pass

    class FakeProcess:
        stdout = StringIO("INF url=https://calm-lakes-1234.trycloudflare.com\n")

        def poll(self):
            return None

        def terminate(self):
            pass

    launches = []

    def fake_popen(args, **kwargs):
        launches.append(args)
        return FakeProcess()

    import uvicorn

    monkeypatch.setattr(uvicorn, "Server", FakeServer)
    monkeypatch.setattr(uvicorn, "Config", lambda app, **kwargs: {"app": app, **kwargs})
    monkeypatch.setattr(studio.subprocess, "Popen", fake_popen)

    handle = studio.start_studio(object(), "test-key", port=8000, tunnel=True)
    assert handle.public_url == "https://calm-lakes-1234.trycloudflare.com"
    assert launches[0] == ["cloudflared", "tunnel", "--url", "http://localhost:8000"]
    output = capsys.readouterr().out
    assert "Public URL: https://calm-lakes-1234.trycloudflare.com" in output
    assert 'curl -H "X-API-Key: $HVS_API_KEY" https://calm-lakes-1234.trycloudflare.com/api/health' in output
    handle.stop(timeout=1)
    assert handle.server.should_exit is True
