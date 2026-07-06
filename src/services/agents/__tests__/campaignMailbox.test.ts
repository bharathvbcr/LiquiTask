import { describe, expect, it, vi } from "vitest";

import { CampaignMailbox } from "../campaignMailbox";

describe("CampaignMailbox", () => {
  it("delivers a message and counts it as unread", () => {
    const mb = new CampaignMailbox();
    mb.send("lead", "advance", "cmd_new", "commander");
    expect(mb.all("lead")).toHaveLength(1);
    expect(mb.countUnread("lead")).toBe(1);
    expect(mb.all("lead")[0].from).toBe("commander");
  });

  it("rejects a self-send", () => {
    const mb = new CampaignMailbox();
    expect(() => mb.send("lead", "note to self", "info", "lead")).toThrow(/itself/);
  });

  it("excludes special control messages from the unread work count", () => {
    const mb = new CampaignMailbox();
    mb.send("worker1", "work", "task_assigned", "lead");
    mb.send("worker1", "reset", "clear_command", "lead");
    expect(mb.countUnread("worker1")).toBe(1);
    expect(mb.countUnread("worker1", false)).toBe(2);
  });

  it("marks read and drains", () => {
    const mb = new CampaignMailbox();
    const a = mb.send("reviewer", "one", "report_received", "worker1");
    mb.send("reviewer", "two", "report_received", "worker2");
    expect(mb.markRead("reviewer", [a.id])).toBe(1);
    expect(mb.countUnread("reviewer")).toBe(1);
    const drained = mb.drain("reviewer");
    expect(drained.map((m) => m.content)).toEqual(["two"]);
    expect(mb.countUnread("reviewer")).toBe(0);
  });

  it("caps read history but never drops unread mail", () => {
    const mb = new CampaignMailbox();
    for (let i = 0; i < 60; i += 1) mb.send("lead", `m${i}`, "info", "commander");
    const ids = mb.all("lead").slice(0, 40).map((m) => m.id);
    mb.markRead("lead", ids);
    mb.send("lead", "trigger-cap", "info", "commander");
    const read = mb.all("lead").filter((m) => m.read);
    expect(mb.countUnread("lead")).toBe(21);
    expect(read.length).toBeLessThanOrEqual(30);
  });

  it("fires a rising-edge nudge on new mail and re-arms after a drain", () => {
    const mb = new CampaignMailbox();
    const nudge = vi.fn();
    mb.subscribe(nudge);

    mb.send("lead", "one", "cmd_new", "commander");
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge).toHaveBeenLastCalledWith("lead", 1);

    mb.send("lead", "two", "info", "commander");
    expect(nudge).toHaveBeenLastCalledWith("lead", 2);

    mb.drain("lead");
    mb.send("lead", "three", "info", "commander");
    expect(nudge).toHaveBeenLastCalledWith("lead", 1);
  });

  it("does not nudge for special control messages", () => {
    const mb = new CampaignMailbox();
    const nudge = vi.fn();
    mb.subscribe(nudge);
    mb.send("lead", "reset", "clear_command", "commander");
    expect(nudge).not.toHaveBeenCalled();
  });
});
