/**
 * Migration Service
 * 
 * Handles data schema migrations between application versions.
 * Provides automatic backup, sequential migration execution, and rollback capabilities.
 */

import { MigratableAppData, MigrationResult, BackupInfo } from '../../types';
import { STORAGE_KEYS } from '../constants';
import { getMigrationsFrom, compareVersions, getCurrentDataVersion } from '../migrations';

// Maximum number of backups to retain
const MAX_BACKUPS = 3;

// Current data schema version
export const CURRENT_DATA_VERSION = getCurrentDataVersion();

/**
 * Migration Service class
 * Manages data schema migrations with backup/restore capabilities
 */
export class MigrationService {
    private backups: Map<string, { data: MigratableAppData; info: BackupInfo }> = new Map();

    constructor() {
        this.loadBackupsFromStorage();
    }

    /**
     * Load existing backups from storage
     */
    private loadBackupsFromStorage(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.BACKUPS);
            if (stored) {
                const parsed = JSON.parse(stored) as Array<{ id: string; data: MigratableAppData; info: BackupInfo }>;
                parsed.forEach(backup => {
                    this.backups.set(backup.id, {
                        data: backup.data,
                        info: {
                            ...backup.info,
                            timestamp: new Date(backup.info.timestamp),
                        },
                    });
                });
            }
        } catch (error) {
            console.warn('Failed to load backups from storage:', error);
        }
    }

    /**
     * Save backups to storage
     */
    private saveBackupsToStorage(): void {
        try {
            const backupArray = Array.from(this.backups.entries()).map(([id, { data, info }]) => ({
                id,
                data,
                info,
            }));
            localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(backupArray));
        } catch (error) {
            console.error('Failed to save backups to storage:', error);
        }
    }

    /**
     * Check if migration is needed
     */
    needsMigration(currentVersion: string | undefined): boolean {
        const fromVersion = currentVersion || '0.0.0';
        return compareVersions(CURRENT_DATA_VERSION, fromVersion) > 0;
    }

    /**
     * Create a backup of the current data before migration
     */
    createBackup(data: MigratableAppData): string {
        const backupId = `backup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const dataString = JSON.stringify(data);

        const backupInfo: BackupInfo = {
            id: backupId,
            version: data.version || '0.0.0',
            timestamp: new Date(),
            size: dataString.length,
        };

        this.backups.set(backupId, { data: JSON.parse(dataString), info: backupInfo });

        // Prune old backups if exceeding max
        this.pruneOldBackups();

        // Persist to storage
        this.saveBackupsToStorage();

        this.logMigration(`Backup created: ${backupId} (version ${backupInfo.version})`);

        return backupId;
    }

    /**
     * Remove oldest backups to maintain the max limit
     */
    private pruneOldBackups(): void {
        if (this.backups.size <= MAX_BACKUPS) return;

        const sortedBackups = Array.from(this.backups.entries())
            .sort((a, b) => b[1].info.timestamp.getTime() - a[1].info.timestamp.getTime());

        // Keep only the most recent backups
        while (sortedBackups.length > MAX_BACKUPS) {
            const oldest = sortedBackups.pop();
            if (oldest) {
                this.backups.delete(oldest[0]);
            }
        }
    }

    /**
     * Restore data from a backup
     */
    restoreBackup(backupId: string): MigratableAppData | null {
        const backup = this.backups.get(backupId);
        if (!backup) {
            console.error(`Backup not found: ${backupId}`);
            return null;
        }

        this.logMigration(`Restored from backup: ${backupId}`);
        return JSON.parse(JSON.stringify(backup.data));
    }

    /**
     * List all available backups
     */
    listBackups(): BackupInfo[] {
        return Array.from(this.backups.values())
            .map(b => b.info)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    /**
     * Delete a specific backup
     */
    deleteBackup(backupId: string): boolean {
        const deleted = this.backups.delete(backupId);
        if (deleted) {
            this.saveBackupsToStorage();
        }
        return deleted;
    }

    /**
     * Run all pending migrations on the provided data
     */
    runMigrations(data: MigratableAppData, fromVersion: string): MigrationResult {
        const startVersion = fromVersion || '0.0.0';

        // Check if migration is needed
        if (!this.needsMigration(startVersion)) {
            return {
                success: true,
                migratedFrom: startVersion,
                migratedTo: startVersion,
                data,
            };
        }

        // Create backup before migration
        const backupId = this.createBackup(data);

        // Get migrations to run
        const pendingMigrations = getMigrationsFrom(startVersion);

        if (pendingMigrations.length === 0) {
            // No migrations, just update version
            const updatedData: MigratableAppData = {
                ...data,
                version: CURRENT_DATA_VERSION,
            };
            return {
                success: true,
                migratedFrom: startVersion,
                migratedTo: CURRENT_DATA_VERSION,
                data: updatedData,
                backupId,
            };
        }

        this.logMigration(`Starting migration from ${startVersion} to ${CURRENT_DATA_VERSION}`);
        this.logMigration(`Migrations to run: ${pendingMigrations.map(m => m.version).join(' → ')}`);

        let currentData = { ...data };
        let lastSuccessfulVersion = startVersion;

        try {
            for (const migration of pendingMigrations) {
                this.logMigration(`Running migration to ${migration.version}: ${migration.description}`);

                // Run the migration
                currentData = migration.migrate(currentData);

                // Validate the migrated data has the expected version
                if (currentData.version !== migration.version) {
                    currentData.version = migration.version;
                }

                lastSuccessfulVersion = migration.version;
                this.logMigration(`Migration to ${migration.version} completed successfully`);
            }

            // Ensure final version is set
            currentData.version = CURRENT_DATA_VERSION;

            this.logMigration(`Migration complete: ${startVersion} → ${CURRENT_DATA_VERSION}`);

            return {
                success: true,
                migratedFrom: startVersion,
                migratedTo: CURRENT_DATA_VERSION,
                data: currentData,
                backupId,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown migration error';
            this.logMigration(`Migration failed at ${lastSuccessfulVersion}: ${errorMessage}`, 'error');

            return {
                success: false,
                migratedFrom: startVersion,
                migratedTo: lastSuccessfulVersion,
                error: errorMessage,
                backupId,
            };
        }
    }

    /**
     * Log migration events for debugging
     */
    private logMigration(message: string, level: 'info' | 'error' = 'info'): void {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}`;

        if (level === 'error') {
            // eslint-disable-next-line no-console
            console.error(`[Migration] ${logEntry}`);
        } else {
            // eslint-disable-next-line no-console
            console.log(`[Migration] ${logEntry}`);
        }

        // Persist to migration log (for debugging)
        try {
            const existingLog = localStorage.getItem(STORAGE_KEYS.MIGRATION_LOG) || '[]';
            const logs = JSON.parse(existingLog) as string[];
            logs.push(logEntry);

            // Keep only last 100 log entries
            while (logs.length > 100) {
                logs.shift();
            }

            localStorage.setItem(STORAGE_KEYS.MIGRATION_LOG, JSON.stringify(logs));
        } catch {
            // Ignore logging errors
        }
    }

    /**
     * Get migration logs for debugging
     */
    getMigrationLogs(): string[] {
        try {
            const logs = localStorage.getItem(STORAGE_KEYS.MIGRATION_LOG);
            return logs ? JSON.parse(logs) : [];
        } catch {
            return [];
        }
    }

    /**
     * Clear migration logs
     */
    clearMigrationLogs(): void {
        localStorage.removeItem(STORAGE_KEYS.MIGRATION_LOG);
    }
}

// Singleton instance
export const migrationService = new MigrationService();
