import { GitPullRequest } from "lucide-react";
import type React from "react";
import type { TaskPrState } from "../../../types";
import { getSafeExternalUrl } from "../../utils/safeUrl";

interface TaskCardPrChipProps {
  prState?: TaskPrState;
  compact?: boolean;
}

function ciLabel(ci: NonNullable<TaskPrState["ci"]>): string {
  if (ci.allPassed) return "CI pass";
  if (ci.failed > 0) return `CI ${ci.failed} fail`;
  if (ci.pending > 0) return "CI pending";
  if (ci.passed > 0) return `CI ${ci.passed} pass`;
  return "CI";
}

function reviewLabel(review: NonNullable<TaskPrState["review"]>): string {
  switch (review.decision) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    case "commented":
      return review.unresolvedThreads
        ? `${review.unresolvedThreads} thread(s)`
        : "Review comments";
    default:
      return "Review pending";
  }
}

export const TaskCardPrChip: React.FC<TaskCardPrChipProps> = ({ prState, compact = false }) => {
  if (!prState?.url && !prState?.state) return null;

  const safeUrl = prState.url ? getSafeExternalUrl(prState.url) : null;
  const state = prState.state ?? "open";
  const stateTone =
    state === "merged"
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : state === "closed"
        ? "text-slate-400 border-white/10 bg-white/5"
        : prState.ci?.failed
          ? "text-red-300 border-red-500/30 bg-red-500/10"
          : "text-amber-300 border-amber-500/30 bg-amber-500/10";

  const parts: string[] = [];
  if (prState.prNumber) parts.push(`#${prState.prNumber}`);
  else if (state === "draft") parts.push("Draft");
  else if (state === "open") parts.push("Open");
  else parts.push(state);

  if (prState.ci) parts.push(ciLabel(prState.ci));
  if (prState.review?.decision && prState.review.decision !== "pending") {
    parts.push(reviewLabel(prState.review));
  }

  const label = parts.join(" · ");

  const chip = (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${stateTone}`}
      title={label}
    >
      <GitPullRequest size={10} className="shrink-0" />
      <span className="truncate">{compact ? parts[0] : label}</span>
    </span>
  );

  if (safeUrl) {
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-flex max-w-full"
      >
        {chip}
      </a>
    );
  }

  return <div className="mt-2 inline-flex max-w-full">{chip}</div>;
};
