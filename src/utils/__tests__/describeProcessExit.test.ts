import { describe, expect, it } from "vitest";
import type { AgentRun } from "../../../types";
import { describeProcessExit } from "../runProgress";

const withEvents = (texts: Array<{ kind: AgentRun["events"][number]["kind"]; text: string }>) =>
  ({
    events: texts.map((t) => ({ ts: new Date(), kind: t.kind, text: t.text })),
  }) as Pick<AgentRun, "events">;

describe("describeProcessExit", () => {
  it("explains a missing/-1 code as a termination, not a real exit", () => {
    const msg = describeProcessExit(-1);
    expect(msg).toMatch(/terminated before it finished/i);
    expect(msg).not.toMatch(/code -1/);
  });

  it("treats a nullish code the same as -1", () => {
    expect(describeProcessExit(undefined)).toMatch(/terminated/i);
    expect(describeProcessExit(null)).toMatch(/terminated/i);
  });

  it("decodes a 128+signal code into the signal name", () => {
    expect(describeProcessExit(137)).toMatch(/SIGKILL \(9\).*out-of-memory/i);
    expect(describeProcessExit(143)).toMatch(/SIGTERM \(15\)/i);
    expect(describeProcessExit(130)).toMatch(/SIGINT \(2\)/i);
  });

  it("reports a plain non-zero code verbatim", () => {
    expect(describeProcessExit(2)).toMatch(/exited with code 2/i);
  });

  it("appends the last stderr/result output for diagnosis", () => {
    const msg = describeProcessExit(-1, withEvents([
      { kind: "assistant", text: "working..." },
      { kind: "stderr", text: "fatal: out of memory\n  at heap" },
    ]));
    expect(msg).toMatch(/Last output: fatal: out of memory/);
  });

  it("omits the 'Last output' suffix when there is none", () => {
    expect(describeProcessExit(-1, withEvents([]))).not.toMatch(/Last output/);
  });
});
