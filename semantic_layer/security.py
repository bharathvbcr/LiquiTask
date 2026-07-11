"""Security helpers: Ollama URL allowlist, request bounds, cache permissions."""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import AbstractSet, FrozenSet, Optional, Set
from urllib.parse import urlparse

# Request / payload bounds
MAX_PROMPT_CHARS = 96_000
MAX_SYSTEM_PROMPT_CHARS = 16_384
MAX_RAG_DOCUMENTS = 64
MAX_RAG_DOC_CONTENT_CHARS = 32_768
MAX_MAX_TOKENS = 8_192
MAX_CACHE_MAX_ENTRIES = 50_000
MAX_REQUEST_BODY_BYTES = 524_288  # 512 KiB

LOOPBACK_HOSTS: FrozenSet[str] = frozenset(
    {"127.0.0.1", "localhost", "::1", "[::1]"}
)


def normalize_host(host: str) -> str:
    return host.strip("[]").lower()


def is_loopback_host(host: str) -> bool:
    return normalize_host(host) in {h.strip("[]") for h in LOOPBACK_HOSTS}


def is_loopback_bind(host: str) -> bool:
    return is_loopback_host(host)


def host_from_url(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    hostname = parsed.hostname
    if not hostname:
        return None
    return normalize_host(hostname)


def is_allowed_ollama_url(
    url: str,
    extra_hosts: Optional[AbstractSet[str]] = None,
) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if "@" in (parsed.netloc or ""):
        return False
    host = host_from_url(url)
    if not host:
        return False
    allowed = {normalize_host(h) for h in LOOPBACK_HOSTS}
    if extra_hosts:
        allowed.update(normalize_host(h) for h in extra_hosts)
    return host in allowed


def validate_ollama_url(
    url: str,
    extra_hosts: Optional[AbstractSet[str]] = None,
) -> str:
    cleaned = url.rstrip("/")
    if not is_allowed_ollama_url(cleaned, extra_hosts):
        raise ValueError(f"ollama_base_url not allowed: {url}")
    return cleaned


def register_configured_host(hosts: Set[str], url: str) -> None:
    """Trust a host explicitly set via authenticated /v1/config."""
    host = host_from_url(url)
    if host:
        hosts.add(host)


def secure_cache_dir(directory: str | Path) -> None:
    """Ensure cache directory and metadata files use restrictive permissions."""
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    try:
        path.chmod(stat.S_IRWXU)  # 0700
    except OSError:
        pass
    meta = path / "cache.meta.json"
    if meta.is_file():
        try:
            meta.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError:
            pass
    index = path / "cache.index"
    if index.is_file():
        try:
            index.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass


def auth_token_from_env() -> Optional[str]:
    token = os.environ.get("LIQUITASK_SEMANTIC_AUTH_TOKEN", "").strip()
    return token or None
