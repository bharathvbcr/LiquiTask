"""FastAPI sidecar exposing SemanticOrchestrator to LiquiTask."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ._frozen import configure_frozen_environment
from .backends.ollama import OllamaBackend
from .config import SemanticLayerConfig
from .orchestrator import SemanticOrchestrator

DEFAULT_PORT = 8765
DEFAULT_HOST = "127.0.0.1"


def _default_cache_dir() -> str:
    return str(Path.home() / ".liquitask" / "semantic-layer")


_runtime_config = SemanticLayerConfig(cache_persist_path=_default_cache_dir())
_ollama_base_url = "http://127.0.0.1:11434"
_orchestrator: Optional[SemanticOrchestrator] = None
_orchestrator_lock = asyncio.Lock()

# DNS-rebinding guard: only accept requests whose Host header targets loopback.
_ALLOWED_HOST_PREFIXES = ("127.0.0.1", "localhost", "[::1]", "::1")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    # Flush cache + OOD state to disk on shutdown so hit-rate survives restarts.
    if _orchestrator is not None:
        _orchestrator.save_state()


app = FastAPI(title="LiquiTask Semantic Layer", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def _restrict_host(request: Request, call_next):  # type: ignore[no-untyped-def]
    host = (request.headers.get("host") or "").split(":")[0].strip("[]")
    if host and not any(host == p.strip("[]") for p in _ALLOWED_HOST_PREFIXES):
        return JSONResponse(status_code=403, content={"detail": "forbidden host"})
    return await call_next(request)


class RagDocument(BaseModel):
    id: str
    content: str


class SemanticLayerConfigUpdate(BaseModel):
    cache_initial_threshold: Optional[float] = None
    cache_max_entries: Optional[int] = None
    enable_cache: Optional[bool] = None
    enable_compression: Optional[bool] = None
    small_model: Optional[str] = None
    medium_model: Optional[str] = None
    large_model: Optional[str] = None
    ollama_base_url: Optional[str] = None


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    system_prompt: str = ""
    rag_documents: Optional[List[RagDocument]] = None
    temperature: float = 0.4
    max_tokens: int = 2048
    tools_version: str = "v0"
    doc_version: str = "v1"
    ollama_base_url: Optional[str] = None


class ChatResponse(BaseModel):
    text: str
    cache_entry_id: Optional[str] = None
    cache_hit: bool = False
    model_used: str = ""
    metrics: Dict[str, Any] = Field(default_factory=dict)


class FeedbackRequest(BaseModel):
    entry_id: str
    accepted: bool
    similarity: float = 1.0


class HealthResponse(BaseModel):
    status: str
    version: str


def _apply_config_update(update: SemanticLayerConfigUpdate) -> SemanticLayerConfig:
    """Update runtime config and hot-reload it into the live orchestrator.

    Crucially this does NOT discard the orchestrator: doing so used to wipe the
    entire semantic cache and OOD statistics on every settings sync. The
    embedding model/device are not editable here, so an in-place `apply_config`
    is always sufficient — the cache, OOD state, and calibrated threshold are
    preserved.
    """
    global _runtime_config, _ollama_base_url

    _runtime_config = replace(
        _runtime_config,
        cache_initial_threshold=update.cache_initial_threshold
        if update.cache_initial_threshold is not None
        else _runtime_config.cache_initial_threshold,
        cache_max_entries=update.cache_max_entries
        if update.cache_max_entries is not None
        else _runtime_config.cache_max_entries,
        enable_cache=update.enable_cache
        if update.enable_cache is not None
        else _runtime_config.enable_cache,
        enable_compression=update.enable_compression
        if update.enable_compression is not None
        else _runtime_config.enable_compression,
        small_model=update.small_model or _runtime_config.small_model,
        medium_model=update.medium_model or _runtime_config.medium_model,
        large_model=update.large_model or _runtime_config.large_model,
    )

    if update.ollama_base_url:
        _ollama_base_url = update.ollama_base_url.rstrip("/")

    if _orchestrator is not None:
        _orchestrator.apply_config(_runtime_config)

    return _runtime_config


async def _get_orchestrator(ollama_url: Optional[str] = None) -> SemanticOrchestrator:
    global _orchestrator

    backend_url = (ollama_url or _ollama_base_url).rstrip("/")
    async with _orchestrator_lock:
        if _orchestrator is None:
            _orchestrator = SemanticOrchestrator(
                _runtime_config,
                backend=OllamaBackend(base_url=backend_url),
            )
        elif getattr(_orchestrator.backend, "base_url", "") != backend_url:
            # Backend switched: persist the current cache, then rebuild against
            # the new URL (the new orchestrator reloads the same persisted state).
            _orchestrator.save_state()
            _orchestrator = SemanticOrchestrator(
                _runtime_config,
                backend=OllamaBackend(base_url=backend_url),
            )
        # Config is applied via /v1/config, not on every chat — see C-2.
        return _orchestrator


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    from . import __version__

    return HealthResponse(status="ok", version=__version__)


@app.post("/v1/config")
async def update_config(update: SemanticLayerConfigUpdate) -> Dict[str, Any]:
    config = _apply_config_update(update)
    return {
        "ok": True,
        "cache_initial_threshold": config.cache_initial_threshold,
        "cache_max_entries": config.cache_max_entries,
        "enable_cache": config.enable_cache,
        "enable_compression": config.enable_compression,
        "tier_models": {tier.value: name for tier, name in config.tier_models.items()},
        "ollama_base_url": _ollama_base_url,
    }


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    orchestrator = await _get_orchestrator(request.ollama_base_url)

    rag_docs: Optional[List[Tuple[str, str]]] = None
    if request.rag_documents:
        rag_docs = [(doc.id, doc.content) for doc in request.rag_documents]

    try:
        result = await orchestrator.run(
            prompt=request.prompt,
            rag_documents=rag_docs,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            tools_version=request.tools_version,
            doc_version=request.doc_version,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ChatResponse(
        text=result.text,
        cache_entry_id=result.cache_entry_id,
        cache_hit=result.metrics.cache_hit,
        model_used=result.model_used,
        metrics=asdict(result.metrics),
    )


@app.post("/v1/feedback")
async def feedback(request: FeedbackRequest) -> Dict[str, bool]:
    orchestrator = await _get_orchestrator()
    orchestrator.record_feedback(request.entry_id, request.accepted, request.similarity)
    return {"ok": True}


@app.get("/v1/stats")
async def stats() -> Dict[str, Any]:
    orchestrator = await _get_orchestrator()
    payload = orchestrator.stats()
    payload["config"] = {
        "target_overhead_ms": _runtime_config.target_overhead_ms,
        "cache_initial_threshold": _runtime_config.cache_initial_threshold,
        "enable_cache": _runtime_config.enable_cache,
        "enable_compression": _runtime_config.enable_compression,
        "max_concurrent_llm": _runtime_config.max_concurrent_llm,
    }
    return payload


def main() -> None:
    configure_frozen_environment()

    parser = argparse.ArgumentParser(description="LiquiTask semantic layer sidecar")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument(
        "--cache-dir",
        default=os.environ.get("LIQUITASK_SEMANTIC_CACHE_DIR", _default_cache_dir()),
        help="Directory for persisted semantic cache + OOD state.",
    )
    args = parser.parse_args()

    global _ollama_base_url, _runtime_config
    _ollama_base_url = args.ollama_url.rstrip("/")
    _runtime_config = replace(_runtime_config, cache_persist_path=args.cache_dir or None)

    # PyInstaller cannot resolve the string import path used in dev mode.
    if getattr(sys, "frozen", False):
        uvicorn.run(
            app,
            host=args.host,
            port=args.port,
            log_level="info",
        )
    else:
        uvicorn.run(
            "semantic_layer.server:app",
            host=args.host,
            port=args.port,
            log_level="info",
        )


if __name__ == "__main__":
    main()
