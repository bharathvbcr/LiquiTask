import { AlertTriangle, Copy } from "lucide-react";
import type React from "react";
import type { ParseWarning, ParsedTask, QuickAddTokenKind, QuickAddTokenSegment } from "../utils/taskParser";
import { resolveParsedPriority } from "../utils/taskParser";
import type { PriorityDefinition, Project } from "../../types";

interface QuickAddPreviewProps {
  syntaxSegments: QuickAddTokenSegment[];
  parsed: ParsedTask | null;
  warnings: ParseWarning[];
  priorities: PriorityDefinition[];
  projects: Project[];
  matchProjectByName: (name?: string) => Project | undefined;
  priorityPreviewStyle?: React.CSSProperties;
  onCopyPreview?: () => void;
}

export const QuickAddPreview: React.FC<QuickAddPreviewProps> = ({
  syntaxSegments,
  parsed,
  warnings,
  priorities,
  matchProjectByName,
  priorityPreviewStyle,
  onCopyPreview,
}) => {
  return (
    <>
      {syntaxSegments.length > 0 && (
        <div
          aria-hidden="true"
          className="px-4 py-2 rounded-lg bg-black/20 border border-white/5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
        >
          {syntaxSegments.map((segment, index) => (
            <span key={`${segment.kind}-${index}-${segment.text}`} className={quickAddTokenClass(segment.kind)}>
              {segment.text}
            </span>
          ))}
        </div>
      )}

      {parsed && (
        <div className="flex flex-wrap items-center gap-2 px-1 py-2 border-b border-white/5">
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Preview</span>
          <span className="text-xs text-slate-300">{parsed.title || "Task name…"}</span>
          {parsed.description && (
            <span className="text-[10px] text-slate-500 truncate max-w-[200px]" title={parsed.description}>
              {parsed.description}
            </span>
          )}
          {onCopyPreview && (
            <button
              type="button"
              onClick={onCopyPreview}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
              aria-label="Copy parsed preview"
            >
              <Copy size={10} />
              Copy
            </button>
          )}
          {parsed.priority && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-transparent"
              style={priorityPreviewStyle}
            >
              {resolveParsedPriority(parsed.priority, priorities) ?? parsed.priority}
            </span>
          )}
          {parsed.dueDate && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
              {parsed.dueDate.getHours() !== 0 || parsed.dueDate.getMinutes() !== 0
                ? parsed.dueDate.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : parsed.dueDate.toLocaleDateString()}
            </span>
          )}
          {parsed.timeEstimate && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
              ~{parsed.timeEstimate}m
            </span>
          )}
          {parsed.projectName && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] ${
                matchProjectByName(parsed.projectName)
                  ? "bg-white/10 text-slate-300"
                  : "bg-white/10 text-slate-500 line-through"
              }`}
            >
              #{matchProjectByName(parsed.projectName)?.name ?? parsed.projectName}
            </span>
          )}
          {parsed.filePaths.map((path) => (
            <span key={path} className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300 font-mono">
              @{path}
            </span>
          ))}
          {parsed.links.map((link) => (
            <span key={link} className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300 font-mono truncate max-w-[160px]">
              &{link}
            </span>
          ))}
          {parsed.subtaskTitles.map((subtask) => (
            <span key={subtask} className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-400">
              &gt;&gt;{subtask}
            </span>
          ))}
          {parsed.recurringFrequency && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
              *{parsed.recurringFrequency}
              {parsed.recurringInterval && parsed.recurringInterval > 1 ? parsed.recurringInterval : ""}
            </span>
          )}
          {parsed.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-400">
              +{tag}
            </span>
          ))}
          {parsed.assignee && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
              &gt;{parsed.assignee}
            </span>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1 px-1">
          {warnings.map((warning) => (
            <p
              key={`${warning.code}-${warning.message}`}
              className="text-[11px] text-amber-400/90 flex items-start gap-1.5"
            >
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {warning.message}
            </p>
          ))}
        </div>
      )}
    </>
  );
};

function quickAddTokenClass(kind: QuickAddTokenKind): string {
  switch (kind) {
    case "title":
      return "text-red-300";
    case "priority":
      return "text-red-400 font-bold";
    case "date":
      return "text-slate-200";
    case "file":
      return "text-slate-300 underline decoration-white/20";
    case "project":
      return "text-slate-300";
    case "tag":
      return "text-slate-400";
    case "assignee":
      return "text-slate-200";
    case "agent":
      return "text-red-300/90";
    case "estimate":
      return "text-slate-300";
    case "link":
      return "text-slate-300 underline decoration-red-500/30";
    case "recurring":
      return "text-slate-200";
    case "subtask":
      return "text-slate-400";
    default:
      return "text-slate-500";
  }
}
