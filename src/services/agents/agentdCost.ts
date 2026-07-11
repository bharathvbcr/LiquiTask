/** Per-model token tallies from liquitask-agentd `result.usage`. */
export type AgentdTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

function modelRates(model: string): [number, number, number, number] {
  const m = model.toLowerCase();
  if (m.includes("opus")) return [15, 75, 1.5, 18.75];
  if (m.includes("haiku")) return [0.25, 1.25, 0.03, 0.3];
  return [3, 15, 0.3, 3.75];
}

/** Mirror of `agentd_store.rs` cost estimation from usage payloads. */
export function estimateCostUsdFromUsage(
  usage?: Record<string, AgentdTokenUsage>,
): number | undefined {
  if (!usage) return undefined;
  let cost = 0;
  let hasTokens = false;
  for (const [model, entry] of Object.entries(usage)) {
    const input = entry.inputTokens ?? 0;
    const output = entry.outputTokens ?? 0;
    const cacheRead = entry.cacheReadTokens ?? 0;
    const cacheWrite = entry.cacheWriteTokens ?? 0;
    if (input + output + cacheRead + cacheWrite === 0) continue;
    hasTokens = true;
    const [inRate, outRate, cacheReadRate, cacheWriteRate] = modelRates(model);
    cost += (input / 1_000_000) * inRate;
    cost += (output / 1_000_000) * outRate;
    cost += (cacheRead / 1_000_000) * cacheReadRate;
    cost += (cacheWrite / 1_000_000) * cacheWriteRate;
  }
  return hasTokens ? cost : undefined;
}
