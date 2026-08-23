import { describe, expect, it } from "vitest";

import { COLUMN_STATUS } from "../../../constants";
import {
  ALLOWED_TRANSITIONS,
  isCanonicalStatus,
  validateTransition,
  type TransitionContext,
} from "../boardStateMachine";

const { TASK, IN_PROGRESS, COMPLETED, IN_REVIEW, COMMIT } = COLUMN_STATUS;

const user = (extra: Partial<TransitionContext> = {}): TransitionContext => ({
  actor: "user",
  ...extra,
});
const agent = (extra: Partial<TransitionContext> = {}): TransitionContext => ({
  actor: "agent",
  ...extra,
});
const system = (extra: Partial<TransitionContext> = {}): TransitionContext => ({
  actor: "system",
  ...extra,
});

describe("boardStateMachine", () => {
  it("recognises the five canonical statuses", () => {
    expect(isCanonicalStatus(TASK)).toBe(true);
    expect(isCanonicalStatus(IN_REVIEW)).toBe(true);
    expect(isCanonicalStatus(COMMIT)).toBe(true);
    expect(isCanonicalStatus("col-123456")).toBe(false);
  });

  it("declares no outgoing edges from Commit", () => {
    expect(ALLOWED_TRANSITIONS[COMMIT]).toEqual([]);
  });

  it("allows Completed → InReview for users and system with an open PR", () => {
    expect(validateTransition(COMPLETED, IN_REVIEW, user()).allowed).toBe(true);
    expect(validateTransition(COMPLETED, IN_REVIEW, system({ hasPrOpen: true })).allowed).toBe(
      true,
    );
    expect(validateTransition(COMPLETED, IN_REVIEW, system({ hasPrOpen: false })).allowed).toBe(
      false,
    );
    expect(
      validateTransition(COMPLETED, IN_REVIEW, system({ hasPrOpen: false, localReviewerGate: true }))
        .allowed,
    ).toBe(true);
  });

  it("blocks agents from In Review and Commit", () => {
    expect(validateTransition(COMPLETED, IN_REVIEW, agent()).allowed).toBe(false);
    expect(validateTransition(IN_REVIEW, COMMIT, agent()).allowed).toBe(false);
  });

  it("requires PR merge before InReview → Commit unless via merge pipeline", () => {
    expect(
      validateTransition(IN_REVIEW, COMMIT, user({ hasPrOpen: true, prMerged: false })).allowed,
    ).toBe(false);
    expect(
      validateTransition(IN_REVIEW, COMMIT, user({ hasPrOpen: true, prMerged: true })).allowed,
    ).toBe(true);
    expect(
      validateTransition(
        IN_REVIEW,
        COMMIT,
        user({ hasPrOpen: true, prMerged: false, viaMergePipeline: true }),
      ).allowed,
    ).toBe(true);
  });

  describe("forward flow", () => {
    it("allows Task → InProgress and flags the agent-run side effect", () => {
      const verdict = validateTransition(TASK, IN_PROGRESS, user());
      expect(verdict.allowed).toBe(true);
      expect(verdict.requires).toBe("agent-run");
    });

    it("requires scope-release when overlapping scope is held", () => {
      const verdict = validateTransition(
        TASK,
        IN_PROGRESS,
        user({ scopeReservationHeld: true, scopeHeldByLabel: "run on task abc" }),
      );
      expect(verdict.allowed).toBe(true);
      expect(verdict.requires).toBe("scope-release");
    });

    it("allows InProgress → Completed", () => {
      expect(validateTransition(IN_PROGRESS, COMPLETED, user()).allowed).toBe(true);
    });

    it("rejects Task → Completed (skipping In Progress)", () => {
      const verdict = validateTransition(TASK, COMPLETED, user());
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/In Progress/);
    });

    it("rejects Task → Commit and InProgress → Commit", () => {
      expect(validateTransition(TASK, COMMIT, user()).allowed).toBe(false);
      expect(validateTransition(IN_PROGRESS, COMMIT, user()).allowed).toBe(false);
    });

    it("rejects skipping straight to In Review", () => {
      expect(validateTransition(TASK, IN_REVIEW, user()).allowed).toBe(false);
      expect(validateTransition(IN_PROGRESS, IN_REVIEW, user()).allowed).toBe(false);
    });
  });

  describe("Commit gating", () => {
    it("allows Completed → Commit for plain (no-worktree) tasks", () => {
      expect(validateTransition(COMPLETED, COMMIT, user()).allowed).toBe(true);
    });

    it("requires the merge pipeline when unmerged agent work exists", () => {
      const verdict = validateTransition(COMPLETED, COMMIT, user({ hasUnmergedWork: true }));
      expect(verdict.allowed).toBe(true);
      expect(verdict.requires).toBe("merge-pipeline");
    });

    it("passes when the merge pipeline itself executes the move", () => {
      const verdict = validateTransition(
        COMPLETED,
        COMMIT,
        user({ hasUnmergedWork: true, viaMergePipeline: true }),
      );
      expect(verdict.allowed).toBe(true);
      expect(verdict.requires).toBeUndefined();
    });

    it("blocks Commit while a run is still active", () => {
      expect(
        validateTransition(COMPLETED, COMMIT, user({ hasActiveRun: true })).allowed,
      ).toBe(false);
    });

    it("never lets agents enter Commit", () => {
      expect(validateTransition(COMPLETED, COMMIT, agent()).allowed).toBe(false);
    });

    it("treats Commit as terminal unless explicitly reopened to Task", () => {
      expect(validateTransition(COMMIT, IN_PROGRESS, user()).allowed).toBe(false);
      expect(validateTransition(COMMIT, TASK, user()).allowed).toBe(false);
      expect(validateTransition(COMMIT, TASK, user({ reopen: true })).allowed).toBe(true);
      expect(validateTransition(COMMIT, TASK, agent({ reopen: true })).allowed).toBe(false);
    });

    it("reopen only un-merges back to Task — not sideways or forward", () => {
      expect(validateTransition(COMMIT, IN_PROGRESS, user({ reopen: true })).allowed).toBe(false);
      expect(validateTransition(COMMIT, COMPLETED, user({ reopen: true })).allowed).toBe(false);
      expect(validateTransition(COMMIT, IN_REVIEW, user({ reopen: true })).allowed).toBe(false);
    });

    it("reopen is honored for non-agent actors but never agents", () => {
      expect(validateTransition(COMMIT, TASK, system({ reopen: true })).allowed).toBe(true);
      expect(
        validateTransition(COMMIT, TASK, { actor: "automation", reopen: true }).allowed,
      ).toBe(true);
      expect(validateTransition(COMMIT, TASK, agent({ reopen: true })).reason).toMatch(
        /terminal/i,
      );
    });
  });

  describe("agent actor restrictions", () => {
    it("lets agents pick up only from the backlog", () => {
      expect(validateTransition(TASK, IN_PROGRESS, agent()).allowed).toBe(true);
      expect(validateTransition(COMPLETED, IN_PROGRESS, agent()).allowed).toBe(false);
    });

    it("lets agents complete only from In Progress", () => {
      expect(validateTransition(IN_PROGRESS, COMPLETED, agent()).allowed).toBe(true);
      expect(validateTransition("custom-lane", COMPLETED, agent()).allowed).toBe(false);
    });

    it("blocks agents from parking cards in backlog/custom lanes", () => {
      expect(validateTransition(IN_PROGRESS, TASK, agent()).allowed).toBe(false);
      expect(validateTransition(IN_PROGRESS, "custom-lane", agent()).allowed).toBe(false);
    });
  });

  describe("guards", () => {
    it("blocks starting work on blocked tasks, with the blocker named", () => {
      const verdict = validateTransition(
        TASK,
        IN_PROGRESS,
        user({ blockedByOpen: true, blockedByLabel: "task TSK-7" }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain("TSK-7");
    });

    it("enforces WIP limits", () => {
      expect(
        validateTransition(TASK, IN_PROGRESS, user({ wipExceeded: true })).allowed,
      ).toBe(false);
    });

    it("relaxes blockers/WIP for the system actor (run lifecycle facts)", () => {
      expect(
        validateTransition(TASK, IN_PROGRESS, {
          actor: "system",
          blockedByOpen: true,
          wipExceeded: true,
        }).allowed,
      ).toBe(true);
    });

    it("still enforces structural rules for the system actor", () => {
      expect(
        validateTransition(TASK, COMPLETED, { actor: "system" }).allowed,
      ).toBe(false);
    });
  });

  describe("reverse + custom lanes", () => {
    it("allows rework (Completed/InReview → InProgress) and abort (InProgress → Task)", () => {
      expect(validateTransition(COMPLETED, IN_PROGRESS, user()).allowed).toBe(true);
      expect(validateTransition(IN_REVIEW, IN_PROGRESS, user()).allowed).toBe(true);
      expect(validateTransition(IN_PROGRESS, TASK, user()).allowed).toBe(true);
    });

    it("allows users to shuffle custom lanes but respects blockers", () => {
      expect(validateTransition(TASK, "custom-lane", user()).allowed).toBe(true);
      expect(
        validateTransition(TASK, "custom-lane", user({ blockedByOpen: true })).allowed,
      ).toBe(false);
    });

    it("treats same-column drops as reorders", () => {
      expect(validateTransition(COMMIT, COMMIT, user()).allowed).toBe(true);
    });
  });
});
