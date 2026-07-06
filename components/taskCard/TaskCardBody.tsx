import {
  AlignLeft,
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  Info,
  Paperclip,
} from "lucide-react";
import type React from "react";
import { lazy, Suspense } from "react";
import { InlineEditable } from "../../src/components/InlineEditable";
import { getSafeExternalUrl } from "../../src/utils/safeUrl";
import { getProgressStyles } from "../../src/utils/taskCardUtils";
import type { Task } from "../../types";
import { SubtaskTitleInput } from "./SubtaskTitleInput";

const MarkdownRenderer = lazy(() => import("../../src/components/MarkdownRenderer"));

interface TaskCardBodyProps {
  task: Task;
  isCompact: boolean;
  isAgentTask: boolean;
  agentWorking: boolean;
  dueInfo: { status: string; label: string; color: string } | null;
  subtasks: { id: string; title: string; completed: boolean }[];
  completedSubtasks: number;
  progress: number;
  isSubtasksExpanded: boolean;
  onToggleSubtasksExpanded: () => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onSubtaskToggle: (e: React.MouseEvent, subtaskId: string) => void;
  onSubtaskTitleChange: (subtaskId: string, newTitle: string) => void;
}

export const TaskCardBody: React.FC<TaskCardBodyProps> = ({
  task,
  isCompact,
  isAgentTask,
  agentWorking,
  dueInfo,
  subtasks,
  completedSubtasks,
  progress,
  isSubtasksExpanded,
  onToggleSubtasksExpanded,
  onEditTask,
  onUpdateTask,
  onSubtaskToggle,
  onSubtaskTitleChange,
}) => (
  <>
    <div
      onDoubleClick={() => onEditTask(task)}
      onPointerDown={(e) => e.stopPropagation()}
      className={`cursor-text group/title relative ${isCompact ? "mb-1" : "mb-3"}`}
    >
      <h3
        className={`${isCompact ? "text-sm" : "text-lg"} font-bold text-slate-100 leading-tight mb-1 line-clamp-2`}
      >
        <InlineEditable
          value={task.title}
          onSave={(nt) => onUpdateTask({ ...task, title: nt })}
          placeholder="Untitled task"
        />
        <Edit2
          size={12}
          className="inline-block ml-1 opacity-0 group-hover/title:opacity-40 transition-opacity duration-200 text-slate-400"
        />
      </h3>
      {!isCompact && (
        <p className="text-xs text-slate-400 font-semibold uppercase">
          <InlineEditable
            value={task.subtitle ?? ""}
            onSave={(ns) => onUpdateTask({ ...task, subtitle: ns })}
            placeholder="Add subtitle..."
          />
        </p>
      )}
    </div>

    {isCompact && (
      <div className="flex items-center gap-3 mt-2 text-slate-300">
        {task.assignee && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <div
              className={`w-4 h-4 rounded-full bg-gradient-to-tr from-slate-700 to-slate-900 flex items-center justify-center border ${agentWorking ? "border-blue-400/60 animate-pulse" : "border-white/10"}`}
            >
              {isAgentTask ? (
                <Bot size={9} className={agentWorking ? "text-blue-300" : "text-red-400"} />
              ) : (
                <span className="text-[9px] font-bold">
                  {task.assignee.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </div>
        )}
        {dueInfo && (
          <div className={`flex items-center gap-1 text-[10px] font-medium ${dueInfo.color}`}>
            <Clock size={10} />
            <span>
              {dueInfo.status === "today" || dueInfo.status === "overdue" ? dueInfo.label : ""}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {task.attachments?.length ? (
            <span className="flex items-center gap-0.5 text-[10px]">
              <Paperclip size={10} />
              {task.attachments.length}
            </span>
          ) : null}
          {subtasks.length > 0 && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <CheckSquare size={10} />
              {completedSubtasks}/{subtasks.length}
            </span>
          )}
        </div>
      </div>
    )}

    {!isCompact && (
      <>
        {task.summary && (
          <div className="bg-[#050000]/40 rounded-xl p-3 border border-white/5 mb-3 max-h-32 overflow-y-auto custom-scrollbar group/markdown">
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

        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(task.customFieldValues || {}).map(
            ([key, val]) =>
              val && (
                <div
                  key={key}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-[10px] text-slate-300 border border-white/5"
                >
                  <Info size={10} className="text-slate-300" />
                  {(() => {
                    const safeUrl = typeof val === "string" ? getSafeExternalUrl(val) : null;
                    return safeUrl ? (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-red-400 hover:underline"
                      >
                        Link
                      </a>
                    ) : (
                      <span>{val as string}</span>
                    );
                  })()}
                </div>
              ),
          )}
        </div>

        {subtasks.length > 0 && (
          <div
            className="mt-3 mb-4 group/progress"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex justify-between items-center text-[10px] text-slate-300 mb-1.5 font-medium uppercase cursor-pointer"
              onClick={onToggleSubtasksExpanded}
            >
              <div className="flex items-center gap-1.5">
                <CheckSquare size={12} />
                <span>Progress</span>
                {isSubtasksExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </div>
              <div className="flex items-center gap-2">
                <span>
                  {completedSubtasks}/{subtasks.length}
                </span>
                <span className={progress === 100 ? "text-emerald-400" : ""}>
                  {Math.round(progress)}%
                </span>
              </div>
            </div>
            <div
              className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5 p-[1px] cursor-pointer"
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
      </>
    )}
  </>
);
