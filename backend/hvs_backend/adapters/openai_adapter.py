"""OpenAI-compatible /chat/completions adapter for a future vLLM server."""

from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import httpx
import numpy as np
from PIL import Image


def _data_uri(image: Any) -> str:
    """Encode an RGB frame as a JPEG data URI for the OpenAI image_url part."""
    if isinstance(image, Image.Image):
        pil = image.convert("RGB")
    else:
        pil = Image.fromarray(np.asarray(image)).convert("RGB")
    buffer = BytesIO()
    pil.save(buffer, format="JPEG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


class OpenAICompatAdapter:
    """Talks to an OpenAI-compatible endpoint. No credentials are stored on disk."""

    id = "openai-compatible"
    label = "OpenAI-compatible endpoint"
    device = "remote"

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        api_key: str | None = None,
        max_new_tokens: int = 512,
        timeout: float = 60.0,
        client: httpx.Client | None = None,
        id: str | None = None,
        label: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.max_new_tokens = int(max_new_tokens)
        self._client = client or httpx.Client(timeout=float(timeout))
        if id is not None:
            self.id = id
        if label is not None:
            self.label = label

    def build_payload_messages(self, messages: list[dict], images: list) -> list[dict]:
        """Convert our parts to OpenAI text / image_url content parts."""
        payload: list[dict] = []
        for message in messages:
            raw_parts = message["content"]
            if isinstance(raw_parts, str):
                raw_parts = [{"type": "text", "text": raw_parts}]
            content: list[dict] = []
            for part in raw_parts:
                if part.get("type") == "text":
                    content.append({"type": "text", "text": str(part.get("text", ""))})
                elif part.get("type") == "image":
                    index = int(part.get("index", 0))
                    content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": _data_uri(images[index])},
                        }
                    )
            payload.append({"role": message["role"], "content": content})
        return payload

    def generate(self, messages: list[dict], images: list) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = self._client.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json={
                "model": self.model,
                "messages": self.build_payload_messages(messages, images),
                "max_tokens": self.max_new_tokens,
                "temperature": 0,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"] or ""
