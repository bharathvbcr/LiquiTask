import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useState } from "react";

/**
 * Maximum diff lines rendered across all file sections. Run diffs can be
 * enormous (lockfiles, vendored deps, generated code); past this point the
 * DOM cost outweighs any review value, so we cut off and say so instead of
 * freezing the drawer.
 */
export const DIFF_LINE_CAP = 2000;

/** One file's worth of a unified diff, ready for rendering. */
export interface DiffFile {
  /** Display path — "old → new" when the file was renamed. */
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  renamed: boolean;
  /** Hunk headers and +/-/context lines only; git metadata is stripped. */
  lines: string[];
}

const FILE_HEADER_RE = /^diff --git a\/(.*) b\/(.*)$/;

/**
 * Git metadata lines carry no review signal in a compact drawer, and the
 * `---`/`+++` markers would otherwise miscount as removed/added lines, so we
 * filter them during parsing rather than at render time.
 */
function isMetadataLine(line: string): boolean {
  return (
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("similarity index") ||
    line.startsWith("dissimilarity index") ||
    line.startsWith("copy from") ||
    line.startsWith("copy to")
  );
}

/**
 * Dependency-free unified-diff parser. `run.gitDiff` comes straight from
 * `git diff` stdout and this app avoids pulling in a diff library for one
 * read-only view, so we split on `diff --git` file headers and classify each
 * following line ourselves.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of diff.split("\n")) {
    const header = line.match(FILE_HEADER_RE);
    if (header) {
      const [, oldPath, newPath] = header;
      current = {
        path: oldPath === newPath ? newPath : `${oldPath} → ${newPath}`,
        added: 0,
        removed: 0,
        binary: false,
        renamed: oldPath !== newPath,
        lines: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue; // preamble before the first file header

    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      current.renamed = true;
      continue;
    }
    if (isMetadataLine(line)) continue;

    if (line.startsWith("@@")) {
      current.lines.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      current.added += 1;
      current.lines.push(line);
      continue;
    }
    if (line.startsWith("-")) {
      current.removed += 1;
      current.lines.push(line);
      continue;
    }
    // Context and "\ No newline" lines are only meaningful inside a hunk.
    if (current.lines.length > 0) current.lines.push(line);
  }

  // Drop a trailing blank produced by split("\n") on a newline-terminated diff.
  for (const file of files) {
    if (file.lines.length > 0 && file.lines[file.lines.length - 1] === "") {
      file.lines.pop();
    }
  }
  return files;
}

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "text-sky-300/80 bg-sky-500/5";
  if (line.startsWith("+")) return "text-emerald-300 bg-emerald-500/10";
  if (line.startsWith("-")) return "text-red-300 bg-red-500/10";
  return "text-slate-400";
}

/**
 * Collapsible per-file section. Open by default so a small diff reads at a
 * glance; the header stays useful (path + counts) when collapsed or when the
 * global line cap swallowed this file's body.
 */
const FileSection: React.FC<{
  file: DiffFile;
  visibleLines: string[];
  omitted: number;
}> = ({ file, visibleLines, omitted }) => {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.05] transition-colors"
        aria-expanded={open}
      >
        <Chevron size={12} className="text-slate-500 shrink-0" aria-hidden />
        <span className="font-mono text-[11px] text-slate-200 truncate flex-1">{file.path}</span>
        {file.renamed && (
          <span className="text-[10px] text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 shrink-0">
            renamed
          </span>
        )}
        {file.binary ? (
          <span className="text-[10px] text-slate-500 shrink-0">binary</span>
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] font-mono shrink-0">
            <span className="text-emerald-400">+{file.added}</span>
            <span className="text-red-400">-{file.removed}</span>
          </span>
        )}
      </button>

      {open && file.binary && (
        <div className="border-t border-white/5 px-3 py-1.5 text-[11px] font-mono text-slate-500">
          Binary files differ
        </div>
      )}
      {open && !file.binary && visibleLines.length > 0 && (
        <div className="border-t border-white/5 font-mono text-[11px] leading-relaxed overflow-x-auto py-1">
          {visibleLines.map((line, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines recomputed each render, no natural id
              key={`${file.path}-${index}`}
              className={`px-3 whitespace-pre ${lineClass(line)}`}
            >
              {line === "" ? " " : line}
            </div>
          ))}
          {omitted > 0 && (
            <div className="px-3 py-1 text-slate-500 italic">
              … {omitted} more line{omitted === 1 ? "" : "s"} hidden
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export interface DiffViewProps {
  /** Raw `git diff` text; undefined/empty renders nothing. */
  diff?: string | null;
  className?: string;
}

/**
 * Read-only renderer for a run's worktree diff. Replaces the raw `<pre>` dump
 * in the run drawer so reviewers can see per-file scope (+N/-N) and skim
 * changes without scanning git plumbing lines.
 */
export const DiffView: React.FC<DiffViewProps> = ({ diff, className = "" }) => {
  if (!diff || diff.trim() === "") return null;

  const files = parseUnifiedDiff(diff);

  // Not a unified diff (e.g. `git diff --stat` output cached by older runs):
  // fall back to a plain mono block rather than rendering nothing.
  if (files.length === 0) {
    const rawLines = diff.split("\n");
    const capped = rawLines.slice(0, DIFF_LINE_CAP);
    return (
      <div className={`space-y-1.5 ${className}`}>
        <pre className="rounded-xl border border-white/5 bg-white/[0.03] p-3 font-mono text-[11px] text-slate-400 whitespace-pre-wrap break-words">
          {capped.join("\n")}
        </pre>
        {rawLines.length > DIFF_LINE_CAP && (
          <div className="text-[10px] text-amber-300/80">
            Diff truncated — showing first {DIFF_LINE_CAP} of {rawLines.length} lines.
          </div>
        )}
      </div>
    );
  }

  // Shared line budget across files: file headers always render so the diff's
  // shape stays visible even when bodies get cut.
  const totalLines = files.reduce((sum, file) => sum + file.lines.length, 0);
  let budget = DIFF_LINE_CAP;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {files.map((file, index) => {
        const visibleLines = budget > 0 ? file.lines.slice(0, budget) : [];
        budget -= visibleLines.length;
        return (
          <FileSection
            // biome-ignore lint/suspicious/noArrayIndexKey: static file list recomputed each render, no natural id
            key={`${file.path}-${index}`}
            file={file}
            visibleLines={visibleLines}
            omitted={file.lines.length - visibleLines.length}
          />
        );
      })}
      {totalLines > DIFF_LINE_CAP && (
        <div className="text-[10px] text-amber-300/80">
          Diff truncated — showing first {DIFF_LINE_CAP} of {totalLines} lines.
        </div>
      )}
    </div>
  );
};

export default DiffView;
