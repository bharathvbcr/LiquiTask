import type React from "react";
import { useMemo } from "react";

import type { AgentProfile, AgentRun } from "../../types";
import { computeAgentAnalytics } from "../../src/services/agents/agentAnalyticsService";

interface AgentAnalyticsPanelProps {
  agents: AgentProfile[];
  runs: AgentRun[];
}

export const AgentAnalyticsPanel: React.FC<AgentAnalyticsPanelProps> = ({ agents, runs }) => {
  const stats = useMemo(() => computeAgentAnalytics(agents, runs), [agents, runs]);

  if (stats.length === 0) {
    return (
      <p className="text-xs text-slate-600 text-center py-4">
        Create agents and run tasks to see analytics.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 text-left border-b border-white/5">
            <th className="py-2 pr-2">Agent</th>
            <th className="py-2 pr-2">Runs</th>
            <th className="py-2 pr-2">Success</th>
            <th className="py-2 pr-2">Avg $</th>
            <th className="py-2 pr-2">Avg turns</th>
            <th className="py-2 pr-2">Avg time</th>
            <th className="py-2">Gate pass</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.agentId} className="border-b border-white/5 text-slate-300">
              <td className="py-2 pr-2 font-medium text-white">{s.agentName}</td>
              <td className="py-2 pr-2">{s.totalRuns}</td>
              <td className="py-2 pr-2">{(s.successRate * 100).toFixed(0)}%</td>
              <td className="py-2 pr-2">${s.avgCostUsd.toFixed(2)}</td>
              <td className="py-2 pr-2">{s.avgTurns.toFixed(1)}</td>
              <td className="py-2 pr-2">
                {s.avgDurationMs > 0 ? `${Math.round(s.avgDurationMs / 60000)}m` : "—"}
              </td>
              <td className="py-2">
                {s.gatePassRate > 0 || stats.some((x) => x.gatePassRate > 0)
                  ? `${(s.gatePassRate * 100).toFixed(0)}%`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
