/**
 * Bloom's-taxonomy routing — decide whether a subtask needs a worker or a thinker.
 *
 * The Lead tags each subtask with a Bloom level: Apply-and-below (execution) go
 * to a **Worker**; Analyze-and-above (design, root-cause, evaluation) go to
 * the **Reviewer**. A deterministic keyword heuristic keeps it cheap and testable,
 * with an explicit override honoured first.
 */

import { BloomLevel } from "./campaignTypes";
import type { CampaignRank } from "./campaignTypes";

// Highest levels first so a strong verb wins over an incidental weak one.
const KEYWORDS: Array<[BloomLevel, string[]]> = [
  [
    BloomLevel.Create,
    [
      "design", "architect", "architecture", "invent", "compose", "author",
      "green-field", "greenfield", "propose", "strategy", "strategize",
      "new subsystem", "from scratch",
    ],
  ],
  [
    BloomLevel.Evaluate,
    [
      "evaluate", "assess", "review", "audit", "critique", "judge", "compare",
      "trade-off", "tradeoff", "recommend", "decide", "prioritize", "root cause",
      "root-cause",
    ],
  ],
  [
    BloomLevel.Analyze,
    [
      "analyze", "analyse", "investigate", "diagnose", "debug", "profile",
      "reverse-engineer", "break down", "correlate", "trace", "differentiate",
    ],
  ],
  [
    BloomLevel.Apply,
    [
      "implement", "build", "write", "add", "create", "fix", "refactor", "wire",
      "integrate", "migrate", "port", "configure", "apply", "run", "execute",
    ],
  ],
  [
    BloomLevel.Understand,
    ["summarize", "summarise", "explain", "describe", "document", "clarify", "outline"],
  ],
  [
    BloomLevel.Remember,
    ["list", "find", "locate", "look up", "fetch", "collect", "gather", "identify", "retrieve"],
  ],
];

const matches = (haystack: string, phrase: string): boolean => {
  if (phrase.includes(" ")) return haystack.includes(phrase);
  return new RegExp(`\\b${phrase}\\b`).test(haystack);
};

export function classifyBloom(text: string, override?: BloomLevel): BloomLevel {
  if (override !== undefined) return override;
  const haystack = (text ?? "").toLowerCase();
  for (const [level, words] of KEYWORDS) {
    if (words.some((w) => matches(haystack, w))) return level;
  }
  return BloomLevel.Apply; // most common execution level
}

/** Cognition (Analyze+) goes to the Reviewer; execution goes to a Worker. */
export function routeRank(level: BloomLevel): Extract<CampaignRank, "worker" | "reviewer"> {
  return level >= BloomLevel.Analyze ? "reviewer" : "worker";
}

export function routeText(text: string, override?: BloomLevel): Extract<CampaignRank, "worker" | "reviewer"> {
  return routeRank(classifyBloom(text, override));
}

export function bloomLabel(level: BloomLevel): string {
  return BloomLevel[level];
}

export function summarizeRouting(items: string[]): { worker: number; reviewer: number } {
  const counts = { worker: 0, reviewer: 0 };
  for (const item of items) counts[routeText(item)] += 1;
  return counts;
}
