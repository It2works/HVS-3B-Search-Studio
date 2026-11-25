"""Tests for official-prompt loading and multi-turn message construction."""

import hashlib

import pytest

from hvs_backend.prompting import (
    PromptNotConfigured,
    build_messages,
    load_official_prompt,
    prompt_sha256,
)

SPACED_PROMPT = (
    "You are a 360 search agent.\n"
    "Reply with < think > reasoning < /think > then < answer > rotate(dyaw,dpitch) < /answer >."
)


def _step(t, yaw, pitch, raw):
    return {"t": t, "pose": {"yaw": yaw, "pitch": pitch}, "raw": raw}


@pytest.mark.parametrize("content", [None, "", "   \n\t "])
def test_missing_or_empty_prompt_raises(tmp_path, content):
    path = tmp_path / "official.txt"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    with pytest.raises(PromptNotConfigured) as exc:
        load_official_prompt(path)
    assert "official" in str(exc.value).lower()


def test_prompt_loaded_verbatim(tmp_path):
    path = tmp_path / "official.txt"
    path.write_text(SPACED_PROMPT, encoding="utf-8")
    assert load_official_prompt(path) == SPACED_PROMPT


def test_prompt_sha256():
    expected = hashlib.sha256(SPACED_PROMPT.encode("utf-8")).hexdigest()
    assert prompt_sha256(SPACED_PROMPT) == expected
    assert len(prompt_sha256(SPACED_PROMPT)) == 64


def test_build_messages_preserves_spaced_tags_and_limits_context():
    history = [
        _step(1, 0, 0, "< think > one < /think > < answer > rotate(10,0) < /answer >"),
        _step(2, 10, 0, "< think > two < /think > < answer > rotate(10,0) < /answer >"),
        _step(3, 20, 0, "< think > three < /think > < answer > rotate(10,0) < /answer >"),
    ]
    images = ["img1", "img2", "img3"]
    messages, model_images = build_messages(
        SPACED_PROMPT,
        "find the red exit sign",
        "HOS",
        history,
        images,
        "current",
        current_pose={"yaw": 30, "pitch": -5},
        context_turns=2,
    )
    assert messages[0]["content"][0]["text"] == SPACED_PROMPT  # verbatim
    assert "< think >" in messages[0]["content"][0]["text"]

    roles = [message["role"] for message in messages]
    assert roles == ["system", "user", "assistant", "user", "assistant", "user"]

    # Only the last two turns are present, with the model's raw text verbatim.
    assert messages[2]["content"][0]["text"] == history[1]["raw"]
    assert messages[4]["content"][0]["text"] == history[2]["raw"]

    current_text = messages[-1]["content"][1]["text"]
    assert "Task: HOS" in current_text
    assert "find the red exit sign" in current_text
    assert "yaw=30" in current_text and "pitch=-5" in current_text

    assert model_images == ["img2", "img3", "current"]
    indices = [
        part["index"]
        for message in messages
        for part in message["content"]
        if part.get("type") == "image"
    ]
    assert indices == list(range(len(model_images)))


def test_build_messages_zero_context():
    messages, model_images = build_messages(
        SPACED_PROMPT,
        "go",
        "HPS",
        [_step(1, 0, 0, "rotate(1,0)")],
        ["old"],
        "now",
        current_pose={"yaw": 0, "pitch": 0},
        context_turns=0,
    )
    assert len(messages) == 2
    assert model_images == ["now"]
