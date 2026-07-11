import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isWithinQuietHours,
  parseTimeToMinutes,
  readNotificationPreferences,
} from "../notificationPreferences";

describe("notificationPreferences", () => {
  it("parseTimeToMinutes accepts HH:mm", () => {
    expect(parseTimeToMinutes("22:00")).toBe(22 * 60);
    expect(parseTimeToMinutes("08:30")).toBe(8 * 60 + 30);
    expect(parseTimeToMinutes("invalid")).toBeNull();
  });

  it("isWithinQuietHours handles same-day window", () => {
    const noon = new Date(2026, 6, 8, 12, 0);
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHoursEnabled: true,
      quietHoursStart: "09:00",
      quietHoursEnd: "17:00",
    };
    expect(isWithinQuietHours(noon, prefs)).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 6, 8, 8, 0), prefs)).toBe(false);
  });

  it("isWithinQuietHours handles overnight window", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    };
    expect(isWithinQuietHours(new Date(2026, 6, 8, 23, 0), prefs)).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 6, 8, 7, 0), prefs)).toBe(true);
    expect(isWithinQuietHours(new Date(2026, 6, 8, 12, 0), prefs)).toBe(false);
  });

  it("readNotificationPreferences merges defaults", () => {
    const prefs = readNotificationPreferences();
    expect(prefs.dueDateLeadMinutes).toBe(60);
    expect(prefs.overdueNudgesEnabled).toBe(true);
  });
});
