/**
 * Migration Registry
 * 
 * This file exports all version-specific migrations in order.
 * Migrations are executed sequentially from the user's current version
 * to the target version.
 * 
 * IMPORTANT: Add new migrations at the end in version order.
 */

import { Migration } from '../../types';

/**
 * All registered migrations, ordered by version.
 * Each migration transforms data from the previous version to its target version.
 */
export const MIGRATIONS: Migration[] = [
    // v1.0.0 is the baseline - no migration needed

    // Example migration for future v1.1.0
    // Uncomment and modify when releasing v1.1.0
    /*
    {
        version: '1.1.0',
        description: 'Add savedViews array to support persistent filter views',
        migrate: (data: MigratableAppData): MigratableAppData => ({
            ...data,
            savedViews: data.savedViews ?? [],
            version: '1.1.0',
        }),
    },
    */
];

/**
 * Get the current target version (highest version in migrations + 1)
 * or the baseline if no migrations exist
 */
export function getCurrentDataVersion(): string {
    if (MIGRATIONS.length === 0) {
        return '1.0.0'; // Baseline version
    }
    return MIGRATIONS[MIGRATIONS.length - 1].version;
}

/**
 * Get migrations needed to upgrade from a specific version
 */
export function getMigrationsFrom(fromVersion: string): Migration[] {
    return MIGRATIONS.filter(m => compareVersions(m.version, fromVersion) > 0);
}

/**
 * Compare two semantic version strings
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;

        if (numA > numB) return 1;
        if (numA < numB) return -1;
    }

    return 0;
}
