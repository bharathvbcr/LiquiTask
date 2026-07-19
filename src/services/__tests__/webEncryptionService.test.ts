import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../../constants";
import {
  isWebEncryptionConfigured,
  isWebEncryptionUnlocked,
  lockWebEncryption,
  resetWebEncryptionForTests,
  setupWebEncryption,
  unlockWebEncryption,
  webDecryptPayload,
  webEncryptPayload,
  webOpaqueStorageKey,
} from "../webEncryptionService";

describe("webEncryptionService", () => {
  beforeEach(() => {
    localStorage.clear();
    resetWebEncryptionForTests();
  });

  describe("setupWebEncryption", () => {
    it("should throw an error if passphrase is too short", async () => {
      await expect(setupWebEncryption("short")).rejects.toThrow(
        "Passphrase must be at least 8 characters",
      );
      expect(isWebEncryptionConfigured()).toBe(false);
      expect(isWebEncryptionUnlocked()).toBe(false);
    });

    it("should configure and unlock encryption on success", async () => {
      await setupWebEncryption("super-secret-password");
      expect(isWebEncryptionConfigured()).toBe(true);
      expect(isWebEncryptionUnlocked()).toBe(true);

      expect(localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT)).not.toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER)).not.toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.ENCRYPTION_AT_REST)).toBe("true");
    });
  });

  describe("unlockWebEncryption", () => {
    it("should return false if salt or verifier is missing", async () => {
      const result = await unlockWebEncryption("some-password");
      expect(result).toBe(false);
      expect(isWebEncryptionUnlocked()).toBe(false);
    });

    it("should unlock successfully with the correct password", async () => {
      const password = "correct-password-123";
      await setupWebEncryption(password);
      lockWebEncryption();
      expect(isWebEncryptionUnlocked()).toBe(false);

      const unlocked = await unlockWebEncryption(password);
      expect(unlocked).toBe(true);
      expect(isWebEncryptionUnlocked()).toBe(true);
    });

    it("should return false and lock if password is incorrect", async () => {
      await setupWebEncryption("correct-password-123");
      lockWebEncryption();

      const unlocked = await unlockWebEncryption("wrong-password");
      expect(unlocked).toBe(false);
      expect(isWebEncryptionUnlocked()).toBe(false);
    });

    it("should lock if verifier decryption fails with modified salt/verifier", async () => {
      await setupWebEncryption("correct-password-123");
      // Corrupt the verifier in local storage
      localStorage.setItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER, "LTENC1:corruptedbase64");
      lockWebEncryption();

      const unlocked = await unlockWebEncryption("correct-password-123");
      expect(unlocked).toBe(false);
      expect(isWebEncryptionUnlocked()).toBe(false);
    });
  });

  describe("encrypt and decrypt", () => {
    it("should throw error if attempting to encrypt when locked", async () => {
      await expect(webEncryptPayload("hello")).rejects.toThrow("Web encryption is locked");
    });

    it("should throw error if attempting to decrypt when locked", async () => {
      await expect(webDecryptPayload("LTENC1:abc")).rejects.toThrow("Web encryption is locked");
    });

    it("should throw error if decrypting non-envelope value", async () => {
      await setupWebEncryption("password-123");
      await expect(webDecryptPayload("plain-text")).rejects.toThrow(
        "Value is not an encrypted envelope",
      );
    });

    it("should encrypt and decrypt payloads successfully", async () => {
      await setupWebEncryption("password-123");
      const payload = { foo: "bar", baz: [1, 2, 3] };

      const envelope = await webEncryptPayload(payload);
      expect(envelope.startsWith("LTENC1:")).toBe(true);

      const decrypted = await webDecryptPayload<typeof payload>(envelope);
      expect(decrypted).toEqual(payload);
    });
  });

  describe("webOpaqueStorageKey", () => {
    it("should throw error if locked", async () => {
      await expect(webOpaqueStorageKey("tasks", "task-1")).rejects.toThrow(
        "Web encryption is locked",
      );
    });

    it("should derive deterministic storage keys", async () => {
      await setupWebEncryption("password-123");

      const key1 = await webOpaqueStorageKey("tasks", "task-1");
      const key2 = await webOpaqueStorageKey("tasks", "task-1");
      const key3 = await webOpaqueStorageKey("tasks", "task-2");

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).not.toBe("task-1");
    });
  });
});
