/**
 * Push notifications to the user — a port of the original's ntfy push.
 *
 * When a team run finishes (or a task is blocked) a one-line push can go to an
 * [ntfy](https://ntfy.sh) topic so the user can watch progress from a phone. A
 * missing topic is a silent no-op; a failed push never breaks a run.
 */

export interface CampaignNotifierOptions {
  topic?: string;
  server?: string;
  enabled?: boolean;
}

export interface CampaignNotifyMeta {
  title?: string;
  priority?: string;
  tags?: string[];
}

export class CampaignNotifier {
  readonly topic: string;
  readonly server: string;
  readonly enabled: boolean;
  /** Every message we attempted to send (for the dashboard / tests). */
  readonly sent: string[] = [];

  constructor(options: CampaignNotifierOptions = {}) {
    this.topic = options.topic ?? "";
    this.server = (options.server ?? "https://ntfy.sh").replace(/\/+$/, "");
    this.enabled = options.enabled ?? Boolean(this.topic);
  }

  async notify(message: string, meta: CampaignNotifyMeta = {}): Promise<boolean> {
    this.sent.push(message);
    if (!this.enabled || !this.topic) return false;
    try {
      const headers: Record<string, string> = {};
      if (meta.title) headers.Title = meta.title;
      if (meta.priority) headers.Priority = meta.priority;
      if (meta.tags?.length) headers.Tags = meta.tags.join(",");
      const resp = await fetch(`${this.server}/${this.topic}`, {
        method: "POST",
        body: message,
        headers,
      });
      return resp.ok;
    } catch {
      // Never let a notification failure abort the campaign.
      return false;
    }
  }
}

export const nullNotifier = new CampaignNotifier({ enabled: false });
