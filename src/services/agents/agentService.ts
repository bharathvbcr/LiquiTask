import { STORAGE_KEYS } from "../../constants";
import storageService from "../storageService";
import type { AgentProfile } from "../../../types";

/**
 * CRUD for agent profiles (non-human teammates).
 *
 * Agents are routed by name: a task whose `assignee` equals an agent's name is
 * considered assigned to that agent.
 */
class AgentService {
  private reviveDates(agent: AgentProfile): AgentProfile {
    return {
      ...agent,
      runsOnRecurrence: agent.runsOnRecurrence ?? true,
      createdAt: agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt),
    };
  }

  getAgents(): AgentProfile[] {
    const agents = storageService.get<AgentProfile[]>(STORAGE_KEYS.AGENTS, []);
    return (agents ?? []).map((a) => this.reviveDates(a));
  }

  getAgentById(id: string): AgentProfile | undefined {
    return this.getAgents().find((a) => a.id === id);
  }

  /** Case-insensitive match on the assignee label. */
  getAgentByAssignee(assignee: string | undefined | null): AgentProfile | undefined {
    if (!assignee) return undefined;
    const needle = assignee.trim().toLowerCase();
    if (!needle) return undefined;
    return this.getAgents().find((a) => a.name.trim().toLowerCase() === needle);
  }

  isAgentAssignee(assignee: string | undefined | null): boolean {
    return Boolean(this.getAgentByAssignee(assignee));
  }

  async saveAgent(agent: AgentProfile): Promise<AgentProfile[]> {
    const agents = this.getAgents();
    const index = agents.findIndex((a) => a.id === agent.id);
    if (index >= 0) {
      agents[index] = agent;
    } else {
      agents.push(agent);
    }
    await storageService.set(STORAGE_KEYS.AGENTS, agents);
    return agents;
  }

  async deleteAgent(id: string): Promise<AgentProfile[]> {
    const agents = this.getAgents().filter((a) => a.id !== id);
    await storageService.set(STORAGE_KEYS.AGENTS, agents);
    return agents;
  }

  createDraft(partial?: Partial<AgentProfile>): AgentProfile {
    return {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "",
      provider: "claude-code",
      workingDir: "",
      permissionMode: "acceptEdits",
      sandbox: "host",
      autoPickup: false,
      runsOnRecurrence: true,
      devCouncilVerify: false,
      gitWorktree: false,
      role: "default",
      modelRouting: "fixed",
      createdAt: new Date(),
      ...partial,
    };
  }
}

export const agentService = new AgentService();
export default agentService;
