/**
 * Migration Service Tests
 * 
 * Tests for the data migration system including:
 * - Version comparison
 * - Migration execution
 * - Backup/restore functionality
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MigrationService, CURRENT_DATA_VERSION } from '../migrationService';
import { compareVersions, getMigrationsFrom, getCurrentDataVersion, MIGRATIONS } from '../../migrations';
import { MigratableAppData } from '../../../types';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
    };
})();

Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
});

describe('Migration Version Utilities', () => {
    describe('compareVersions', () => {
        it('should return 0 for equal versions', () => {
            expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
            expect(compareVersions('2.1.3', '2.1.3')).toBe(0);
        });

        it('should return 1 when first version is greater', () => {
            expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
            expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
            expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
        });

        it('should return -1 when first version is smaller', () => {
            expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
            expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
            expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
        });

        it('should handle versions with missing parts', () => {
            expect(compareVersions('1.0', '1.0.0')).toBe(0);
            expect(compareVersions('1', '1.0.0')).toBe(0);
        });
    });

    describe('getCurrentDataVersion', () => {
        it('should return a valid version string', () => {
            const version = getCurrentDataVersion();
            expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        });

        it('should return baseline version when no migrations exist', () => {
            // If MIGRATIONS is empty, should return '1.0.0'
            if (MIGRATIONS.length === 0) {
                expect(getCurrentDataVersion()).toBe('1.0.0');
            }
        });
    });

    describe('getMigrationsFrom', () => {
        it('should return empty array when already at latest version', () => {
            const migrations = getMigrationsFrom(CURRENT_DATA_VERSION);
            expect(migrations).toHaveLength(0);
        });

        it('should return all migrations for version 0.0.0', () => {
            const migrations = getMigrationsFrom('0.0.0');
            expect(migrations).toEqual(MIGRATIONS);
        });
    });
});

describe('MigrationService', () => {
    let service: MigrationService;

    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
        service = new MigrationService();
    });

    afterEach(() => {
        localStorageMock.clear();
    });

    describe('needsMigration', () => {
        it('should return false when at current version', () => {
            expect(service.needsMigration(CURRENT_DATA_VERSION)).toBe(false);
        });

        it('should return true for undefined version', () => {
            expect(service.needsMigration(undefined)).toBe(true);
        });

        it('should return true for older version', () => {
            expect(service.needsMigration('0.0.0')).toBe(true);
        });
    });

    describe('createBackup', () => {
        it('should create a backup with unique ID', () => {
            const data: MigratableAppData = {
                version: '1.0.0',
                tasks: [],
                projects: [],
            };

            const backupId = service.createBackup(data);

            expect(backupId).toContain('backup_');
            expect(service.listBackups()).toHaveLength(1);
        });

        it('should store backup data correctly', () => {
            const data: MigratableAppData = {
                version: '1.0.0',
                tasks: [],
                projects: [{ id: 'p1', name: 'Test', type: 'folder' }],
            };

            const backupId = service.createBackup(data);
            const restored = service.restoreBackup(backupId);

            expect(restored).toEqual(data);
        });

        it('should prune old backups when exceeding max', () => {
            const data: MigratableAppData = { version: '1.0.0' };

            // Create 5 backups (max is 3)
            for (let i = 0; i < 5; i++) {
                service.createBackup(data);
            }

            expect(service.listBackups().length).toBeLessThanOrEqual(3);
        });
    });

    describe('restoreBackup', () => {
        it('should restore backup data', () => {
            const data: MigratableAppData = {
                version: '1.0.0',
                tasks: [],
                columns: [{ id: 'col1', title: 'Test', color: '#000000' }],
            };

            const backupId = service.createBackup(data);
            const restored = service.restoreBackup(backupId);

            expect(restored).toEqual(data);
        });

        it('should return null for non-existent backup', () => {
            const restored = service.restoreBackup('non-existent-id');
            expect(restored).toBeNull();
        });

        it('should return a deep copy (not reference)', () => {
            const data: MigratableAppData = {
                version: '1.0.0',
                projects: [{ id: 'p1', name: 'Test', type: 'folder' }],
            };

            const backupId = service.createBackup(data);
            const restored1 = service.restoreBackup(backupId);
            const restored2 = service.restoreBackup(backupId);

            expect(restored1).not.toBe(restored2);
            expect(restored1).toEqual(restored2);
        });
    });

    describe('listBackups', () => {
        it('should return empty array when no backups', () => {
            expect(service.listBackups()).toEqual([]);
        });

        it('should return backups sorted by timestamp (newest first)', () => {
            const data: MigratableAppData = { version: '1.0.0' };

            service.createBackup(data);
            service.createBackup(data);
            service.createBackup(data);

            const backups = service.listBackups();

            for (let i = 1; i < backups.length; i++) {
                expect(backups[i - 1].timestamp.getTime())
                    .toBeGreaterThanOrEqual(backups[i].timestamp.getTime());
            }
        });
    });

    describe('deleteBackup', () => {
        it('should delete a backup', () => {
            const data: MigratableAppData = { version: '1.0.0' };
            const backupId = service.createBackup(data);

            expect(service.listBackups()).toHaveLength(1);

            const deleted = service.deleteBackup(backupId);

            expect(deleted).toBe(true);
            expect(service.listBackups()).toHaveLength(0);
        });

        it('should return false for non-existent backup', () => {
            expect(service.deleteBackup('non-existent')).toBe(false);
        });
    });

    describe('runMigrations', () => {
        it('should return success with same version when no migration needed', () => {
            const data: MigratableAppData = { version: CURRENT_DATA_VERSION };

            const result = service.runMigrations(data, CURRENT_DATA_VERSION);

            expect(result.success).toBe(true);
            expect(result.migratedFrom).toBe(CURRENT_DATA_VERSION);
            expect(result.migratedTo).toBe(CURRENT_DATA_VERSION);
        });

        it('should create backup before migration', () => {
            const data: MigratableAppData = { version: '0.0.0' };

            const result = service.runMigrations(data, '0.0.0');

            expect(result.backupId).toBeDefined();
            expect(service.listBackups()).toHaveLength(1);
        });

        it('should update version to current after migration', () => {
            const data: MigratableAppData = { version: '0.0.0' };

            const result = service.runMigrations(data, '0.0.0');

            expect(result.success).toBe(true);
            expect(result.data?.version).toBe(CURRENT_DATA_VERSION);
        });

        it('should preserve existing data during migration', () => {
            const data: MigratableAppData = {
                version: '0.0.0',
                tasks: [],
                projects: [{ id: 'p1', name: 'My Project', type: 'folder' }],
                columns: [{ id: 'col1', title: 'Todo', color: '#ff0000' }],
            };

            const result = service.runMigrations(data, '0.0.0');

            expect(result.success).toBe(true);
            expect(result.data?.projects).toEqual(data.projects);
            expect(result.data?.columns).toEqual(data.columns);
        });
    });

    describe('Migration Logs', () => {
        it('should store migration logs', () => {
            const data: MigratableAppData = { version: '0.0.0' };

            service.runMigrations(data, '0.0.0');

            const logs = service.getMigrationLogs();
            expect(logs.length).toBeGreaterThan(0);
        });

        it('should clear migration logs', () => {
            const data: MigratableAppData = { version: '0.0.0' };

            service.runMigrations(data, '0.0.0');
            service.clearMigrationLogs();

            expect(service.getMigrationLogs()).toEqual([]);
        });
    });
});

describe('Data Integrity', () => {
    let service: MigrationService;

    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
        service = new MigrationService();
    });

    it('should maintain task data integrity through migration', () => {
        const originalTask = {
            id: 'task-1',
            jobId: 'job-1',
            projectId: 'proj-1',
            title: 'Test Task',
            subtitle: 'Subtitle',
            summary: 'Summary',
            assignee: 'John',
            priority: 'high',
            status: 'Pending',
            createdAt: new Date('2025-01-01'),
            subtasks: [],
            attachments: [],
            tags: ['important'],
            timeEstimate: 60,
            timeSpent: 30,
        };

        const data: MigratableAppData = {
            version: '0.0.0',
            tasks: [originalTask],
        };

        const result = service.runMigrations(data, '0.0.0');

        expect(result.success).toBe(true);
        expect(result.data?.tasks?.[0].id).toBe(originalTask.id);
        expect(result.data?.tasks?.[0].title).toBe(originalTask.title);
        expect(result.data?.tasks?.[0].priority).toBe(originalTask.priority);
    });

    it('should maintain project hierarchy through migration', () => {
        const data: MigratableAppData = {
            version: '0.0.0',
            projects: [
                { id: 'parent', name: 'Parent', type: 'folder' },
                { id: 'child', name: 'Child', type: 'folder', parentId: 'parent' },
            ],
        };

        const result = service.runMigrations(data, '0.0.0');

        expect(result.success).toBe(true);
        const childProject = result.data?.projects?.find(p => p.id === 'child');
        expect(childProject?.parentId).toBe('parent');
    });
});
