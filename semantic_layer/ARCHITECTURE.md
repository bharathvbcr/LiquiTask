# LiquiTask Semantic Layer — Architecture Blueprint

Production-grade local inference optimizer for Ollama-backed AI calls. The sidecar sits between LiquiTask (`semanticLayerService.ts`) and Ollama, applying **semantic caching**, **intent-based routing**, and **RAG context compression** before any LLM token is generated.

Target: **<15 ms p95 semantic overhead** on cache hits (CPU, MiniLM-L6-v2, FAISS IndexFlatIP).

---

## 1. System Architecture & Data Flow

### High-level placement

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LiquiTask (React + Tauri)                                              │
│  aiService.ts ──► semanticLayerService.ts                               │
│  (default: Tauri invoke → Rust in-process engine)                       │
│  (legacy: HTTP :8765 when LIQUITASK_USE_PYTHON=1 or web dev)            │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                    Default: semantic_layer Rust commands (mod.rs)
                    Legacy: Tauri spawn → Python FastAPI sidecar
                    (python -m semantic_layer | bundled PyInstaller binary)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Semantic Layer (Rust in-process OR FastAPI sidecar — server.py)        │
│                                                                         │
│   POST /v1/chat  ──► SemanticOrchestrator.run()                         │
│   POST /v1/config ◄── settings sync from AiSettings                     │
│   POST /v1/feedback ◄── user accept/reject for threshold tuning         │
│   GET  /v1/stats  ──► cache size, dynamic τ, OOD readiness             │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
                            OllamaBackend ──► Ollama :11434
                            (1B–70B models by tier)
```

### Query pipeline (orchestrator.py)

Every `/v1/chat` request flows through four stages. On a **cache hit**, stages 3–4 are skipped and no LLM call is made.

```
                         User prompt + optional RAG docs
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  0. Embed (Embedder)          │
                    │  all-MiniLM-L6-v2 → R^384     │
                    │  ~3–8 ms (CPU, warm)          │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │  OOD score (OODDetector)      │
                    │  diagonal Mahalanobis         │
                    │  cold start → score = 0       │
                    └───────────────┬───────────────┘
                                    │
          ┌─────────────────────────▼─────────────────────────┐
          │  1. SEMANTIC CACHE (SemanticCache + FAISS)        │
          │     ANN top-k → cosine sim ≥ τ(q)                   │
          │     guards: intent, tier, params_hash, TTL          │
          │     strict OOD → bypass cache entirely              │
          └───────────────┬─────────────────────────────────────┘
                          │
               cache hit? │ yes ──► return cached response (~5–12 ms total)
                          │ no
                          ▼
          ┌───────────────────────────────────────────────────┐
          │  2. SEMANTIC ROUTER (SemanticRouter)              │
          │     intent: coding | factual | creative | …       │
          │     complexity ∈ [0,1] → SMALL | MEDIUM | LARGE   │
          │     OOD → force LARGE tier                        │
          └───────────────┬───────────────────────────────────┘
                          │
                          ▼
          ┌───────────────────────────────────────────────────┐
          │  3. SEMANTIC COMPRESSOR (SemanticCompressor)      │
          │     chunk → embed → filter → greedy knapsack      │
          │     only when rag_documents present               │
          └───────────────┬───────────────────────────────────┘
                          │
                          ▼
          ┌───────────────────────────────────────────────────┐
          │  4. LLM INFERENCE (OllamaBackend)                 │
          │     model = tier_models[route.tier]               │
          │     semaphore limits concurrent LLM calls         │
          └───────────────┬───────────────────────────────────┘
                          │
                          ▼
               store in cache (unless strict OOD)
               return text + PipelineMetrics
