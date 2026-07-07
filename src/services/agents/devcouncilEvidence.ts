/**
 * DevCouncil evidence graph — correlate a LiquiTask board task to its DevCouncil
 * Requirement -> Task -> Evidence provenance.
 *
 * The Rust mirror (`agent_dev_mirror_evidence`) copies DevCouncil's read-only
 * state into LiquiTask's store; this module turns those flat mirrored rows into
 * the per-board-task view the UI renders. Board tasks materialized from a plan
 * carry a `devcouncil:<id>` tag (see `agentPlannerService.materializeSubtasks`),
 * which is the join key back to the mirrored DevCouncil task.
 *
 * Pure + dependency-free so the correlation is unit-testable without the bridge.
 */
import type { Task } from "../../../types";
import type {
  DevStoredEvidence,
  DevStoredRequirement,
  DevStoredTask,
} from "../nativeBridge";

export interface EvidenceGraph {
  requirements: DevStoredRequirement[];
  tasks: DevStoredTask[];
  evidence: DevStoredEvidence[];
}

export interface TaskEvidenceView {
  task: DevStoredTask;
  requirements: DevStoredRequirement[];
  evidence: DevStoredEvidence[];
}

const TAG_PREFIX = "devcouncil:";

/** Board tasks materialized from a DevCouncil plan carry a `devcouncil:<id>` tag. */
export function devcouncilTaskIdFromTags(task: Pick<Task, "tags">): string | undefined {
  const tag = (task.tags ?? []).find((t) => t.startsWith(TAG_PREFIX));
  return tag ? tag.slice(TAG_PREFIX.length) : undefined;
}

function parseIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Correlate a board task to its DevCouncil requirement -> task -> evidence view.
 * Returns null when the task wasn't DevCouncil-planned or the graph lacks its id.
 */
export function buildTaskEvidenceView(
  task: Pick<Task, "tags">,
  graph: EvidenceGraph,
): TaskEvidenceView | null {
  const devId = devcouncilTaskIdFromTags(task);
  if (!devId) return null;

  const devTask = graph.tasks.find((t) => t.id === devId);
  if (!devTask) return null;

  const reqIds = new Set(parseIds(devTask.requirementIdsJson));
  const requirements = graph.requirements.filter((r) => reqIds.has(r.id));
  const evidence = graph.evidence.filter((e) => e.taskId === devId);
  return { task: devTask, requirements, evidence };
}

/** Best-effort one-line label for an evidence row from its JSON payload. */
export function evidenceLabel(evidence: DevStoredEvidence): string {
  if (!evidence.dataJson) return evidence.kind;
  try {
    const data = JSON.parse(evidence.dataJson) as Record<string, unknown>;
    const pick = data.command ?? data.file ?? data.name ?? data.path;
    return typeof pick === "string" && pick.length > 0 ? pick : evidence.kind;
  } catch {
    return evidence.kind;
  }
}
