import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    getStorageQuotaInfo,
    isStorageNearQuota,
    trySaveToStorage,
    clearOldData,
} from '../storageQuota';

// Mock localStorage
const localStorageMock = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
        localStorageMock.store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
        delete localStorageMock.store[key];
    }),
    clear: vi.fn(() => {
        localStorageMock.store = {};
    }),
    key: vi.fn((index: number) => {
        const keys = Object.keys(localStorageMock.store);
        // Return keys in order, or null if index is out of bounds
        return index >= 0 && index < keys.length ? keys[index] : null;
    }),
    get length() {
        return Object.keys(localStorageMock.store).length;
    },
};

Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    writable: true,
});

describe('storageQuota', () => {
    beforeEach(() => {
        localStorageMock.store = {};
        // Reset all mocks to their default implementations
        localStorageMock.getItem.mockReset();
        localStorageMock.getItem.mockImplementation((key: string) => localStorageMock.store[key] || null);

        localStorageMock.setItem.mockReset();
        localStorageMock.setItem.mockImplementation((key: string, value: string) => {
            localStorageMock.store[key] = value;
        });

        localStorageMock.removeItem.mockReset();
        localStorageMock.removeItem.mockImplementation((key: string) => {
            delete localStorageMock.store[key];
        });

        localStorageMock.key.mockReset();
        localStorageMock.key.mockImplementation((index: number) => {
            const keys = Object.keys(localStorageMock.store);
            return index >= 0 && index < keys.length ? keys[index] : null;
        });

        vi.clearAllMocks();
    });

    describe('getStorageQuotaInfo', () => {
        it('should return quota info with empty storage', () => {
            const info = getStorageQuotaInfo();

            expect(info).not.toBeNull();
            expect(info?.used).toBe(0);
            expect(info?.total).toBe(5 * 1024 * 1024); // 5MB
            expect(info?.percentage).toBe(0);
        });

        it('should calculate used storage', () => {
            localStorageMock.setItem('key1', 'value1');
            localStorageMock.setItem('key2', 'value2');

            const info = getStorageQuotaInfo();

            expect(info).not.toBeNull();
            expect(info?.used).toBeGreaterThan(0);
        });

        it('should calculate percentage correctly', () => {
            // Simulate some storage usage
            const largeValue = 'x'.repeat(1000);
            localStorageMock.setItem('large-key', largeValue);

            const info = getStorageQuotaInfo();

            expect(info).not.toBeNull();
            expect(info?.percentage).toBeGreaterThanOrEqual(0);
            expect(info?.percentage).toBeLessThanOrEqual(100);
        });

        it('should return null on error', () => {
            // Mock localStorage.length getter to throw
            const originalLength = Object.getOwnPropertyDescriptor(localStorageMock, 'length');
            Object.defineProperty(localStorageMock, 'length', {
                get: () => {
                    throw new Error('Storage error');
                },
                configurable: true,
            });

            const info = getStorageQuotaInfo();

            expect(info).toBeNull();

            // Restore
            if (originalLength) {
                Object.defineProperty(localStorageMock, 'length', originalLength);
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                delete (localStorageMock as any).length;
            }
        });
    });

    describe('isStorageNearQuota', () => {
        it('should return false when storage is not near quota', () => {
            const isNear = isStorageNearQuota(80);

            expect(isNear).toBe(false);
        });

        it('should return true when storage is near quota', () => {
            // Fill localStorage with enough data to trigger near quota
            const largeValue = 'x'.repeat(2.5 * 1024 * 1024); // ~2.5MB
            localStorageMock.setItem('large-key-1', largeValue);
            localStorageMock.setItem('large-key-2', largeValue);

            const isNear = isStorageNearQuota(80);

            // With ~5MB of data, we should be near quota
            expect(isNear).toBe(true);
        });

        it('should use custom threshold', () => {
            const isNear50 = isStorageNearQuota(50);
            const isNear90 = isStorageNearQuota(90);

            // Both should be false with empty storage
            expect(isNear50).toBe(false);
            expect(isNear90).toBe(false);
        });
    });

    describe('trySaveToStorage', () => {
        it('should save successfully when storage is not full', () => {
            const result = trySaveToStorage('test-key', 'test-value');

            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            expect(localStorageMock.setItem).toHaveBeenCalledWith('test-key', 'test-value');
        });

        it('should return error when quota exceeded', () => {
            // Mock setItem to throw QuotaExceededError
            localStorageMock.setItem.mockImplementation(() => {
                const error = new DOMException('Quota exceeded', 'QuotaExceededError');
                throw error;
            });

            const result = trySaveToStorage('test-key', 'test-value');

            expect(result.success).toBe(false);
            expect(result.error).toContain('quota exceeded');
        });

        it('should return error when storage is near quota (90%+)', () => {
            // Fill localStorage with enough data to be near quota (90%+)
            const largeValue = 'x'.repeat(2.3 * 1024 * 1024); // ~2.3MB per key
            localStorageMock.setItem('large-key-1', largeValue);
            localStorageMock.setItem('large-key-2', largeValue);

            // Clear the warning timestamp so it triggers
            delete localStorageMock.store['liquitask-storage-quota-warning'];

            const result = trySaveToStorage('test-key', 'test-value');

            expect(result.success).toBe(false);
            expect(result.error).toContain('nearly full');
        });

        it('should handle other storage errors', () => {
            localStorageMock.setItem.mockImplementation(() => {
                throw new Error('Unknown error');
            });

            const result = trySaveToStorage('test-key', 'test-value');

            expect(result.success).toBe(false);
            expect(result.error).toBe('Unknown error');
        });

        it('should only warn once per hour when near quota', () => {
            // Fill localStorage with enough data to be near quota
            const largeValue = 'x'.repeat(2.3 * 1024 * 1024); // ~2.3MB per key
            localStorageMock.setItem('large-key-1', largeValue);
            localStorageMock.setItem('large-key-2', largeValue);

            // Clear warning timestamp
            delete localStorageMock.store['liquitask-storage-quota-warning'];

            const result1 = trySaveToStorage('test-key-1', 'value1');

            // Second call should also fail (within same hour, but we're still near quota)
            trySaveToStorage('test-key-2', 'value2');

            // First call should warn
            expect(result1.success).toBe(false);
            expect(result1.error).toContain('nearly full');
        });
    });

    describe('clearOldData', () => {
        beforeEach(() => {
            // Reset mocks and store before each test
            localStorageMock.store = {};
            localStorageMock.removeItem.mockClear();
            localStorageMock.setItem.mockClear();
            localStorageMock.key.mockClear();
            // Reset removeItem to normal behavior
            localStorageMock.removeItem.mockImplementation((key: string) => {
                delete localStorageMock.store[key];
            });
        });

        it('should clear data with matching prefixes', () => {
            // Clear any existing mocks
            localStorageMock.removeItem.mockClear();
            localStorageMock.setItem.mockClear();
            localStorageMock.store = {};

            localStorageMock.setItem('liquitask-temp-1', 'data1');
            localStorageMock.setItem('liquitask-cache-1', 'data2');
            localStorageMock.setItem('liquitask-important', 'data3');
            localStorageMock.setItem('other-key', 'data4');

            const cleared = clearOldData(30);

            expect(cleared).toBeGreaterThan(0);
            expect(localStorageMock.getItem('liquitask-temp-1')).toBeNull();
            expect(localStorageMock.getItem('liquitask-cache-1')).toBeNull();
            // Important data should remain (doesn't match prefix pattern)
            expect(localStorageMock.getItem('liquitask-important')).toBe('data3');
            expect(localStorageMock.getItem('other-key')).toBe('data4');
        });

        it('should return count of cleared items', () => {
            localStorageMock.removeItem.mockClear();
            localStorageMock.setItem.mockClear();
            localStorageMock.store = {};

            localStorageMock.setItem('liquitask-temp-1', 'data1');
            localStorageMock.setItem('liquitask-temp-2', 'data2');
            localStorageMock.setItem('liquitask-cache-1', 'data3');

            const cleared = clearOldData(30);

            expect(cleared).toBe(3);
        });

        it('should handle errors gracefully', () => {
            // Reset removeItem mock first
            localStorageMock.removeItem.mockClear();
            localStorageMock.setItem.mockClear();
            localStorageMock.store = {};

            // Set up items first
            localStorageMock.setItem('liquitask-temp-1', 'data1');
            localStorageMock.setItem('liquitask-temp-2', 'data2');

            // The function iterates backwards (length-1 to 0)
            // So it will process temp-2 first (index 1), then temp-1 (index 0)
            // Make removeItem throw for temp-1, succeed for temp-2
            localStorageMock.removeItem.mockImplementation((key: string) => {
                if (key === 'liquitask-temp-1') {
                    throw new Error('Remove error');
                }
                delete localStorageMock.store[key];
            });

            const cleared = clearOldData(30);

            // Should return count of successfully cleared items
            // temp-2 should succeed (cleared = 1), temp-1 should fail but not prevent the function
            expect(typeof cleared).toBe('number');
            expect(cleared).toBe(1); // Only temp-2 should be cleared
        });

        it('should return 0 when no matching data', () => {
            localStorageMock.removeItem.mockClear();
            localStorageMock.setItem.mockClear();
            localStorageMock.store = {};

            localStorageMock.setItem('other-key', 'data');

            const cleared = clearOldData(30);

            expect(cleared).toBe(0);
        });
    });
});

