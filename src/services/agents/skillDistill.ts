/**
 * Distill a raw agent run summary into a compact, reusable skill.
 *
 * Captured skills used to store the run's narrative summary verbatim, so a later
 * run's prompt got prose ("I looked at X, then tried Y, then...") rather than
 * reusable know-how. This condenses that narrative into three scannable parts —
 * the approach, the files it touched, and any gotchas — so the next run gets a
 * how-to instead of a diary. Deterministic and dependency-free (no LLM call on
 * the capture hot path); the caller keeps the raw text if this collapses too far.
 */

/** Path-like tokens: at least one directory segment and a file extension. */
const FILE_RE = /\b[\w.-]+\/[\w./-]+\.\w+\b/g;

/** Sentences that flag a caveat worth carrying forward. */
const GOTCHA_RE =
  /\b(note|gotcha|careful|caveat|watch\s?out|beware|because|fail(?:ed|s|ure)?|error|broke|tricky|remember|ensure|must|avoid)\b/i;

export function distillSkillSummary(raw: string): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const approach = sentences.slice(0, 2).join(" ").slice(0, 400);

  const files = Array.from(new Set(text.match(FILE_RE) ?? [])).slice(0, 8);

  const gotchas = sentences
    .filter((s) => GOTCHA_RE.test(s) && !approach.includes(s))
    .slice(0, 3);

  const parts = [`Approach: ${approach}`];
  if (files.length) parts.push(`Files: ${files.join(", ")}`);
  if (gotchas.length) parts.push(`Watch out: ${gotchas.join(" ")}`);

  return parts.join("\n").slice(0, 1200);
}
