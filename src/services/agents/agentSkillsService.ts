import { STORAGE_KEYS } from "../../constants";
import { callNative } from "../../runtime/runtimeEnvironment";
import storageService from "../storageService";
import type { AgentRun, AgentSkill, Task } from "../../../types";

const MAX_SKILLS = 200;
const MIN_SUMMARY_LENGTH = 40;

type NativeSkill = {
  id: string;
  title: string;
  summary: string;
  workingDir: string;
  taskId: string;
  agentId: string;
  createdAt: number;
};

function toNativeSkill(skill: AgentSkill): NativeSkill {
  return {
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    workingDir: skill.workingDir,
    taskId: skill.taskId,
    agentId: skill.agentId,
    createdAt:
      skill.createdAt instanceof Date ? skill.createdAt.getTime() : new Date(skill.createdAt).getTime(),
  };
}

function fromNativeSkills(records: NativeSkill[]): AgentSkill[] {
  return records.map((record) => ({
    id: record.id,
    title: record.title,
    summary: record.summary,
    workingDir: record.workingDir,
    taskId: record.taskId,
    agentId: record.agentId,
    createdAt: new Date(record.createdAt),
  }));
}

function captureSkillJs(
  skills: AgentSkill[],
  run: AgentRun,
  task: Task,
  workingDir: string,
): AgentSkill[] | null {
  if (run.status !== "completed") return null;
  const summary = (run.summary ?? "").trim();
  if (summary.length < MIN_SUMMARY_LENGTH) return null;

  const filtered = skills.filter(
    (s) => !(s.taskId === task.id && s.workingDir === workingDir),
  );
  filtered.push({
    id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: task.title.slice(0, 200),
    summary: summary.slice(0, 2000),
    workingDir,
    taskId: task.id,
    agentId: run.agentId,
    createdAt: new Date(),
  });

  return filtered
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_SKILLS);
}

/**
 * Skills compounding (Multica-style): every successful run leaves behind a
 * reusable skill — the task and how it was solved — scoped to the working
 * directory it happened in. Future prompts for the same repo include the most
 * recent skills so the team's capability compounds over time.
 */
class AgentSkillsService {
  getSkills(): AgentSkill[] {
    const skills = storageService.get<AgentSkill[]>(STORAGE_KEYS.AGENT_SKILLS, []);
    return (skills ?? []).map((s) => ({
      ...s,
      createdAt: s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt),
    }));
  }

  /** Most recent skills for a repo, newest first. */
  getSkillsForWorkingDir(workingDir: string): AgentSkill[] {
    const dir = workingDir.replace(/\/+$/, "");
    return this.getSkills()
      .filter((s) => s.workingDir.replace(/\/+$/, "") === dir)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Capture a completed run as a skill. No-ops on thin or failed results. */
  async captureFromRun(run: AgentRun, task: Task, workingDir: string): Promise<void> {
    const skills = this.getSkills();
    const response = await callNative<{ captured: boolean; skills: NativeSkill[] }>(
      "agent_skills_capture",
      {
        request: {
          skills: skills.map(toNativeSkill),
          run: { status: run.status, summary: run.summary, agentId: run.agentId },
          task: { id: task.id, title: task.title },
          workingDir,
          nowMs: Date.now(),
        },
      },
      () => {
        const captured = captureSkillJs(skills, run, task, workingDir);
        return captured
          ? { captured: true, skills: captured.map(toNativeSkill) }
          : { captured: false, skills: skills.map(toNativeSkill) };
      },
    );

    if (response.captured) {
      await storageService.set(STORAGE_KEYS.AGENT_SKILLS, fromNativeSkills(response.skills));
    }
  }

  async deleteSkill(id: string): Promise<void> {
    const skills = this.getSkills();
    const updated = await callNative<NativeSkill[]>(
      "agent_skills_delete",
      { request: { skills: skills.map(toNativeSkill), id } },
      () => skills.filter((s) => s.id !== id).map(toNativeSkill),
    );
    await storageService.set(STORAGE_KEYS.AGENT_SKILLS, fromNativeSkills(updated));
  }
}

export const agentSkillsService = new AgentSkillsService();
export default agentSkillsService;
