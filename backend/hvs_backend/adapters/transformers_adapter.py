"""Adapter around an ALREADY LOADED Qwen2.5-VL model + processor.

The notebook owns model loading and passes the live objects into the
constructor. This class never downloads or instantiates weights.
"""

from __future__ import annotations

import importlib
from typing import Any

import numpy as np
from PIL import Image


def _infer_device(model: Any) -> str:
    try:
        return str(next(model.parameters()).device)
    except Exception:
        return "cpu"


def _to_pil(image: Any) -> Any:
    if isinstance(image, Image.Image):
        return image
    return Image.fromarray(np.asarray(image))


def _qwen_content(parts: Any) -> list[dict]:
    """Translate our content parts into Qwen2.5-VL chat-template parts."""
    if isinstance(parts, str):
        return [{"type": "text", "text": parts}]
    content: list[dict] = []
    for part in parts:
        kind = part.get("type")
        if kind == "text":
            content.append({"type": "text", "text": str(part.get("text", ""))})
        elif kind == "image":
            # The image itself is supplied separately via processor(images=...).
            content.append({"type": "image"})
    return content


class TransformersAdapter:
    """Injected-model adapter with fp16-safe inputs and greedy decoding."""

    def __init__(
        self,
        model: Any,
        processor: Any,
        *,
        max_new_tokens: int = 512,
        id: str = "hvs-3b",
        label: str | None = None,
        device: str | None = None,
    ) -> None:
        self.model = model
        self.processor = processor
        self.max_new_tokens = int(max_new_tokens)
        self.id = id
        self.label = label or f"{id} (Qwen2.5-VL)"
        self.device = device or _infer_device(model)
        eval_fn = getattr(model, "eval", None)
        if callable(eval_fn):
            eval_fn()

    def build_conversation(self, messages: list[dict]) -> list[dict]:
        """Build the conversation passed to ``processor.apply_chat_template``."""
        return [
            {"role": message["role"], "content": _qwen_content(message["content"])}
            for message in messages
        ]

    def generate(self, messages: list[dict], images: list) -> str:
        torch = importlib.import_module("torch")

        conversation = self.build_conversation(messages)
        prompt_text = self.processor.apply_chat_template(
            conversation, tokenize=False, add_generation_prompt=True
        )

        processor_kwargs: dict[str, Any] = {
            "text": [prompt_text],
            "return_tensors": "pt",
        }
        if images:
            processor_kwargs["images"] = [_to_pil(image) for image in images]
        inputs = self.processor(**processor_kwargs)

        # fp16-safe: floating inputs must match the injected model's dtype.
        dtype = getattr(self.model, "dtype", None)
        if dtype is None:
            try:
                dtype = next(self.model.parameters()).dtype
            except Exception:
                dtype = None

        prepared: dict[str, Any] = {}
        for key, value in inputs.items():
            if hasattr(value, "to"):
                is_float = getattr(value, "is_floating_point", lambda: False)()
                if is_float and dtype is not None:
                    value = value.to(device=self.device, dtype=dtype)
                else:
                    value = value.to(device=self.device)
            prepared[key] = value

        with torch.no_grad():
            generated = self.model.generate(
                **prepared,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
            )

        input_length = prepared["input_ids"].shape[-1]
        new_tokens = generated[0, input_length:]
        return self.processor.batch_decode([new_tokens], skip_special_tokens=True)[0]
