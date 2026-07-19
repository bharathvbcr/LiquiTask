import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../constants";
import { isTauri } from "../../runtime/runtimeEnvironment";
import { invoke } from "@tauri-apps/api/core";
import {
  ENCRYPTED_ENVELOPE_PREFIX,
  getEncryptionStatus,
  isEncryptedEnvelope,
  resetEncryptionServiceForTests,
  isEncryptionActive,
  isEncryptionAvailable,
  isEncryptionUnlocked,
  initEncryptionService,
  unlockDesktopEncryption,
  lockDesktopEncryption,
  enableEncryptionAtRest,
  disableEncryptionAtRest,
  encryptPayload,
  decryptPayload,
  deriveOpaqueStorageKey,
  unlockEncryptionWithPassphrase,
  setupWebEncryptionAtRest,
  lockEncryption,
  maybeDecryptStoredValue,
} from "../encryptionService";

import * as webEnc from "../webEncryptionService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: vi.fn().mockReturnValue(true),
}));

vi.mock("../webEncryptionService", () => ({
  isWebEncryptionConfigured: vi.fn(),
  isWebEncryptionUnlocked: vi.fn(),
  lockWebEncryption: vi.fn(),
  setupWebEncryption: vi.fn(),
  unlockWebEncryption: vi.fn(),
  webDecryptPayload: vi.fn(),
  webEncryptPayload: vi.fn(),
  webOpaqueStorageKey: vi.fn(),
}));

