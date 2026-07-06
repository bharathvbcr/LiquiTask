import { invoke } from "@tauri-apps/api/core";
import { STORAGE_KEYS } from "../constants";
import { isTauri } from "../runtime/runtimeEnvironment";
import {
  isWebEncryptionConfigured,
  isWebEncryptionUnlocked,
  lockWebEncryption,
  setupWebEncryption,
  unlockWebEncryption,
  webDecryptPayload,
  webEncryptPayload,
  webOpaqueStorageKey,
} from "./webEncryptionService";

export const ENCRYPTED_ENVELOPE_PREFIX = "LTENC1:";

export interface EncryptionStatus {
  enabled: boolean;
  keychainAvailable: boolean;
  biometricAvailable: boolean;
  unlocked: boolean;
  mode: "desktop" | "web" | "none";
}

let encryptionActive = false;

export function isEncryptionActive(): boolean {
  return encryptionActive;
}

export function isEncryptionAvailable(): boolean {
  return true;
}

export function isEncryptionUnlocked(): boolean {
  if (isTauri()) {
    return encryptionActive;
  }
  return isWebEncryptionUnlocked();
}

export async function getEncryptionStatus(): Promise<EncryptionStatus> {
  if (isTauri()) {
    try {
      const status = await invoke<{
        enabled: boolean;
        keychainAvailable: boolean;
        biometricAvailable: boolean;
        unlocked: boolean;
      }>("encryption_status_cmd");
      encryptionActive = status.enabled && status.unlocked;
      return {
        ...status,
        mode: "desktop",
      };
    } catch (error) {
      console.error("[Encryption] Failed to read desktop encryption status:", error);
      return {
        enabled: false,
        keychainAvailable: false,
        biometricAvailable: false,
        unlocked: false,
        mode: "desktop",
      };
    }
  }

  const configured = isWebEncryptionConfigured();
  return {
    enabled: configured,
    keychainAvailable: false,
    biometricAvailable: false,
    unlocked: isWebEncryptionUnlocked(),
    mode: configured ? "web" : "none",
  };
}

export async function initEncryptionService(): Promise<void> {
  if (isTauri()) {
    const status = await getEncryptionStatus();
    encryptionActive = status.enabled && status.unlocked;
    return;
  }

  encryptionActive = isWebEncryptionConfigured() && isWebEncryptionUnlocked();
}

export async function unlockDesktopEncryption(): Promise<void> {
  if (!isTauri()) {
    throw new Error("Desktop unlock is only available in the native app.");
  }
  await invoke("encryption_unlock");
  encryptionActive = true;
}

export async function lockDesktopEncryption(): Promise<void> {
  if (!isTauri()) return;
  await invoke("encryption_lock");
  encryptionActive = false;
}

export async function enableEncryptionAtRest(): Promise<void> {
  if (isTauri()) {
    await invoke("encryption_enable");
    encryptionActive = true;
    localStorage.setItem(STORAGE_KEYS.ENCRYPTION_AT_REST, "true");
    return;
  }

  throw new Error("Use setupWebEncryption(passphrase) for the browser build.");
}

export async function disableEncryptionAtRest(): Promise<void> {
  if (isTauri()) {
    await invoke("encryption_disable");
    encryptionActive = false;
    localStorage.removeItem(STORAGE_KEYS.ENCRYPTION_AT_REST);
    return;
  }

  localStorage.removeItem(STORAGE_KEYS.WEB_ENCRYPTION_SALT);
  localStorage.removeItem(STORAGE_KEYS.WEB_ENCRYPTION_VERIFIER);
  localStorage.removeItem(STORAGE_KEYS.ENCRYPTION_AT_REST);
  lockWebEncryption();
  encryptionActive = false;
}

export function isEncryptedEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_ENVELOPE_PREFIX);
}

export async function encryptPayload(value: unknown): Promise<string> {
  if (!encryptionActive) {
    throw new Error("Encryption is not initialized");
  }

  if (isTauri()) {
    return invoke<string>("encryption_encrypt_blob", {
      plaintext: JSON.stringify(value),
    });
  }

  return webEncryptPayload(value);
}

export async function decryptPayload<T = unknown>(envelope: string): Promise<T> {
  if (!encryptionActive) {
    throw new Error("Encryption is not initialized");
  }

  if (!isEncryptedEnvelope(envelope)) {
    throw new Error("Value is not an encrypted envelope");
  }

  if (isTauri()) {
    const plaintext = await invoke<string>("encryption_decrypt_blob", { envelope });
    return JSON.parse(plaintext) as T;
  }

  return webDecryptPayload<T>(envelope);
}

export async function deriveOpaqueStorageKey(
  storeName: string,
  logicalId: string,
): Promise<string> {
  if (!encryptionActive) {
    return logicalId;
  }

  if (isTauri()) {
    return invoke<string>("encryption_opaque_storage_key", { storeName, logicalId });
  }

  return webOpaqueStorageKey(storeName, logicalId);
}

export async function unlockEncryptionWithPassphrase(passphrase: string): Promise<boolean> {
  const unlocked = await unlockWebEncryption(passphrase);
  encryptionActive = unlocked;
  return unlocked;
}

export async function setupWebEncryptionAtRest(passphrase: string): Promise<void> {
  await setupWebEncryption(passphrase);
  encryptionActive = true;
}

export async function lockEncryption(): Promise<void> {
  if (isTauri()) {
    await lockDesktopEncryption();
    return;
  }
  lockWebEncryption();
  encryptionActive = false;
}

export async function maybeDecryptStoredValue<T>(value: T): Promise<T> {
  if (!encryptionActive || !isEncryptedEnvelope(value)) {
    return value;
  }
  return decryptPayload<T>(value);
}

export function resetEncryptionServiceForTests(): void {
  encryptionActive = false;
}
