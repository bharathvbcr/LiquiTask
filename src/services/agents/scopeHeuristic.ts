import type { Task } from "../../../types";
import agentScopeService, { type PlannedFile } from "./agentScopeService";

/** File-like token in task text (repo-relative). */
const FILE_TOKEN =
  /\b(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|go|rs|py|md|json|yaml|yml|toml|css|scss|html|sql|sh|mjs)\b/gi;

/** Directory prefixes commonly referenced in task titles. */
const DIR_HINTS = [
  "src/",
  "src-tauri/",
  "liquitask-agentd/",
  "crates/",
  "semantic_layer/",
  "scripts/",
  "docs/",
];

const CODE_WORDS =
  /\b(?:fix|refactor|implement|update|add|remove|migrate|port|test|component|service|hook|api|ui|board|agent|run)\b/i;

/**
 * Normalize a planned path for reservation comparison (repo-relative, no leading ./).
 */
export function normalizeReservationPath(path: string): string {
  const p = path.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
  if (!p || p === "**") return "**";
  return p;
}

/** True when two reservation paths would touch overlapping files. */
export function reservationPathsOverlap(a: string, b: string): boolean {
  const na = normalizeReservationPath(a);
  const nb = normalizeReservationPath(b);
  if (na === "**" || nb === "**") return true;
  if (na === nb) return true;
  if (na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`)) return true;
  const segA = na.split("/")[0];
  const segB = nb.split("/")[0];
  if (segA && segA === segB) return true;
  return false;
}

/** Does any path in `requested` overlap any path in `held`? */
export function reservationSetsOverlap(requested: string[], held: string[]): string[] {
  const overlaps: string[] = [];
  const seen = new Set<string>();
  for (const req of requested) {
    for (const h of held) {
      if (reservationPathsOverlap(req, h)) {
        const key = `${normalizeReservationPath(req)}|${normalizeReservationPath(h)}`;
        if (!seen.has(key)) {
          seen.add(key);
          overlaps.push(normalizeReservationPath(req));
        }
      }
    }
  }
  return overlaps;
}

function pathsFromPlannedFiles(files: PlannedFile[]): string[] {
  return files.map((f) => normalizeReservationPath(f.path)).filter(Boolean);
}

function pathsFromText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(FILE_TOKEN)) {
    const p = normalizeReservationPath(match[0]);
    if (p && p !== "**") found.add(p);
  }
  for (const hint of DIR_HINTS) {
    if (text.toLowerCase().includes(hint.replace(/\/$/, ""))) {
      found.add(normalizeReservationPath(hint));
    }
  }
  return [...found];
}

/**
 * Declare the files/subsystems a dispatch will likely touch.
 * DevCouncil PlannedFile wins when present; otherwise heuristic from task text.
 */
export function declarePlannedScope(task: Task): string[] {
  const fromCouncil = agentScopeService.getScopeForTask(task.id);
  if (fromCouncil.length > 0) {
    return pathsFromPlannedFiles(fromCouncil);
  }

  const blob = `${task.title}\n${task.subtitle ?? ""}\n${task.summary ?? ""}`;
  const fromText = pathsFromText(blob);
  if (fromText.length > 0) {
    return fromText;
  }

  if (CODE_WORDS.test(blob)) {
    return ["src/"];
  }

  return ["**"];
}
