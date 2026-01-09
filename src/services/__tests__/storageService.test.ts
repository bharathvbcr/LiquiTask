import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const mockLocalStorage = {
    store: {} as Record<string, string>,
    getItem: vi.fn((key: string) => mockLocalStorage.store[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockLocalStorage.store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete mockLocalStorage.store[key]; }),
    clear: vi.fn(() => { mockLocalStorage.store = {}; })
};

Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

// Import after mocking
import { storageService } from '../storageService';
import { STORAGE_KEYS } from '../../constants';

describe('StorageService', () => {
    beforeEach(() => {
        mockLocalStorage.store = {};
        mockLocalStorage.getItem.mockClear();
        mockLocalStorage.setItem.mockClear();
        vi.clearAllMocks();
    });

    describe('get', () => {
        it('should return default value when key does not exist', () => {
            const result = storageService.get('nonexistent', 'default');
            expect(result).toBe('default');
        });

        it('should parse JSON from localStorage', () => {
            const testData = { name: 'Test Project', id: 'p1' };
            mockLocalStorage.store[STORAGE_KEYS.PROJECTS] = JSON.stringify([testData]);

            const result = storageService.get(STORAGE_KEYS.PROJECTS, []);
            expect(result).toEqual([testData]);
        });

        it('should return cached value on subsequent gets', () => {
            const testData = [{ name: 'Test' }];
            mockLocalStorage.store['test-key'] = JSON.stringify(testData);

            // First call
            storageService.get('test-key', []);
            // Second call should use cache
            storageService.get('test-key', []);

            // localStorage.getItem should only be called once due to caching
            expect(mockLocalStorage.getItem).toHaveBeenCalledTimes(1);
        });
    });

    describe('set', () => {
        it('should stringify and save to localStorage', () => {
            const testData = { columns: ['col1', 'col2'] };
            storageService.set('test-key', testData);

            expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
                'test-key',
                expect.any(String)
            );
        });

        it('should update cache when setting', () => {
            const testData = { id: 'test' };
            storageService.set('cache-test', testData);

            const result = storageService.get('cache-test', null);
            expect(result).toEqual(testData);
        });
    });

    describe('remove', () => {
        it('should remove from localStorage', () => {
            storageService.remove('remove-test');
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('remove-test');
        });
    });

    describe('getAllData', () => {
        it('should return all app data with defaults', () => {
            const data = storageService.getAllData();

            expect(data).toHaveProperty('columns');
            expect(data).toHaveProperty('projects');
            expect(data).toHaveProperty('tasks');
            expect(data).toHaveProperty('priorities');
            expect(data).toHaveProperty('projectTypes');
            expect(data).toHaveProperty('customFields');
            expect(data).toHaveProperty('activeProjectId');
            expect(data).toHaveProperty('sidebarCollapsed');
            expect(data).toHaveProperty('grouping');
        });
    });

    describe('exportData', () => {
        it('should return valid JSON string', () => {
            const exported = storageService.exportData();

            expect(() => JSON.parse(exported)).not.toThrow();

            const parsed = JSON.parse(exported);
            expect(parsed).toHaveProperty('version');
        });
    });

    describe('importData', () => {
        it('should validate and import data', () => {
            const validData = {
                columns: [{ id: 'col1', title: 'Column 1', color: '#ff0000' }],
                projectTypes: [{ id: 'type1', label: 'Type 1', icon: 'folder' }],
                priorities: [{ id: 'high', label: 'High', color: '#ff0000', level: 1 }],
                customFields: [],
                projects: [{ id: 'p1', name: 'Test Project', type: 'folder' }],
                tasks: [],
                version: '1.0.0'
            };

            const result = storageService.importData(JSON.stringify(validData));

            expect(result.error).toBeUndefined();
            expect(result.data).toBeDefined();
        });

        it('should return error for invalid JSON', () => {
            const result = storageService.importData('not valid json');

            expect(result.data).toBeNull();
            expect(result.error).toBeDefined();
        });
    });
});