```

### Integration contracts

| Layer | File | Role |
|-------|------|------|
| UI settings | `components/settings/AiSettings.tsx` | Threshold, cache size, model tiers |
| TypeScript client | `src/services/semanticLayerService.ts` | Health, spawn, `/v1/chat`, `/v1/config`, feedback |
| AI fallback | `src/services/aiService.ts` | `trySemanticRequest()` → direct Ollama if sidecar unavailable |
| Tauri sidecar | `src-tauri/src/semantic_layer.rs` | Spawn/stop Python or bundled binary |

Request shape (`POST /v1/chat`):

```json
{
  "prompt": "Summarize my overdue tasks",
  "system_prompt": "You are a task assistant…",
  "rag_documents": [{ "id": "task_context", "content": "…" }],
  "temperature": 0.4,
  "max_tokens": 2048,
  "doc_version": "v1"
}
```

Response includes per-stage timings in `metrics` for observability.

---

## 2. Mathematical Optimization & Thresholding Logic

### 2.1 Semantic cache — cosine similarity

Embeddings are **L2-normalized**; inner product equals cosine similarity:

\[
\text{sim}(q, c) = \hat{q} \cdot \hat{c}, \quad \|\hat{q}\| = \|\hat{c}\| = 1
\]

A cache hit requires **all** of:

1. \(\text{sim}(q, c) \geq \tau(q)\) — dynamic threshold
2. Matching `intent`, `model_tier`, `params_hash`, `doc_version`
3. Entry not expired (`TTL`)
4. Not strict OOD (`ood_score ≤ σ`)

`params_hash` is content-addressed over `temperature | system_prompt | tools_version | rag_fingerprint | max_tokens`. The **`rag_fingerprint`** (a hash of the retrieved documents) and **`max_tokens`** are part of the key so the same prompt with different retrieved context — or a different generation budget — never collides onto a stale cached answer.

FAISS `IndexIDMap2(IndexFlatIP)` performs exact top-k search over up to 10k vectors in ~1–2 ms. Integer-id mapping lets removals be a single `remove_ids` call instead of rebuilding the index.

### 2.2 Dynamic threshold τ(q)

Base threshold \(\tau_0 = 0.88\) (configurable via LiquiTask settings).

**Online calibration** (`ThresholdCalibrator.record_hit`):

- **Accepted hit** (similarity \(s\), user confirms):  
  \(\tau \leftarrow \tau - \alpha(\tau - s)\), \(\alpha = 0.01\)
- **False positive** (user rejects):  
  \(\tau \leftarrow \min\left(0.99,\; \tau + \beta(s - \tau + \delta)\right)\), \(\beta = 0.05\), \(\delta = 0.02\)

**Offline auto-tune** (`auto_tune(events, ε)`):

Grid search \(\tau \in [0.75, 0.98]\) maximizing hit rate subject to false-positive rate \(\leq \epsilon\) (default 2%).

**Moderate OOD boost** (when \(0 < \text{ood\_score} < \sigma\)):

\[
\tau(q) = \min\left(0.99,\; \tau_{\text{cal}} + \beta_{\text{ood}} \cdot \frac{\text{ood\_score}}{\sigma}\right)
\]

with \(\sigma = 3.5\), \(\beta_{\text{ood}} = 0.05\).

**Strict OOD** (\(\text{ood\_score} > \sigma\)): cache bypassed entirely; router forces LARGE tier; responses are not stored.

### 2.3 Cache invalidation

| Mechanism | Trigger | Implementation |
|-----------|---------|----------------|
| **TTL** | `cache_ttl_seconds` (default 24 h) | `expires_at` checked on lookup (skipped, not served) and swept in a batch on the next `store` |
| **LRU** | `cache_max_entries` exceeded | Evict entry with oldest `last_accessed` |
| **RAG context** | Retrieved docs change | Automatic — `rag_fingerprint` is part of `params_hash`, so a different context is a cache miss by construction. `invalidate_by_doc_version` remains for bulk corpus rotation |
| **Config sync** | Settings change | Orchestrator hot-reloads **in place** via `apply_config()`, preserving the cache, OOD state, and calibrated threshold. The threshold is only re-seeded when the *configured base* changes |
| **Persistence** | Restart | `save()`/`load()` round-trip the index + entries + threshold to `cache_persist_path` so hit-rate survives app restarts |

### 2.4 Semantic routing — complexity score

Hybrid score in \([0, 1]\):

\[
C = 0.6 \cdot L + 0.4 \cdot P
\]

- \(L = \min(\text{tokens}/512, 1)\) — length
- \(P\) — regex pattern hits (complex vs simple)

> A former third term \(N\) ("embedding norm deviation") was removed: the embedder L2-normalizes every vector, so \(\lVert e \rVert \equiv 1\) and \(N \equiv 0\) — it contributed nothing while consuming 15% of the weight. The two live signals are reweighted to sum to 1.

Routing:

| Condition | Tier | Typical model |
|-----------|------|---------------|
| OOD or \(C \geq \theta\) | LARGE | 8B–70B |
| \(\theta/2 \leq C < \theta\) | MEDIUM | 3B–8B |
| \(C < \theta/2\) | SMALL | 1B–3B |

\(\theta = 0.62\) (`complexity_threshold`). Reasoning intent bumps SMALL → MEDIUM.

### 2.5 RAG compression

1. **Chunk** paragraphs (512 chars, 64 overlap)
2. **Embed** chunks + query (batched)
3. **Filter** chunks with \(\text{sim}(q, \text{chunk}) \geq 0.55\)
4. **Pack** greedy knapsack by relevance/token ratio into `max_context_tokens` (2048)

Reduces prompt tokens sent to the LLM, lowering VRAM and latency for RAG-heavy calls.

### 2.6 OOD detection

Diagonal Mahalanobis distance using Welford online statistics over embedding stream:

\[
d(q) = \sqrt{\sum_i \frac{(q_i - \mu_i)^2}{\text{Var}_i + \epsilon}}
\]

- **Cold start**: returns 0 until `ood_min_samples` (50) embeddings collected — no blocking
- **Warm**: \(d(q) > \sigma\) triggers strict OOD path
- Welford's \(M_2\) accumulator is initialized to **zero** (a nonzero seed inflates every dimension's variance and deflates \(d\), suppressing the strict-OOD path early). The `ready` gate plus the \(\epsilon\) floor prevent divide-by-zero.

### 2.7 Resource contention

When multiple chat requests arrive concurrently:

- **Embedding**: thread-safe singleton `Embedder` (sentence-transformers)
- **FAISS cache**: `RLock` on all cache mutations
- **LLM calls**: `asyncio.Semaphore(max_concurrent_llm=2)` queues excess requests to avoid Ollama VRAM thrashing. The semaphore is a stable instance — it is only rebuilt when `max_concurrent_llm` actually changes, so in-flight permit accounting is never reset out from under queued requests

### 2.8 Cacheability guard

Not every response should be cached. `store`/`lookup` are skipped when:

- the routed `intent` is in `cache_skip_intents` (default `("creative",)`) — creative generations should stay fresh, and
- `temperature > cache_max_cacheable_temperature` (default 0.7) — high-temperature sampling is intentionally non-deterministic.

This prevents the cache from collapsing sampling diversity or serving a "creative" answer identical to a prior near-duplicate prompt.

---

## 3. Production Python Implementation

### Module map

| Module | Responsibility |
|--------|----------------|
| `embedder.py` | Singleton MiniLM encoder, warm-up on init |
| `cache.py` | FAISS IndexIDMap2(IndexFlatIP), dynamic τ, TTL/LRU, persistence |
| `router.py` | Intent + complexity → model tier |
| `compressor.py` | RAG chunk/filter/pack |
| `ood.py` | Online OOD scoring |
| `orchestrator.py` | Pipeline wiring + metrics |
| `server.py` | FastAPI sidecar on `:8765` |
| `benchmark.py` | Latency percentiles + resource snapshot |
| `backends/ollama.py` | Async Ollama `/api/generate` |
| `config.py` | Frozen dataclass defaults |

### Performance budget (cache hit, CPU)

| Stage | Target p50 |
|-------|-----------|
| Embed | 3–8 ms |
| OOD | <0.1 ms |
| Cache ANN | 1–2 ms |
| Route | <0.5 ms |
| **Total semantic** | **<15 ms p95** |

Compression adds ~5–20 ms depending on document count (batched embed).

### Running locally

```bash
python3 -m pip install -r semantic_layer/requirements.txt
python3 -m semantic_layer --port 8765
# or
npm run semantic:serve
```

First run downloads `sentence-transformers/all-MiniLM-L6-v2` (~90 MiB). Bundled PyInstaller builds include the model offline.

### Tests

```bash
python3 -m pip install -r semantic_layer/requirements.txt
python3 -m pytest semantic_layer/tests/ -q
```

---

## 4. Resource Management & Benchmarking Strategy

### 4.1 What to measure

| Metric | Tool | Target |
|--------|------|--------|
| Semantic overhead p50/p95/p99 | `benchmark.py` | p95 < 15 ms |
| Cache hit rate | `BenchmarkReport.cache_hit_rate` | >30% on repeated workloads |
| Per-stage latency | `PipelineMetrics` | embed dominates |
| RSS memory | `psutil` in benchmark | ~200–400 MB sidecar |
| Ollama VRAM | `nvidia-smi` / Activity Monitor | Tier routing reduces peak |
| LLM latency | `metrics.llm_ms` | Tier-dependent |

### 4.2 Running benchmarks

**Semantic-only (no Ollama required for unit tests; full bench needs Ollama):**

```bash
python3 -m semantic_layer.benchmark
```

**Full demo with Ollama:**

```bash
ollama serve
ollama pull llama3.2:1b
python3 -m semantic_layer.example_usage
```

**Programmatic:**

```python
import asyncio
from semantic_layer import SemanticLayerConfig, SemanticOrchestrator, benchmark

