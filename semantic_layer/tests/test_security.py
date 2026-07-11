"""Security regression tests for semantic layer sidecar."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("LIQUITASK_SEMANTIC_AUTH_TOKEN", "test-secret-token")
    import semantic_layer.server as server

    importlib.reload(server)
    server._auth_token = "test-secret-token"
    server._ollama_base_url = "http://127.0.0.1:11434"
    server._configured_ollama_hosts.clear()
    server._orchestrator = None
    return TestClient(server.app)


def test_health_requires_bearer_token(client: TestClient) -> None:
    response = client.get("/health", headers={"Host": "127.0.0.1"})
    assert response.status_code == 401


def test_health_with_valid_token(client: TestClient) -> None:
    response = client.get(
        "/health",
        headers={
            "Host": "127.0.0.1",
            "Authorization": "Bearer test-secret-token",
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_empty_host_header_rejected(client: TestClient) -> None:
    response = client.get(
        "/health",
        headers={"Authorization": "Bearer test-secret-token"},
    )
    assert response.status_code == 403


def test_config_rejects_disallowed_ollama_url(client: TestClient) -> None:
    response = client.post(
        "/v1/config",
        headers={
            "Host": "127.0.0.1",
            "Authorization": "Bearer test-secret-token",
        },
        json={"ollama_base_url": "http://192.168.1.50:11434"},
    )
    assert response.status_code == 400
    assert "not allowed" in response.json()["detail"]


def test_config_accepts_loopback_ollama_url(client: TestClient) -> None:
    response = client.post(
        "/v1/config",
        headers={
            "Host": "127.0.0.1",
            "Authorization": "Bearer test-secret-token",
        },
        json={"ollama_base_url": "http://127.0.0.1:11434"},
    )
    assert response.status_code == 200
    assert response.json()["ollama_base_url"] == "http://127.0.0.1:11434"


def test_validate_ollama_url_blocks_userinfo_loopback() -> None:
    from semantic_layer.security import is_allowed_ollama_url

    assert not is_allowed_ollama_url("http://user:pass@127.0.0.1:11434")


def test_validate_ollama_url_blocks_remote() -> None:
    from semantic_layer.security import validate_ollama_url

    with pytest.raises(ValueError, match="not allowed"):
        validate_ollama_url("http://10.0.0.5:11434")


def test_validate_ollama_url_allows_configured_host() -> None:
    from semantic_layer.security import validate_ollama_url

    hosts = {"10.0.0.5"}
    assert validate_ollama_url("http://10.0.0.5:11434", hosts) == "http://10.0.0.5:11434"
