import { describe, expect, it } from "vitest";
import type { DevVerifyResult } from "../../nativeBridge";
import { evaluateVerifyGate } from "../mergePipelineService";

const verdict = (over: Partial<DevVerifyResult>): DevVerifyResult =>
  ({
    ok: true,
    cli_available: true,
    verified_tasks: 0,
    blocked_tasks: 0,
    total_gaps: 0,
    tasks: [],
    ...over,
  }) as DevVerifyResult;

const gap = (blocking: boolean, description: string) =>
  ({
    id: "g1",
    severity: "high",
    gap_type: "test",
    description,
    evidence: [],
    recommended_fix: "",
    blocking,
  }) as DevVerifyResult["tasks"][number]["gaps"][number];

const taskResult = (gaps: ReturnType<typeof gap>[]) =>
  ({
    task_id: "t1",
    status: "verified",
    gap_count: gaps.length,
    blocking_gap_count: gaps.filter((g) => g.blocking).length,
    gaps,
    next_actions: [],
    advisory_actions: [],
  }) as DevVerifyResult["tasks"][number];

describe("evaluateVerifyGate", () => {
  it("passes when there are no blocking gaps and no blocked tasks (the 0-gap bug)", () => {
    // ok=false but nothing concretely blocking — must NOT block the merge.
    expect(evaluateVerifyGate(verdict({ ok: false }))).toEqual({
      passed: true,
      blockingGaps: [],
      blockCount: 0,
    });
  });

  it("passes on a clean verdict", () => {
    expect(evaluateVerifyGate(verdict({ ok: true })).passed).toBe(true);
  });

  it("blocks when there are blocking gaps, with a count > 0 and descriptions", () => {
    const g = evaluateVerifyGate(
      verdict({
        ok: false,
        tasks: [taskResult([gap(true, "missing test"), gap(false, "style nit")])],
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.blockCount).toBe(1);
    expect(g.blockingGaps).toEqual(["missing test"]);
  });

  it("blocks when blocked_tasks > 0 even without surfaced gap descriptions", () => {
    const g = evaluateVerifyGate(verdict({ ok: false, blocked_tasks: 2 }));
    expect(g.passed).toBe(false);
    expect(g.blockCount).toBe(2);
  });

  it("ignores advisory (non-blocking) gaps", () => {
    const g = evaluateVerifyGate(verdict({ tasks: [taskResult([gap(false, "advisory only")])] }));
    expect(g.passed).toBe(true);
    expect(g.blockingGaps).toEqual([]);
  });
});
