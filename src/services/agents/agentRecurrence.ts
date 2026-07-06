import type { AgentProfile } from "../../../types";

/** Whether a recurring task instance should auto-start a run for this agent. */
export function shouldRunAgentOnRecurrence(agent: AgentProfile): boolean {
  return agent.runsOnRecurrence !== false;
}
