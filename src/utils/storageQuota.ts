/**
 * Storage quota management utilities
 * Handles localStorage quota exceeded errors and provides fallback strategies
 */

const STORAGE_QUOTA_KEY = 'liquitask-storage-quota-warning';

export interface StorageQuotaInfo {
  used: number;
  available: number;
  total: number;
  percentage: number;
}

/**
 * Get storage quota information (approximate)
 * Note: localStorage doesn't provide exact quota info, so we estimate
 */
export function getStorageQuotaInfo(): StorageQuotaInfo | null {
  try {
    // Estimate based on localStorage usage
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        totalSize += key.length + value.length;
      }
    }

    // Typical localStorage quota is 5-10MB, we'll use 5MB as conservative estimate
    const estimatedQuota = 5 * 1024 * 1024; // 5MB in bytes
    const used = totalSize * 2; // Each character is ~2 bytes in UTF-16
    const available = Math.max(0, estimatedQuota - used);
    const percentage = (used / estimatedQuota) * 100;

    return {
      used,
      available,
      total: estimatedQuota,
      percentage: Math.min(100, percentage),
    };
  } catch (error) {
    console.error('Failed to get storage quota info:', error);
    return null;
  }
}

/**
 * Check if storage is getting full (warns at 80%)
 */
export function isStorageNearQuota(threshold = 80): boolean {
  const info = getStorageQuotaInfo();
  if (!info) return false;
  return info.percentage >= threshold;
}

/**
 * Try to save data with quota checking
 * Returns true if successful, false if quota exceeded
 */
export function trySaveToStorage(key: string, value: string): { success: boolean; error?: string } {
  try {
    // Check if we're near quota before saving
    if (isStorageNearQuota(90)) {
      const lastWarning = localStorage.getItem(STORAGE_QUOTA_KEY);
      const now = Date.now();
      
      // Only warn once per hour
      if (!lastWarning || now - parseInt(lastWarning) > 3600000) {
        localStorage.setItem(STORAGE_QUOTA_KEY, now.toString());
        return {
          success: false,
          error: 'Storage is nearly full (90%+). Please export and clear old data.',
        };
      }
    }

    localStorage.setItem(key, value);
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return {
        success: false,
        error: 'Storage quota exceeded. Please export your data and clear storage.',
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown storage error',
    };
  }
}

/**
 * Clear old data to free up space
 * Removes data older than specified days
 */
export function clearOldData(olderThanDays = 30): number {
  let cleared = 0;
  const cutoffDate = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  try {
    // This is a placeholder - in a real app, you'd identify old data
    // For now, we'll just clear non-essential keys
    const keysToCheck = ['liquitask-temp-', 'liquitask-cache-'];
    
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && keysToCheck.some(prefix => key.startsWith(prefix))) {
        localStorage.removeItem(key);
        cleared++;
      }
    }
  } catch (error) {
    console.error('Failed to clear old data:', error);
  }

  return cleared;
}

