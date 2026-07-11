"""FastAPI sidecar exposing SemanticOrchestrator to LiquiTask."""

from __future__ import annotations

import argparse
import asyncio
import hmac
import os
import secrets
import sys
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Set, Tuple

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ._frozen import configure_frozen_environment
from .backends.ollama import OllamaBackend
from .config import SemanticLayerConfig
from .orchestrator import SemanticOrchestrator
from .security import (
    MAX_CACHE_MAX_ENTRIES,
    MAX_MAX_TOKENS,
    MAX_PROMPT_CHARS,
    MAX_RAG_DOCUMENTS,
    MAX_RAG_DOC_CONTENT_CHARS,
    MAX_REQUEST_BODY_BYTES,
    MAX_SYSTEM_PROMPT_CHARS,
    auth_token_from_env,
    is_loopback_bind,
    register_configured_host,
    secure_cache_dir,
    validate_ollama_url,
)

DEFAULT_PORT = 8765
DEFAULT_HOST = "127.0.0.1"


def _default_cache_dir() -> str:
    return str(Path.home() / ".liquitask" / "semantic-layer")


_runtime_config = SemanticLayerConfig(cache_persist_path=_default_cache_dir())
_ollama_base_url = "http://127.0.0.1:11434"
_configured_ollama_hosts: Set[str] = set()
_auth_token: Optional[str] = None
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
async def _security_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_REQUEST_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "payload too large"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "invalid content-length"})

    host = (request.headers.get("host") or "").split(":")[0].strip("[]")
    if not host or not any(host == p.strip("[]") for p in _ALLOWED_HOST_PREFIXES):
        return JSONResponse(status_code=403, content={"detail": "forbidden host"})

    if _auth_token:
        auth = request.headers.get("authorization", "")
        expected = f"Bearer {_auth_token}"
        if not hmac.compare_digest(auth, expected):
            return JSONResponse(status_code=401, content={"detail": "unauthorized"})

    return await call_next(request)


class RagDocument(BaseModel):
    id: str
    content: str


class SemanticLayerConfigUpdate(BaseModel):
    cache_initial_threshold: Optional[float] = None
    cache_max_entries: Optional[int] = Field(default=None, le=MAX_CACHE_MAX_ENTRIES)
    enable_cache: Optional[bool] = None
    enable_compression: Optional[bool] = None
    small_model: Optional[str] = None
    medium_model: Optional[str] = None
    large_model: Optional[str] = None
    ollama_base_url: Optional[str] = None


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=MAX_PROMPT_CHARS)
    system_prompt: str = Field(default="", max_length=MAX_SYSTEM_PROMPT_CHARS)
    rag_documents: Optional[List[RagDocument]] = Field(default=None, max_length=MAX_RAG_DOCUMENTS)
    temperature: float = 0.4
    max_tokens: int = Field(default=2048, le=MAX_MAX_TOKENS)
    tools_version: str = "v0"
    doc_version: str = "v1"
    # Ignored — per-request URL overrides are not accepted from callers.
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
    """Update runtime config and hot-reload it into the live orchestrator."""
    global _runtime_config, _ollama_base_url

    cache_max = update.cache_max_entries
    if cache_max is not None and cache_max > MAX_CACHE_MAX_ENTRIES:
        raise HTTPException(status_code=400, detail="cache_max_entries exceeds limit")

    _runtime_config = replace(
        _runtime_config,
        cache_initial_threshold=update.cache_initial_threshold
        if update.cache_initial_threshold is not None
        else _runtime_config.cache_initial_threshold,
        cache_max_entries=cache_max
        if cache_max is not None
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
        try:
            validated = validate_ollama_url(
                update.ollama_base_url, _configured_ollama_hosts
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _ollama_base_url = validated
        register_configured_host(_configured_ollama_hosts, validated)

    if _orchestrator is not None:
        _orchestrator.apply_config(_runtime_config)

    return _runtime_config


def _validate_rag_documents(docs: Optional[List[RagDocument]]) -> Optional[List[Tuple[str, str]]]:
    if not docs:
        return None
    if len(docs) > MAX_RAG_DOCUMENTS:
        raise HTTPException(status_code=400, detail="too many rag_documents")
    result: List[Tuple[str, str]] = []
    for doc in docs:
        if len(doc.content) > MAX_RAG_DOC_CONTENT_CHARS:
            raise HTTPException(status_code=400, detail="rag document content too large")
        result.append((doc.id, doc.content))
    return result


async def _get_orchestrator() -> SemanticOrchestrator:
    global _orchestrator

    backend_url = _ollama_base_url.rstrip("/")
    async with _orchestrator_lock:
        if _orchestrator is None:
            _orchestrator = SemanticOrchestrator(
                _runtime_config,
                backend=OllamaBackend(base_url=backend_url),
            )
        elif getattr(_orchestrator.backend, "base_url", "") != backend_url:
            _orchestrator.save_state()
            _orchestrator = SemanticOrchestrator(
                _runtime_config,
                backend=OllamaBackend(base_url=backend_url),
            )
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
    orchestrator = await _get_orchestrator()
    rag_docs = _validate_rag_documents(request.rag_documents)

    try:
        result = await orchestrator.run(
            prompt=request.prompt,
            rag_documents=rag_docs,
            system_prompt=request.system_prompt,
            temperature=request.temperature,
            max_tokens=min(request.max_tokens, MAX_MAX_TOKENS),
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
        "--auth-token",
        default=None,
        help="Bearer token for API auth (or set LIQUITASK_SEMANTIC_AUTH_TOKEN).",
    )
    parser.add_argument(
        "--allow-unsafe-bind",
        action="store_true",
        help="Allow binding to non-loopback interfaces (not recommended).",
    )
    parser.add_argument(
        "--cache-dir",
        default=os.environ.get("LIQUITASK_SEMANTIC_CACHE_DIR", _default_cache_dir()),
        help="Directory for persisted semantic cache + OOD state.",
    )
    args = parser.parse_args()

    if not is_loopback_bind(args.host) and not args.allow_unsafe_bind:
        print(
            f"Refusing non-loopback bind {args.host!r} without --allow-unsafe-bind",
            file=sys.stderr,
        )
        sys.exit(1)

    global _ollama_base_url, _runtime_config, _auth_token, _configured_ollama_hosts
    try:
        _ollama_base_url = validate_ollama_url(args.ollama_url.rstrip("/"))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    register_configured_host(_configured_ollama_hosts, _ollama_base_url)

    _auth_token = (args.auth_token or auth_token_from_env() or secrets.token_urlsafe(32))
    _runtime_config = replace(_runtime_config, cache_persist_path=args.cache_dir or None)
    if args.cache_dir:
        secure_cache_dir(args.cache_dir)

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
