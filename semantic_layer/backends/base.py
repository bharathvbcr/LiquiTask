from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol, Tuple, runtime_checkable

import httpx


@dataclass
class LLMResponse:
    text: str
    model: str
    latency_ms: float
    tokens: Optional[int] = None


@runtime_checkable
class LLMBackend(Protocol):
    async def generate(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse: ...


class HttpLLMBackend:
    """Shared base for HTTP-backed LLM servers (Ollama, llama.cpp).

    Centralizes base-url normalization, timeout handling, and the
    post-JSON-and-time round trip that every concrete backend repeated.
    """

    def __init__(self, base_url: str, timeout: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def _post_json(
        self, path: str, payload: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], float]:
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(f"{self.base_url}{path}", json=payload)
            resp.raise_for_status()
            data = resp.json()
        latency_ms = (time.perf_counter() - start) * 1000
        return data, latency_ms
