import { STORAGE_KEYS } from "../constants";
import storageService from "../services/storageService";
import { persistStorageQuiet } from "./persistStorage";

export interface NotificationPreferences {
  /** Suppress OS notifications during the configured window. */
  quietHoursEnabled: boolean;
  /** Local time `HH:mm` when quiet hours start (inclusive). */
  quietHoursStart: string;
  /** Local time `HH:mm` when quiet hours end (exclusive). */
  quietHoursEnd: string;
  /** Minutes before due time to fire the "due soon" reminder. */
  dueDateLeadMinutes: number;
  /** Periodic checks that notify when tasks become overdue. */
  overdueNudgesEnabled: boolean;
  /** OS notifications for agent permission prompts, queue waits, and run outcomes. */
  agentAttentionEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  dueDateLeadMinutes: 60,
  overdueNudgesEnabled: true,
  agentAttentionEnabled: true,
};

export function readNotificationPreferences(): NotificationPreferences {
  const stored =
    storageService.get<Partial<NotificationPreferences>>(STORAGE_KEYS.NOTIFICATION_PREFERENCES, {}) ??
    {};
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...stored,
    dueDateLeadMinutes: clampLeadMinutes(
      stored.dueDateLeadMinutes ?? DEFAULT_NOTIFICATION_PREFERENCES.dueDateLeadMinutes,
    ),
  };
}

export function writeNotificationPreferences(prefs: NotificationPreferences): void {
  persistStorageQuiet(STORAGE_KEYS.NOTIFICATION_PREFERENCES, {
    ...prefs,
    dueDateLeadMinutes: clampLeadMinutes(prefs.dueDateLeadMinutes),
  });
}

function clampLeadMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NOTIFICATION_PREFERENCES.dueDateLeadMinutes;
  return Math.min(24 * 60, Math.max(0, Math.round(value)));
}

/** Parse `HH:mm` into minutes since midnight; invalid → null. */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * True when `date` falls inside the quiet-hours window. Supports windows that
 * cross midnight (e.g. 22:00 → 08:00).
 */
export function isWithinQuietHours(
  date: Date,
  prefs: Pick<NotificationPreferences, "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd">,
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const start = parseTimeToMinutes(prefs.quietHoursStart);
  const end = parseTimeToMinutes(prefs.quietHoursEnd);
  if (start === null || end === null) return false;

  const nowMins = date.getHours() * 60 + date.getMinutes();
  if (start === end) return true;
  if (start < end) return nowMins >= start && nowMins < end;
  return nowMins >= start || nowMins < end;
}
