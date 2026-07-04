import storageService from "../services/storageService";

/** Persist a value and surface failures to the caller. */
export async function persistStorage<T>(key: string, value: T): Promise<void> {
  await storageService.set(key, value);
}

/** Fire-and-forget persist with optional user-facing error callback. */
export function persistStorageQuiet<T>(
  key: string,
  value: T,
  onError?: (message: string) => void,
): void {
  void Promise.resolve(storageService.set(key, value)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to persist "${key}":`, err);
    onError?.(message);
  });
}
