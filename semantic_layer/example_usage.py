"""
Example usage for the Semantic Layer pipeline.

Requires:
  - pip install -r semantic_layer/requirements.txt
  - Ollama running locally (or swap backend to LlamaCppBackend)

Run from repo root:
  python -m semantic_layer.example_usage
"""

from __future__ import annotations

import asyncio
import sys

from semantic_layer.backends.ollama import OllamaBackend
from semantic_layer.benchmark import benchmark
from semantic_layer.config import SemanticLayerConfig
from semantic_layer.orchestrator import SemanticOrchestrator


async def demo_cache_and_routing() -> None:
    config = SemanticLayerConfig(
        embed_device="cpu",
        cache_max_entries=5_000,
        enable_cache=True,
        enable_compression=True,
    )

    # Default: Ollama. Uncomment to use llama.cpp OpenAI-compatible server:
    # backend = LlamaCppBackend(base_url="http://localhost:8080")
    backend = OllamaBackend(base_url="http://localhost:11434")
    pipeline = SemanticOrchestrator(config, backend=backend)

    print("=== Cold start (cache miss) ===")
    result = await pipeline.run("What is the capital of France?")
    print(f"Response: {result.text[:120]}...")
    print(f"Model: {result.model_used}")
    print(f"Semantic overhead: {result.metrics.total_semantic_ms:.1f} ms")
    print(f"LLM latency: {result.metrics.llm_ms:.1f} ms")
    print(f"Cache hit: {result.metrics.cache_hit}")
    print(f"Route tier: {result.metrics.route_tier}")

    print("\n=== Near-duplicate (expected cache hit) ===")
    result2 = await pipeline.run("Tell me the capital city of France")
    print(f"Cache hit: {result2.metrics.cache_hit}")
    print(f"Semantic overhead: {result2.metrics.total_semantic_ms:.1f} ms")
    print(f"Model: {result2.model_used}")

    print("\n=== RAG compression ===")
    docs = [
        (
            "wiki-france",
            "Paris is the capital and largest city of France. "
            "It lies on the River Seine in northern France.",
        ),
        (
            "wiki-germany",
            "Berlin is the capital of Germany. "
            "It is unrelated to French geography.",
        ),
    ]
    result3 = await pipeline.run(
        "What river flows through the capital of France?",
        rag_documents=docs,
    )
    print(f"Response: {result3.text[:120]}...")
    print(f"Compress stage: {result3.metrics.compress_ms:.1f} ms")

    print("\n=== Mini benchmark ===")
    queries = [
        "What is the capital of France?",
        "Tell me the capital city of France",
        "Define photosynthesis briefly",
        "Implement binary search in Python",
        "Analyze trade-offs of event-driven architecture",
    ]
    report = await benchmark(pipeline, queries, warmup=1)
    print(report.summary())


def main() -> None:
    try:
        asyncio.run(demo_cache_and_routing())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print(
            "\nEnsure dependencies are installed and Ollama is running:\n"
            "  pip install -r semantic_layer/requirements.txt\n"
            "  ollama serve && ollama pull llama3.2:1b",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
