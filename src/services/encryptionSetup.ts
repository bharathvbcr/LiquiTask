import { indexedDBService } from "./indexedDBService";
import storageService from "./storageService";
import {
  disableEncryptionAtRest,
  enableEncryptionAtRest,
  getEncryptionStatus,
  initEncryptionService,
  isEncryptionActive,
  isEncryptionUnlocked,
  unlockDesktopEncryption,
} from "./encryptionService";
import { isTauri } from "../runtime/runtimeEnvironment";
import { isWebEncryptionConfigured } from "./webEncryptionService";

export type EncryptionChangeReason = "locked" | "unlocked" | "enabled" | "disabled";

/** Initialize encryption when the user has opted in. Does not auto-enable. */
export async function bootstrapEncryptionAtRest(): Promise<boolean> {
  if (isTauri()) {
    await initEncryptionService();
    if (!isEncryptionActive()) return false;

    await indexedDBService.initialize();
    await indexedDBService.migrateToEncryptedStorage();
    return true;
  }

  if (!isWebEncryptionConfigured()) {
    return false;
  }

  await initEncryptionService();
  if (!isEncryptionUnlocked()) {
    return false;
  }

  await storageService.hydrateEncryptedLocalStorage();
  await indexedDBService.initialize();
  await indexedDBService.migrateToEncryptedStorage();
  return true;
}

/** Run after the user unlocks encryption (web or desktop). */
export async function completeEncryptionUnlock(): Promise<void> {
  if (isTauri()) {
    await unlockDesktopEncryption();
  }
  await initEncryptionService();
  if (!isTauri()) {
    await storageService.hydrateEncryptedLocalStorage();
  }
  await indexedDBService.initialize();
  await indexedDBService.migrateToEncryptedStorage();
}

/** Enable encryption for native storage + IndexedDB. */
export async function activateEncryptionAtRest(): Promise<void> {
  if (isTauri()) {
    await enableEncryptionAtRest();
    try {
      await indexedDBService.initialize();
      await indexedDBService.migrateToEncryptedStorage();
    } catch (error) {
      try {
        await disableEncryptionAtRest();
      } catch (rollbackError) {
        console.error("[Encryption] Failed to roll back after enable error:", rollbackError);
      }
      throw error;
    }
    return;
  }

  if (!isEncryptionActive()) {
    throw new Error("Set a passphrase before enabling browser encryption.");
  }

  await storageService.hydrateEncryptedLocalStorage();
  await indexedDBService.initialize();
  await indexedDBService.migrateToEncryptedStorage();
}

/** Disable encryption and return native storage to plaintext JSON. */
export async function deactivateEncryptionAtRest(): Promise<void> {
  await indexedDBService.initialize();

  if (!isTauri() && isEncryptionActive()) {
    await storageService.decryptLocalStorageToPlaintext();
  }

  await indexedDBService.migrateToDecryptedStorage();
  await disableEncryptionAtRest();
  await storageService.reinitialize();
}

export async function isEncryptedStorageAccessible(): Promise<boolean> {
  if (isTauri()) {
    const status = await getEncryptionStatus();
    return !status.enabled || status.unlocked;
  }
  if (!isWebEncryptionConfigured()) return true;
  return isEncryptionUnlocked();
}

export async function needsWebEncryptionUnlock(): Promise<boolean> {
  if (isTauri()) return false;
  if (!isWebEncryptionConfigured()) return false;
  return !isEncryptionUnlocked();
}

export async function needsDesktopEncryptionUnlock(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const status = await getEncryptionStatus();
    return status.enabled && !status.unlocked;
  } catch (error) {
    console.error("[Encryption] Failed to read desktop encryption status:", error);
    return false;
  }
}

export { getEncryptionStatus, isEncryptionActive, isEncryptionUnlocked };
