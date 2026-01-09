/**
 * Example Migration: v1.0.0 → v1.1.0
 * 
 * This is a template file demonstrating how to create version-specific migrations.
 * Copy this file and modify for new version migrations.
 * 
 * Migration guidelines:
 * 1. Always handle missing/undefined fields gracefully with defaults
 * 2. Never remove existing data without explicit user consent
 * 3. Preserve backward compatibility where possible
 * 4. Log any transformations for debugging
 */

import { MigratableAppData } from '../../types';

/**
 * Migration from v1.0.0 to v1.1.0
 * 
 * Changes in this version:
 * - Adds `savedViews` array for persistent filter views
 * - Adds `icon` field to Project type
 * 
 * @param data - The application data in v1.0.0 format
 * @returns The migrated data in v1.1.0 format
 */
export function migrateV1_0_to_V1_1(data: MigratableAppData): MigratableAppData {
    return {
        ...data,
        // Add new savedViews array if not present
        savedViews: data.savedViews ?? [],

        // Ensure all projects have the icon field
        projects: (data.projects ?? []).map(project => ({
            ...project,
            icon: project.icon ?? undefined,
        })),

        // Update version
        version: '1.1.0',
    };
}

/**
 * Example: Migration from v1.1.0 to v2.0.0 (major version)
 * 
 * Major version migrations may involve:
 * - Renaming fields
 * - Changing data structures
 * - Removing deprecated fields
 * 
 * @param data - The application data in v1.1.0 format
 * @returns The migrated data in v2.0.0 format
 */
export function migrateV1_1_to_V2_0(data: MigratableAppData): MigratableAppData {
    // Example: Add a 'description' field while keeping 'subtitle' for backward compat
    const migratedTasks = (data.tasks ?? []).map(task => ({
        ...task,
        // Add description field derived from subtitle/summary
        // In a real migration, you might want to handle this differently
    }));

    return {
        ...data,
        tasks: migratedTasks,
        version: '2.0.0',
    };
}
