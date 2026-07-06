import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../indexedDBService", () => ({
  indexedDBService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    migrateToEncryptedStorage: vi.fn().mockResolvedValue(undefined),
    migrateToDecryptedStorage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../storageService", () => ({
  default: {
    hydrateEncryptedLocalStorage: vi.fn().mockResolvedValue(undefined),
    decryptLocalStorageToPlaintext: vi.fn().mockResolvedValue(undefined),
    reinitialize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../encryptionService", () => ({
  enableEncryptionAtRest: vi.fn().mockResolvedValue(undefined),
  disableEncryptionAtRest: vi.fn().mockResolvedValue(undefined),
  getEncryptionStatus: vi.fn(),
  initEncryptionService: vi.fn().mockResolvedValue(undefined),
  isEncryptionActive: vi.fn(),
  isEncryptionUnlocked: vi.fn(),
  unlockDesktopEncryption: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../webEncryptionService", () => ({
  isWebEncryptionConfigured: vi.fn(),
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: vi.fn(),
}));

const { indexedDBService } = await import("../indexedDBService");
const storageService = (await import("../storageService")).default;
const {
  activateEncryptionAtRest,
  deactivateEncryptionAtRest,
  isEncryptedStorageAccessible,
  needsDesktopEncryptionUnlock,
} = await import("../encryptionSetup");
const {
  disableEncryptionAtRest,
  enableEncryptionAtRest,
  getEncryptionStatus,
  isEncryptionActive,
} = await import("../encryptionService");
const { isWebEncryptionConfigured } = await import("../webEncryptionService");
const { isTauri } = await import("../../runtime/runtimeEnvironment");

describe("encryptionSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables desktop encryption and migrates IndexedDB", async () => {
    vi.mocked(isTauri).mockReturnValue(true);

    await activateEncryptionAtRest();

    expect(enableEncryptionAtRest).toHaveBeenCalledTimes(1);
    expect(indexedDBService.initialize).toHaveBeenCalledTimes(1);
    expect(indexedDBService.migrateToEncryptedStorage).toHaveBeenCalledTimes(1);
  });

  it("decrypts browser localStorage before disabling encryption", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isEncryptionActive).mockReturnValue(true);

    await deactivateEncryptionAtRest();

    expect(storageService.decryptLocalStorageToPlaintext).toHaveBeenCalledTimes(1);
    expect(storageService.reinitialize).toHaveBeenCalledTimes(1);
  });

  it("rolls back desktop encryption when IndexedDB migration fails", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(indexedDBService.migrateToEncryptedStorage).mockRejectedValueOnce(
      new Error("migrate failed"),
    );

    await expect(activateEncryptionAtRest()).rejects.toThrow("migrate failed");
    expect(disableEncryptionAtRest).toHaveBeenCalledTimes(1);
  });

  it("reports when encrypted storage is accessible", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getEncryptionStatus).mockResolvedValue({
      enabled: true,
      unlocked: false,
      keychainAvailable: true,
      biometricAvailable: true,
    });

    await expect(isEncryptedStorageAccessible()).resolves.toBe(false);
  });

  it("decrypts IndexedDB before disabling encryption", async () => {
    vi.mocked(isTauri).mockReturnValue(true);

    await deactivateEncryptionAtRest();

    const migrateOrder = vi.mocked(indexedDBService.migrateToDecryptedStorage).mock.invocationCallOrder[0];
    const disableOrder = vi.mocked(disableEncryptionAtRest).mock.invocationCallOrder[0];
    expect(migrateOrder).toBeLessThan(disableOrder);
    expect(disableEncryptionAtRest).toHaveBeenCalledTimes(1);
    expect(storageService.reinitialize).toHaveBeenCalledTimes(1);
  });

  it("requires an active web key before migrating browser storage", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isEncryptionActive).mockReturnValue(false);

    await expect(activateEncryptionAtRest()).rejects.toThrow(
      "Set a passphrase before enabling browser encryption.",
    );
  });

  it("hydrates browser storage when web encryption is already active", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isEncryptionActive).mockReturnValue(true);

    await activateEncryptionAtRest();

    expect(enableEncryptionAtRest).not.toHaveBeenCalled();
    expect(storageService.hydrateEncryptedLocalStorage).toHaveBeenCalledTimes(1);
    expect(indexedDBService.migrateToEncryptedStorage).toHaveBeenCalledTimes(1);
  });

  it("does not block desktop startup when encryption status fails", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getEncryptionStatus).mockRejectedValue(new Error("IPC unavailable"));

    await expect(needsDesktopEncryptionUnlock()).resolves.toBe(false);
  });

  it("returns false when web encryption is not configured", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(isWebEncryptionConfigured).mockReturnValue(false);

    const { needsWebEncryptionUnlock } = await import("../encryptionSetup");
    await expect(needsWebEncryptionUnlock()).resolves.toBe(false);
  });
});