config = SemanticLayerConfig(embed_device="cpu")
pipeline = SemanticOrchestrator(config)
queries = ["What is the capital of France?", "Capital city of France?"]
report = asyncio.run(benchmark(pipeline, queries, warmup=2))
print(report.summary())
assert report.meets_target  # p95 semantic < 15 ms
```

### 4.3 VRAM / CPU profiling workflow

1. **Baseline**: Direct Ollama call without sidecar — record VRAM and latency.
2. **Cache warm**: Repeat similar queries — expect near-zero LLM time on hits.
3. **Routing**: Send simple vs complex prompts — verify SMALL vs LARGE model selection in `metrics.route_tier`.
4. **RAG compression**: Large document set — compare token count and LLM latency with/without compression.
5. **Contention**: Fire N concurrent `/v1/chat` requests — observe queueing via `max_concurrent_llm`.

### 4.4 Production observability

- `GET /v1/stats` — cache size, dynamic threshold, OOD sample count
- `metrics` on every chat response — embed/cache/route/compress/llm ms
- User feedback via `POST /v1/feedback` tunes threshold online

### 4.5 Tuning guide

| Symptom | Knob |
|---------|------|
| Too many wrong cache hits | Raise `cache_initial_threshold` or lower `cache_fp_epsilon` |
| Low hit rate | Lower threshold slightly; ensure intent/tier alignment |
| Slow first query | Expected cold start (~100–500 ms model load); sidecar pre-warms on init |
| Ollama OOM under load | Lower `max_concurrent_llm`; prefer routing to SMALL tier |
| Stale RAG answers | Automatic — context is in the cache key. For bulk corpus rotation, bump `doc_version` and call `invalidate_stale_docs()` |

---

## Appendix: Configuration reference

See `config.py` (`SemanticLayerConfig`) and LiquiTask AI settings (`SemanticLayerSettings` in `types.ts`). Key defaults:

| Parameter | Default |
|-----------|---------|
| `embed_model` | `sentence-transformers/all-MiniLM-L6-v2` |
| `cache_initial_threshold` | 0.88 |
| `cache_max_entries` | 10,000 |
| `cache_ttl_seconds` | 86,400 |
| `complexity_threshold` | 0.62 |
| `ood_sigma_threshold` | 3.5 |
| `target_overhead_ms` | 15.0 |
| `max_concurrent_llm` | 2 |
| `cache_skip_intents` | `("creative",)` |
| `cache_max_cacheable_temperature` | 0.7 |
| `cache_persist_path` | `None` (server default: `~/.liquitask/semantic-layer`) |
