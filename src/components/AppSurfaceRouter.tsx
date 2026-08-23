import type React from "react";
import { Suspense, lazy } from "react";

import { PanelBoundary } from "./ErrorBoundary";
import { ViewTransition } from "./ViewTransition";
import type { AppSurface } from "../hooks/useAppSurface";

const SURFACE_LABELS: Record<AppSurface, string> = {
  inbox: "Inbox",
  board: "Board",
  agents: "Agents",
};

import type { InboxViewProps } from "../views/inbox/InboxView";
import type { AgentsViewProps } from "../views/agents/AgentsView";

const InboxView = lazy(() =>
  import("../views/inbox/InboxView").then((module) => ({ default: module.InboxView })),
);
const AgentsView = lazy(() =>
  import("../views/agents/AgentsView").then((module) => ({ default: module.AgentsView })),
);

const ViewLoadingFallback: React.FC = () => (
  <div className="h-full w-full flex items-center justify-center text-slate-500">
    <span className="text-sm">Loading view...</span>
  </div>
);

export interface AppSurfaceRouterProps {
  v3Enabled: boolean;
  /** Inbox and Agents are agent-execution surfaces; the Board is always shown. */
  agentExecutionEnabled: boolean;
  activeSurface: AppSurface;
  onSurfaceChange: (surface: AppSurface) => void;
  activeProjectId: string;
  viewMode: string;
  /** Legacy shell view key when v3 is disabled. */
  legacyViewKey?: string;
  boardLensContent: React.ReactNode;
  inbox: InboxViewProps;
  agents: AgentsViewProps;
}

/**
 * v3 shell surface switcher + routed content (Inbox / Board / Agents).
 * Run is an overlay mounted by App, not a tab here.
 */
export const AppSurfaceRouter: React.FC<AppSurfaceRouterProps> = ({
  v3Enabled,
  agentExecutionEnabled,
  activeSurface,
  onSurfaceChange,
  activeProjectId,
  viewMode,
  legacyViewKey,
  boardLensContent,
  inbox,
  agents,
}) => {
  if (!v3Enabled) {
    return (
      <ViewTransition
        transitionKey={`${legacyViewKey ?? "board"}-${activeProjectId}-${viewMode}`}
        type="fade"
        duration={400}
        className="h-full"
      >
        <Suspense fallback={<ViewLoadingFallback />}>
          <PanelBoundary name="Board">{boardLensContent}</PanelBoundary>
        </Suspense>
      </ViewTransition>
    );
  }

  const surfaces = (["inbox", "board", "agents"] as const).filter(
    (surface) => agentExecutionEnabled || surface === "board",
  );
  const effectiveSurface = agentExecutionEnabled ? activeSurface : "board";

  return (
    <>
      <div className="flex items-center gap-1 mb-4 rounded-xl border border-white/10 bg-black/20 p-1 w-fit">
        {surfaces.map((surface) => (
          <button
            key={surface}
            type="button"
            onClick={() => onSurfaceChange(surface)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              effectiveSurface === surface
                ? "bg-red-500/20 text-red-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {SURFACE_LABELS[surface]}
          </button>
        ))}
      </div>
      <ViewTransition
        transitionKey={`${effectiveSurface}-${activeProjectId}-${viewMode}`}
        type="fade"
        duration={400}
        className="h-full"
      >
        <Suspense fallback={<ViewLoadingFallback />}>
          {effectiveSurface === "inbox" ? (
            <PanelBoundary name="Inbox">
              <InboxView {...inbox} />
            </PanelBoundary>
          ) : effectiveSurface === "agents" ? (
            <PanelBoundary name="Agents">
              <AgentsView {...agents} />
            </PanelBoundary>
          ) : (
            <PanelBoundary name="Board">{boardLensContent}</PanelBoundary>
          )}
        </Suspense>
      </ViewTransition>
    </>
  );
};
