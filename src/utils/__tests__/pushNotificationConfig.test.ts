import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_PUSH_CONFIG,
  toDaemonPushConfig,
} from "../pushNotificationConfig";

describe("pushNotificationConfig", () => {
  it("builds Pushover daemon payload when credentials are present", () => {
    const payload = toDaemonPushConfig({
      ...DEFAULT_REMOTE_PUSH_CONFIG,
      enabled: true,
      provider: "pushover",
      pushoverUserKey: " user ",
      pushoverApiToken: " token ",
    });
    expect(payload).toEqual({
      enabled: true,
      provider: "pushover",
      pushoverUserKey: "user",
      pushoverApiToken: "token",
    });
  });

  it("returns null when pushover credentials are missing", () => {
    const payload = toDaemonPushConfig({
      ...DEFAULT_REMOTE_PUSH_CONFIG,
      enabled: true,
      provider: "pushover",
    });
    expect(payload).toBeNull();
  });

  it("builds webhook daemon payload", () => {
    const payload = toDaemonPushConfig({
      ...DEFAULT_REMOTE_PUSH_CONFIG,
      enabled: true,
      provider: "webhook",
      webhookUrl: "https://example.com/hook",
    });
    expect(payload).toEqual({
      enabled: true,
      provider: "webhook",
      webhookUrl: "https://example.com/hook",
    });
  });
});
