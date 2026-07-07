import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { FEATURE_FLAGS } from "../../../constants";
import { localApi } from "../localApi";

/** Toggle the sidecar flag for a test; readonly at the type level only. */
function setAgentdEnabled(value: boolean) {
  (FEATURE_FLAGS as { AGENTD_SIDECAR_ENABLED: boolean }).AGENTD_SIDECAR_ENABLED = value;
}

const AGENTD_DEFAULT = FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED;

describe("localApi agentd routing", () => {
  afterEach(() => {
    setAgentdEnabled(AGENTD_DEFAULT);
    invokeMock.mockReset();
  });

  it("routes detectRuntimes to the legacy command when the sidecar flag is off", async () => {
    setAgentdEnabled(false);
    invokeMock.mockResolvedValue([]);
    await localApi.detectRuntimes();
    expect(invokeMock).toHaveBeenCalledWith("agent_detect_clis", undefined);
  });

  it("routes detectRuntimes to agentd when the sidecar flag is on", async () => {
    setAgentdEnabled(true);
    invokeMock.mockResolvedValue([]);
    await localApi.detectRuntimes();
    expect(invokeMock).toHaveBeenCalledWith("agentd_detect", undefined);
  });

  it("routes runStart to agentd with the mapped params when enabled", async () => {
    setAgentdEnabled(true);
    invokeMock.mockResolvedValue("run-123");
    const runId = await localApi.runStart({
      taskId: "t1",
      runtime: "claude",
      prompt: "do the thing",
      model: "opus",
      thinkingLevel: "high",
    });
    expect(runId).toBe("run-123");
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_start", {
      taskId: "t1",
      runtime: "claude",
      prompt: "do the thing",
      cwd: undefined,
      model: "opus",
      resumeSessionId: undefined,
      thinkingLevel: "high",
      mcpConfig: undefined,
    });
  });

  it("routes runStart to the legacy command when disabled", async () => {
    setAgentdEnabled(false);
    invokeMock.mockResolvedValue("run-legacy");
    await localApi.runStart({ taskId: "t1", runtime: "claude", prompt: "hi" });
    expect(invokeMock).toHaveBeenCalledWith("agent_run_start", {
      taskId: "t1",
      runtime: "claude",
      prompt: "hi",
    });
  });

  it("routes cancel/pause/resume/inject/reattach to agentd commands when enabled", async () => {
    setAgentdEnabled(true);
    invokeMock.mockResolvedValue(undefined);

    await localApi.runCancel("r1");
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_cancel", { runId: "r1" });

    await localApi.runPause("r1");
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_pause", { runId: "r1" });

    await localApi.runResume("r1");
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_resume", { runId: "r1" });

    await localApi.runInject("r1", "keep going");
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_inject", { runId: "r1", guidance: "keep going" });

    invokeMock.mockResolvedValue([]);
    await localApi.runReattach();
    expect(invokeMock).toHaveBeenCalledWith("agentd_run_reattach", undefined);

    await localApi.permissionRespond("r1", "req1", "allow");
    expect(invokeMock).toHaveBeenCalledWith("agentd_permission_respond", {
      runId: "r1",
      requestId: "req1",
      decision: "allow",
    });
  });

  it("routes cancel/pause/resume/inject/reattach to legacy commands when disabled", async () => {
    setAgentdEnabled(false);
    invokeMock.mockResolvedValue(undefined);

    await localApi.runCancel("r1");
    expect(invokeMock).toHaveBeenCalledWith("agent_run_cancel", { runId: "r1" });

    await localApi.runPause("r1");
    expect(invokeMock).toHaveBeenCalledWith("agent_runner_pause", { runId: "r1" });

    await localApi.runResume("r1");
    expect(invokeMock).toHaveBeenCalledWith("agent_runner_resume", { runId: "r1" });

    await localApi.runInject("r1", "keep going");
    expect(invokeMock).toHaveBeenCalledWith("agent_runner_inject_guidance", {
      runId: "r1",
      guidance: "keep going",
    });

    invokeMock.mockResolvedValue([]);
    await localApi.runReattach();
    expect(invokeMock).toHaveBeenCalledWith("agent_runs_reattach", undefined);

    // No legacy equivalent for inline permission prompts.
    const result = await localApi.permissionRespond("r1", "req1", "allow");
    expect(result).toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalledWith("agentd_permission_respond", expect.anything());
  });

  it("ensureAgentd always calls agentd_ensure regardless of the flag", async () => {
    invokeMock.mockResolvedValue(true);
    await localApi.ensureAgentd();
    expect(invokeMock).toHaveBeenCalledWith("agentd_ensure", undefined);
  });

  it("listSkills calls agentd_skills_list when enabled and returns undefined when disabled", async () => {
    setAgentdEnabled(true);
    invokeMock.mockResolvedValue([{ key: "foo", name: "foo", source_path: "~/.claude/skills/foo", provider: "claude", file_count: 1 }]);
    const enabled = await localApi.listSkills("claude");
    expect(invokeMock).toHaveBeenCalledWith("agentd_skills_list", { provider: "claude" });
    expect(enabled).toHaveLength(1);

    setAgentdEnabled(false);
    invokeMock.mockClear();
    const disabled = await localApi.listSkills("claude");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(disabled).toBeUndefined();
  });
});
