import { AlignLeft, Check, ChevronDown, ChevronUp, Info } from "lucide-react";
import type React from "react";
import { lazy, Suspense } from "react";
import { getSafeExternalUrl } from "../../utils/safeUrl";
import { getProgressStyles } from "../../utils/taskCardUtils";
import type { Task } from "../../../types";
import { SubtaskTitleInput } from "./SubtaskTitleInput";

const MarkdownRenderer = lazy(() => import("../MarkdownRenderer"));

interface TaskCardBodyProps {
  task: Task;
  subtasks: { id: string; title: string; completed: boolean }[];
  completedSubtasks: number;
  progress: number;
  isSubtasksExpanded: boolean;
  onToggleSubtasksExpanded: () => void;
  onSubtaskToggle: (e: React.MouseEvent, subtaskId: string) => void;
  onSubtaskTitleChange: (subtaskId: string, newTitle: string) => void;
}

export const TaskCardBody: React.FC<TaskCardBodyProps> = ({
  task,
  subtasks,
  completedSubtasks,
  progress,
  isSubtasksExpanded,
  onToggleSubtasksExpanded,
  onSubtaskToggle,
  onSubtaskTitleChange,
}) => {
  const tags = task.tags ?? [];
  const hasCustomFields = Object.values(task.customFieldValues || {}).some(Boolean);

  // Summary + custom fields — revealed on card hover / focus (see grid-rows below).
  const revealContent = (
    <>
      {task.summary && (
        <div className="bg-[#050000]/40 rounded-xl p-3 border border-white/5 mb-2 max-h-32 overflow-y-auto custom-scrollbar group/markdown">
          <div className="flex items-start gap-2 h-full">
            <AlignLeft size={14} className="text-slate-300 mt-1 shrink-0" />
            <div className="text-sm text-slate-300 leading-relaxed font-medium w-full markdown-content">
              <Suspense fallback={<p className="whitespace-pre-wrap">{task.summary}</p>}>
                <MarkdownRenderer content={task.summary} />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {hasCustomFields && (
        <div className="flex flex-wrap gap-2 mb-1">
          {Object.entries(task.customFieldValues || {}).map(
            ([key, val]) =>
              val && (
                <div
                  key={key}
                  title={`${key}: ${val}`}
                  className="flex min-w-0 max-w-full items-center gap-1 px-2 py-1 rounded bg-white/5 text-[10px] text-slate-300 border border-white/5"
                >
                  <Info size={10} className="shrink-0 text-slate-300" />
                  {(() => {
                    const safeUrl = typeof val === "string" ? getSafeExternalUrl(val) : null;
                    return safeUrl ? (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-red-400 hover:underline"
                      >
                        Link
                      </a>
                    ) : (
                      <span className="min-w-0 truncate">{val as string}</span>
                    );
                  })()}
                </div>
              ),
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full text-[10px] font-medium text-slate-300 bg-white/5 border border-white/10"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Subtask progress — always visible */}
      {subtasks.length > 0 && (
        <div
          className="mb-3 group/progress"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex justify-between items-center text-[10px] text-slate-400 mb-1.5 font-semibold uppercase tracking-wider cursor-pointer"
            onClick={onToggleSubtasksExpanded}
          >
            <div className="flex items-center gap-1.5">
              <span>Subtasks</span>
              {isSubtasksExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </div>
            <span className={progress === 100 ? "text-emerald-400" : ""}>
              {completedSubtasks}/{subtasks.length}
            </span>
          </div>
          <div
            className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden cursor-pointer"
            onClick={onToggleSubtasksExpanded}
          >
            <div
              className={`h-full rounded-full transition-all duration-700 ${getProgressStyles(progress)}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {isSubtasksExpanded && (
            <div className="mt-3 space-y-1 pl-1">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => onSubtaskToggle(e, s.id)}
                    aria-label={`Toggle subtask ${s.title}`}
                    className={`w-4 h-4 rounded border flex items-center justify-center ${s.completed ? "bg-emerald-500/20 border-emerald-500 text-emerald-500" : "border-slate-700 bg-black/20 text-transparent"}`}
                  >
                    <Check size={10} />
                  </button>
                  <SubtaskTitleInput subtask={s} onCommit={onSubtaskTitleChange} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary + custom fields — revealed on hover / keyboard focus */}
      {(task.summary || hasCustomFields) && (
        <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none group-hover:grid-rows-[1fr] group-focus-within:grid-rows-[1fr]">
          <div className="min-h-0 overflow-hidden">
            <div className="pt-1">{revealContent}</div>
          </div>
        </div>
      )}
    </>
  );
};
