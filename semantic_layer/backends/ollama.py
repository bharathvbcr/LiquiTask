from __future__ import annotations

from typing import Any, Dict, Optional

from .base import HttpLLMBackend, LLMResponse


class OllamaBackend(HttpLLMBackend):
    """Async wrapper for Ollama /api/generate."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
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
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }
        if system:
            payload["system"] = system

        data, latency_ms = await self._post_json("/api/generate", payload)
        return LLMResponse(
            text=data.get("response", ""),
            model=model,
            latency_ms=latency_ms,
            tokens=data.get("eval_count"),
        )
