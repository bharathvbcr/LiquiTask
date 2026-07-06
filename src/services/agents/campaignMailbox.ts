/**
 * Campaign mailbox — the in-app message bus + "you have mail" nudge.
 *
 * The desktop port of the original's per-agent inbox files. Each agent has a
 * message list; senders append to the recipient's box and a rising-edge nudge
 * wakes any subscriber (the browser analogue of the `inboxN` tmux keystroke).
 * Message *content* never rides the nudge — subscribers read the mailbox
 * themselves. Self-sends are rejected and each box is capped so a long campaign
 * cannot grow unbounded.
 */

import type { CampaignMessage, CampaignMessageType } from "./campaignTypes";
import { CAMPAIGN_SPECIAL_TYPES } from "./campaignTypes";

const MAX_MESSAGES = 50;
const MAX_READ_RETAINED = 30;

type NudgeListener = (agent: string, unreadCount: number) => void;

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `msg-${Date.now().toString(36)}-${counter.toString(36)}`;
};

export class CampaignMailbox {
  private boxes = new Map<string, CampaignMessage[]>();
  private nudgeListeners = new Set<NudgeListener>();
  /** Last unread count we nudged for, per agent — drives rising-edge delivery. */
  private lastNudge = new Map<string, number>();

  // -- io ---------------------------------------------------------------------

  private box(agent: string): CampaignMessage[] {
    let list = this.boxes.get(agent);
    if (!list) {
      list = [];
      this.boxes.set(agent, list);
    }
    return list;
  }

  private cap(messages: CampaignMessage[]): CampaignMessage[] {
    if (messages.length <= MAX_MESSAGES) return messages;
    const unread = messages.filter((m) => !m.read);
    const read = messages.filter((m) => m.read).slice(-MAX_READ_RETAINED);
    const keep = new Set<CampaignMessage>([...unread, ...read]);
    return messages.filter((m) => keep.has(m));
  }

  // -- public api -------------------------------------------------------------

  /** Append a message to `target`'s mailbox. Throws on a self-send. */
  send(
    target: string,
    content: string,
    type: CampaignMessageType = "info",
    from = "commander",
  ): CampaignMessage {
    if (target === from) {
      throw new Error(`${from} may not send mail to itself`);
    }
    const message: CampaignMessage = {
      id: nextId(),
      from,
      timestamp: Date.now(),
      type,
      content,
      read: false,
    };
    const next = this.cap([...this.box(target), message]);
    this.boxes.set(target, next);
    this.maybeNudge(target);
    return message;
  }

  all(agent: string): CampaignMessage[] {
    return [...this.box(agent)];
  }

  unread(agent: string): CampaignMessage[] {
    return this.box(agent).filter((m) => !m.read);
  }

  countUnread(agent: string, excludeSpecial = true): number {
    return this.box(agent).filter(
      (m) => !m.read && (!excludeSpecial || !CAMPAIGN_SPECIAL_TYPES.has(m.type)),
    ).length;
  }

  markRead(agent: string, ids?: string[]): number {
    const target = ids ? new Set(ids) : null;
    let changed = 0;
    for (const m of this.box(agent)) {
      if (!m.read && (!target || target.has(m.id))) {
        m.read = true;
        changed += 1;
      }
    }
    if (changed) this.rearm(agent);
    return changed;
  }

  drain(agent: string, excludeSpecial = false): CampaignMessage[] {
    const picked: CampaignMessage[] = [];
    for (const m of this.box(agent)) {
      if (m.read) continue;
      if (excludeSpecial && CAMPAIGN_SPECIAL_TYPES.has(m.type)) continue;
      m.read = true;
      picked.push(m);
    }
    if (picked.length) this.rearm(agent);
    return picked;
  }

  clear(agent?: string): void {
    if (agent) {
      this.boxes.delete(agent);
      this.lastNudge.delete(agent);
    } else {
      this.boxes.clear();
      this.lastNudge.clear();
    }
  }

  /** Register a nudge listener; returns an unsubscribe fn. */
  subscribe(listener: NudgeListener): () => void {
    this.nudgeListeners.add(listener);
    return () => this.nudgeListeners.delete(listener);
  }

  // -- nudge ------------------------------------------------------------------

  private maybeNudge(agent: string): void {
    const count = this.countUnread(agent);
    const previous = this.lastNudge.get(agent) ?? 0;
    if (count > previous && count > 0) {
      this.lastNudge.set(agent, count);
      for (const listener of this.nudgeListeners) listener(agent, count);
    }
  }

  /** After a read/drain, lower the watermark so the next arrival nudges again. */
  private rearm(agent: string): void {
    this.lastNudge.set(agent, this.countUnread(agent));
  }
}

export const campaignMailbox = new CampaignMailbox();
export default campaignMailbox;
