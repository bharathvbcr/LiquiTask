import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENCRYPTED_ENVELOPE_PREFIX,
  getEncryptionStatus,
  isEncryptedEnvelope,
  resetEncryptionServiceForTests,
} from "../encryptionService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: vi.fn().mockReturnValue(true),
}));

const { invoke } = await import("@tauri-apps/api/core");

describe("encryptionService", () => {
  beforeEach(() => {
    resetEncryptionServiceForTests();
    vi.clearAllMocks();
  });

  it("reports encryption status from the desktop backend", async () => {
    vi.mocked(invoke).mockResolvedValue({
      enabled: true,
      keychainAvailable: true,
      biometricAvailable: true,
      unlocked: true,
    });
    const status = await getEncryptionStatus();
    expect(status.enabled).toBe(true);
    expect(status.keychainAvailable).toBe(true);
    expect(status.biometricAvailable).toBe(true);
    expect(status.unlocked).toBe(true);
    expect(status.mode).toBe("desktop");
    expect(invoke).toHaveBeenCalledWith("encryption_status_cmd");
  });

  it("detects encrypted envelopes", () => {
    expect(isEncryptedEnvelope(`${ENCRYPTED_ENVELOPE_PREFIX}abc`)).toBe(true);
    expect(isEncryptedEnvelope("plain")).toBe(false);
  });
});
