import { useEffect, useState } from "react";
import type React from "react";
import { FileCheck2, FileText, GitBranch, ListChecks, ShieldCheck } from "lucide-react";

import type { Task } from "../../../types";
import devcouncilService from "../../services/agents/devcouncilService";
import {
  buildTaskEvidenceView,
  evidenceLabel,
  type TaskEvidenceView,
} from "../../services/agents/devcouncilEvidence";

interface TaskEvidencePanelProps {
  task: Task;
  /** Optional: when known, refreshes the mirror for this repo before reading. */
  workingDir?: string;
}

const STATUS_DOT: Record<string, string> = {
  planned: "bg-slate-400",
  ready: "bg-blue-400",
  running: "bg-blue-400",
  blocked: "bg-red-500",
  verified: "bg-emerald-400",
  done: "bg-emerald-400",
  cancelled: "bg-slate-600",
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

function evidenceIcon(kind: string) {
  if (kind === "command") return ListChecks;
  if (kind === "diff") return GitBranch;
  if (kind === "test") return FileCheck2;
  return FileText;
}

/**
 * DevCouncil provenance for a board task: the requirement(s) it satisfies and the
 * verification evidence recorded for it. Renders nothing for tasks that weren't
 * DevCouncil-planned, so it's safe to drop into any task detail view.
 */
export const TaskEvidencePanel: React.FC<TaskEvidencePanelProps> = ({ task, workingDir }) => {
  const [view, setView] = useState<TaskEvidenceView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    devcouncilService
      .getEvidenceGraph(workingDir)
      .then((graph) => {
        if (alive) setView(buildTaskEvidenceView(task, graph));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [task, workingDir]);

  // Quiet when there's nothing to show (still loading, or not DevCouncil-planned).
  if (loading || !view) return null;

  const { task: devTask, requirements, evidence } = view;
  const statusDot = STATUS_DOT[devTask.status ?? "planned"] ?? "bg-slate-400";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-red-400" />
        <span className="text-[10px] uppercase tracking-widest text-slate-500">
          DevCouncil Provenance
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-slate-200">
        <span className={`h-2 w-2 rounded-full ${statusDot}`} />
        <span className="font-medium">{devTask.title}</span>
        {devTask.status && <span className="text-xs text-slate-500">{devTask.status}</span>}
      </div>

      {requirements.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Requirements</div>
          <ul className="mt-1 space-y-1">
            {requirements.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs text-slate-300">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[r.priority ?? ""] ?? "bg-slate-500"}`}
                />
                <span className="text-slate-500">{r.id}</span>
                <span className="truncate">{r.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">
          Evidence ({evidence.length})
        </div>
        {evidence.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No verification evidence recorded yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {evidence.map((e) => {
              const Icon = evidenceIcon(e.kind);
              return (
                <li key={e.id} className="flex items-center gap-2 text-xs text-slate-300">
                  <Icon size={13} className="shrink-0 text-slate-400" />
                  <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {e.kind}
                  </span>
                  <span className="truncate font-mono text-[11px] text-slate-400">
                    {evidenceLabel(e)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TaskEvidencePanel;