describe("encryptionService", () => {
  beforeEach(() => {
    resetEncryptionServiceForTests();
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(isTauri).mockReturnValue(true);
  });

  describe("basic status and checks", () => {
    it("reports active status", () => {
      expect(isEncryptionActive()).toBe(false);
    });

    it("reports encryption availability", () => {
      expect(isEncryptionAvailable()).toBe(true);
    });

    it("checks unlocked status in Tauri", () => {
      vi.mocked(isTauri).mockReturnValue(true);
      expect(isEncryptionUnlocked()).toBe(false);
    });

    it("checks unlocked status in Web fallback", () => {
      vi.mocked(isTauri).mockReturnValue(false);
      vi.mocked(webEnc.isWebEncryptionUnlocked).mockReturnValue(true);
      expect(isEncryptionUnlocked()).toBe(true);
      expect(webEnc.isWebEncryptionUnlocked).toHaveBeenCalled();
    });

    it("detects encrypted envelopes", () => {
      expect(isEncryptedEnvelope(`${ENCRYPTED_ENVELOPE_PREFIX}abc`)).toBe(true);
      expect(isEncryptedEnvelope("plain")).toBe(false);
    });
  });

  describe("getEncryptionStatus", () => {
    it("reports encryption status from the desktop backend in Tauri", async () => {
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

    it("handles getEncryptionStatus failure in Tauri gracefully", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("IPC failure"));
      const status = await getEncryptionStatus();
      expect(status.enabled).toBe(false);
      expect(status.mode).toBe("desktop");
    });

    it("reports web status in non-Tauri mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      vi.mocked(webEnc.isWebEncryptionConfigured).mockReturnValue(true);
      vi.mocked(webEnc.isWebEncryptionUnlocked).mockReturnValue(true);

      const status = await getEncryptionStatus();
      expect(status.enabled).toBe(true);
      expect(status.unlocked).toBe(true);
      expect(status.mode).toBe("web");
    });
  });

  describe("initEncryptionService", () => {
    it("initializes active state in Tauri", async () => {
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();
      expect(isEncryptionActive()).toBe(true);
    });

    it("initializes active state in Web mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      vi.mocked(webEnc.isWebEncryptionConfigured).mockReturnValue(true);
      vi.mocked(webEnc.isWebEncryptionUnlocked).mockReturnValue(true);

      await initEncryptionService();
      expect(isEncryptionActive()).toBe(true);
    });
  });

  describe("unlock and lock desktop", () => {
    it("unlocks desktop in Tauri", async () => {
      await unlockDesktopEncryption();
      expect(invoke).toHaveBeenCalledWith("encryption_unlock");
      expect(isEncryptionActive()).toBe(true);
    });

    it("throws when unlocking desktop in web mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      await expect(unlockDesktopEncryption()).rejects.toThrow(
        "Desktop unlock is only available in the native app.",
      );
    });

    it("locks desktop in Tauri", async () => {
      // first set to active
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();

      await lockDesktopEncryption();
      expect(invoke).toHaveBeenCalledWith("encryption_lock");
      expect(isEncryptionActive()).toBe(false);
    });

    it("does nothing when locking desktop in web mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      await lockDesktopEncryption();
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe("enable and disable encryption at rest", () => {
    it("enables in Tauri", async () => {
      await enableEncryptionAtRest();
      expect(invoke).toHaveBeenCalledWith("encryption_enable");
      expect(localStorage.getItem(STORAGE_KEYS.ENCRYPTION_AT_REST)).toBe("true");
    });

    it("throws when enabling in Web mode directly", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      await expect(enableEncryptionAtRest()).rejects.toThrow(
        "Use setupWebEncryption(passphrase) for the browser build.",
      );
    });

    it("disables in Tauri", async () => {
      localStorage.setItem(STORAGE_KEYS.ENCRYPTION_AT_REST, "true");
      await disableEncryptionAtRest();
      expect(invoke).toHaveBeenCalledWith("encryption_disable");
      expect(localStorage.getItem(STORAGE_KEYS.ENCRYPTION_AT_REST)).toBeNull();
    });

    it("disables in Web mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      localStorage.setItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT, "salt");
      localStorage.setItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER, "verifier");
      localStorage.setItem(STORAGE_KEYS.ENCRYPTION_AT_REST, "true");

      await disableEncryptionAtRest();
      expect(localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.ENCRYPTION_AT_REST)).toBeNull();
      expect(webEnc.lockWebEncryption).toHaveBeenCalled();
    });
  });

  describe("payload encrypt / decrypt", () => {
    it("throws on encrypt when not active", async () => {
      await expect(encryptPayload("test")).rejects.toThrow("Encryption is not initialized");
    });

    it("throws on decrypt when not active", async () => {
      await expect(decryptPayload("test")).rejects.toThrow("Encryption is not initialized");
    });

    it("encrypts and decrypts in Tauri when active", async () => {
      // Init as active
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();

      vi.mocked(invoke).mockResolvedValueOnce(`${ENCRYPTED_ENVELOPE_PREFIX}encrypted`);
      const encrypted = await encryptPayload({ data: "secret" });
      expect(invoke).toHaveBeenCalledWith("encryption_encrypt_blob", {
        plaintext: '{"data":"secret"}',
      });
      expect(encrypted).toBe(`${ENCRYPTED_ENVELOPE_PREFIX}encrypted`);

      // Decrypt
      vi.mocked(invoke).mockResolvedValueOnce('{"data":"secret"}');
      const decrypted = await decryptPayload(`${ENCRYPTED_ENVELOPE_PREFIX}encrypted`);
      expect(invoke).toHaveBeenCalledWith("encryption_decrypt_blob", {
        envelope: `${ENCRYPTED_ENVELOPE_PREFIX}encrypted`,
      });
      expect(decrypted).toEqual({ data: "secret" });
    });

    it("throws error if decrypting non-envelope", async () => {
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();

      await expect(decryptPayload("plain")).rejects.toThrow("Value is not an encrypted envelope");
    });

    it("encrypts and decrypts in Web mode when active", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      vi.mocked(webEnc.isWebEncryptionConfigured).mockReturnValue(true);
      vi.mocked(webEnc.isWebEncryptionUnlocked).mockReturnValue(true);
      await initEncryptionService();

      vi.mocked(webEnc.webEncryptPayload).mockResolvedValue(`${ENCRYPTED_ENVELOPE_PREFIX}web`);
      const encrypted = await encryptPayload({ data: "web-secret" });
      expect(webEnc.webEncryptPayload).toHaveBeenCalledWith({ data: "web-secret" });
      expect(encrypted).toBe(`${ENCRYPTED_ENVELOPE_PREFIX}web`);

      // Decrypt
      vi.mocked(webEnc.webDecryptPayload).mockResolvedValue({ data: "web-secret" });
      const decrypted = await decryptPayload(`${ENCRYPTED_ENVELOPE_PREFIX}web`);
      expect(webEnc.webDecryptPayload).toHaveBeenCalledWith(`${ENCRYPTED_ENVELOPE_PREFIX}web`);
      expect(decrypted).toEqual({ data: "web-secret" });
    });
  });

  describe("deriveOpaqueStorageKey", () => {
    it("returns plain ID when not active", async () => {
      const key = await deriveOpaqueStorageKey("tasks", "task-1");
      expect(key).toBe("task-1");
    });

    it("calls Tauri backend when active in Tauri", async () => {
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();

      vi.mocked(invoke).mockResolvedValueOnce("opaque-tauri-key");
      const key = await deriveOpaqueStorageKey("tasks", "task-1");
      expect(invoke).toHaveBeenCalledWith("encryption_opaque_storage_key", {
        storeName: "tasks",
        logicalId: "task-1",
      });
      expect(key).toBe("opaque-tauri-key");
    });

    it("calls web helper when active in Web mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      vi.mocked(webEnc.isWebEncryptionConfigured).mockReturnValue(true);
      vi.mocked(webEnc.isWebEncryptionUnlocked).mockReturnValue(true);
      await initEncryptionService();

      vi.mocked(webEnc.webOpaqueStorageKey).mockResolvedValue("opaque-web-key");
      const key = await deriveOpaqueStorageKey("tasks", "task-1");
      expect(webEnc.webOpaqueStorageKey).toHaveBeenCalledWith("tasks", "task-1");
      expect(key).toBe("opaque-web-key");
    });
  });

  describe("passphrase and locks", () => {
    it("unlocks encryption with passphrase", async () => {
      vi.mocked(webEnc.unlockWebEncryption).mockResolvedValue(true);
      const res = await unlockEncryptionWithPassphrase("pass");
      expect(res).toBe(true);
      expect(isEncryptionActive()).toBe(true);
    });

    it("sets up web encryption at rest", async () => {
      await setupWebEncryptionAtRest("pass");
      expect(webEnc.setupWebEncryption).toHaveBeenCalledWith("pass");
      expect(isEncryptionActive()).toBe(true);
    });

    it("locks encryption in Tauri", async () => {
      await lockEncryption();
      expect(invoke).toHaveBeenCalledWith("encryption_lock");
      expect(isEncryptionActive()).toBe(false);
    });

    it("locks encryption in Web mode", async () => {
      vi.mocked(isTauri).mockReturnValue(false);
      await lockEncryption();
      expect(webEnc.lockWebEncryption).toHaveBeenCalled();
      expect(isEncryptionActive()).toBe(false);
    });
  });

  describe("maybeDecryptStoredValue", () => {
    it("returns plain value if encryption not active", async () => {
      const res = await maybeDecryptStoredValue("plain");
      expect(res).toBe("plain");
    });

    it("returns plain value if not an envelope", async () => {
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();

      const res = await maybeDecryptStoredValue("plain");
      expect(res).toBe("plain");
    });

    it("decrypts value if active and is envelope", async () => {
      vi.mocked(invoke).mockResolvedValue({
        enabled: true,
        keychainAvailable: true,
        biometricAvailable: true,
        unlocked: true,
      });
      await initEncryptionService();

      vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify("decrypted-val"));
      const res = await maybeDecryptStoredValue(`${ENCRYPTED_ENVELOPE_PREFIX}val`);
      expect(res).toBe("decrypted-val");
    });
  });
});
