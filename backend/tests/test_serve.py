"""Tests for the notebook launcher and cloudflared URL parsing."""

from io import StringIO

from hvs_backend import serve
from hvs_backend.adapters import MockAdapter

PROMPT = "Use < think > reasoning < /think > then < answer > rotate(1,0) < /answer >."


def test_extract_public_url():
    line = (
        "2026-11-21T12:00:00Z INF Requesting new quick Tunnel "
        "url=https://calm-lakes-1234.trycloudflare.com"
    )
    assert serve.extract_public_url(line) == "https://calm-lakes-1234.trycloudflare.com"
    assert serve.extract_public_url("cloudflared: connected") is None


def test_start_server_starts_uvicorn_thread_and_can_stop(tmp_path, monkeypatch, capsys):
    prompt = tmp_path / "official.txt"
    prompt.write_text(PROMPT, encoding="utf-8")
    started = {}

    class FakeServer:
        def __init__(self, config):
            self.config = config
            self.started = True
            self.should_exit = False

        def run(self):
            started["ran"] = True

    monkeypatch.setattr(serve.uvicorn, "Server", FakeServer)
    monkeypatch.setattr(serve.uvicorn, "Config", lambda app, **kwargs: {"app": app, **kwargs})

    handle = serve.start_server(
        {"mock": MockAdapter()},
        runs_dir=tmp_path / "runs",
        api_key="test-key",
        frontend_origin="http://localhost:5173",
        prompt_path=prompt,
    )
    assert started["ran"] is True
    assert handle.server.started is True
    assert "Local API: http://127.0.0.1:8000" in capsys.readouterr().out

    handle.stop(timeout=1)
    assert handle.server.should_exit is True
    assert handle.tunnel is None


def test_start_server_requires_key(tmp_path, monkeypatch):
    monkeypatch.delenv("HVS_API_KEY", raising=False)
    try:
        serve.start_server({"mock": MockAdapter()}, api_key="", runs_dir=tmp_path)
    except RuntimeError as exc:
        assert "HVS_API_KEY" in str(exc)
    else:
        raise AssertionError("expected RuntimeError when no API key is available")


def test_tunnel_is_launched_with_expected_command(tmp_path, monkeypatch):
    prompt = tmp_path / "official.txt"
    prompt.write_text(PROMPT, encoding="utf-8")

    class FakeServer:
        def __init__(self, config):
            self.started = True
            self.should_exit = False

        def run(self):
            pass

    class FakeProcess:
        stdout = StringIO("ok\n")
        terminated = False

        def poll(self):
            return None

        def terminate(self):
            self.terminated = True

    calls = []

    def fake_popen(args, **kwargs):
        calls.append((args, kwargs))
        return FakeProcess()

    monkeypatch.setattr(serve.uvicorn, "Server", FakeServer)
    monkeypatch.setattr(serve.uvicorn, "Config", lambda app, **kwargs: {})
    monkeypatch.setattr(serve.subprocess, "Popen", fake_popen)

    handle = serve.start_server(
        {"mock": MockAdapter()},
        runs_dir=tmp_path / "runs",
        api_key="test-key",
        port=8123,
        tunnel=True,
        prompt_path=prompt,
    )
    assert calls[0][0] == ["cloudflared", "tunnel", "--url", "http://localhost:8123"]
    assert handle.tunnel is not None
    handle.stop(timeout=1)
    assert handle.tunnel.terminated is True
