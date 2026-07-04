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
  await enableEncryptionAtRest();
  await indexedDBService.initialize();
  await indexedDBService.migrateToEncryptedStorage();
}

/** Disable encryption and return native storage to plaintext JSON. */
export async function deactivateEncryptionAtRest(): Promise<void> {
  await disableEncryptionAtRest();
}

export async function needsWebEncryptionUnlock(): Promise<boolean> {
  if (isTauri()) return false;
  if (!isWebEncryptionConfigured()) return false;
  return !isEncryptionUnlocked();
}

export async function needsDesktopEncryptionUnlock(): Promise<boolean> {
  if (!isTauri()) return false;
  const status = await getEncryptionStatus();
  return status.enabled && !status.unlocked;
}

export { getEncryptionStatus, isEncryptionActive, isEncryptionUnlocked };
