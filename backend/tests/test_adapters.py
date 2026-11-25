"""Tests for adapter descriptors, scripts, and payload construction."""

import json

import httpx
import numpy as np
import pytest

from hvs_backend.adapters import (
    MockAdapter,
    OpenAICompatAdapter,
    TransformersAdapter,
    describe,
)

MESSAGES = [
    {"role": "system", "content": [{"type": "text", "text": "< think > official < /think >"}]},
    {
        "role": "user",
        "content": [
            {"type": "image", "index": 0},
            {"type": "text", "text": "look for the exit"},
        ],
    },
]
IMAGES = [np.zeros((8, 8, 3), dtype=np.uint8)]


@pytest.mark.parametrize(
    "adapter",
    [
        MockAdapter(),
        OpenAICompatAdapter("http://localhost:8000/v1", "qwen"),
        TransformersAdapter(object(), object()),
    ],
)
def test_descriptor_has_exact_shape(adapter):
    assert set(describe(adapter)) == {"id", "label", "device"}
    assert all(isinstance(value, str) for value in describe(adapter).values())


def test_mock_adapter_is_deterministic_and_scripts_rotation_then_submit():
    first = MockAdapter()
    second = MockAdapter()
    outputs_first = [first.generate(MESSAGES, IMAGES) for _ in range(4)]
    outputs_second = [second.generate(MESSAGES, IMAGES) for _ in range(4)]
    assert outputs_first == outputs_second
    assert "rotate(30, 0)" in outputs_first[0]
    assert "rotate(30, 0)" in outputs_first[1]
    assert "submit" in outputs_first[2]
    assert outputs_first[3] == outputs_first[2]  # last script line repeats
    assert first.calls == 4


def test_transformers_adapter_uses_injected_objects_only():
    class FakeModel:
        dtype = "fp16"

        def __init__(self):
            self.eval_called = False

        def eval(self):
            self.eval_called = True

        def parameters(self):
            raise AssertionError("parameters() should not be needed when dtype is set")

    class FakeProcessor:
        pass

    model, processor = FakeModel(), FakeProcessor()
    adapter = TransformersAdapter(model, processor, max_new_tokens=128)
    assert adapter.model is model
    assert adapter.processor is processor
    assert adapter.max_new_tokens == 128
    assert model.eval_called is True
    assert adapter.device == "cpu"

    conversation = adapter.build_conversation(MESSAGES)
    assert conversation[0]["content"] == [
        {"type": "text", "text": "< think > official < /think >"}
    ]
    assert conversation[1]["content"] == [
        {"type": "image"},
        {"type": "text", "text": "look for the exit"},
    ]


def test_openai_adapter_builds_data_uri_payload_and_returns_text():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "< answer > submit < /answer >"}}]},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = OpenAICompatAdapter(
        "http://localhost:8000/v1", "qwen", api_key="secret", client=client
    )
    result = adapter.generate(MESSAGES, IMAGES)
    assert result == "< answer > submit < /answer >"
    assert seen["path"] == "/v1/chat/completions"
    assert seen["auth"] == "Bearer secret"
    assert seen["body"]["model"] == "qwen"
    assert seen["body"]["temperature"] == 0
    image_part = seen["body"]["messages"][1]["content"][0]
    assert image_part["type"] == "image_url"
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")
