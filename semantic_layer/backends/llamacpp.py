from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import HttpLLMBackend, LLMResponse


class LlamaCppBackend(HttpLLMBackend):
    """
    Async wrapper for llama.cpp server OpenAI-compatible /v1/chat/completions API.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        timeout: float = 120.0,
    ) -> None:
        super().__init__(base_url, timeout)

    async def generate(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        data, latency_ms = await self._post_json("/v1/chat/completions", payload)
        choices = data.get("choices", [])
        text = ""
        if choices:
            text = choices[0].get("message", {}).get("content", "")

        usage = data.get("usage", {})
        tokens = usage.get("completion_tokens")

        return LLMResponse(
            text=text,
            model=model,
            latency_ms=latency_ms,
            tokens=tokens,
        )
