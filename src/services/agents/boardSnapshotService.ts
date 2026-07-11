/**
 * Export board state for the liquitask CLI / meta-agent (Refactor 6).
 *
 * Writes ~/.liquitask/board-snapshot.json whenever tasks/columns/agents change.
 */
import type { AgentProfile, BoardColumn, Task } from "../../../types";
import { isTauri } from "../../runtime/runtimeEnvironment";

export interface BoardSnapshot {
  exportedAt: string;
  tasks: Task[];
  columns: BoardColumn[];
  agents: AgentProfile[];
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

export async function exportBoardSnapshot(
  tasks: Task[],
  columns: BoardColumn[],
  agents: AgentProfile[],
): Promise<void> {
  if (!isTauri()) return;
  const snapshot: BoardSnapshot = {
    exportedAt: new Date().toISOString(),
    tasks,
    columns,
    agents,
  };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("board_export_snapshot", { snapshot });
  } catch (err) {
    console.warn("board snapshot export failed:", err);
  }
}

/** Debounced export — call after task/column/agent mutations. */
export function scheduleBoardSnapshotExport(
  tasks: Task[],
  columns: BoardColumn[],
  agents: AgentProfile[],
): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void exportBoardSnapshot(tasks, columns, agents);
  }, 800);
}

export default { exportBoardSnapshot, scheduleBoardSnapshotExport };
