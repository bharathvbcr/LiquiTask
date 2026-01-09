import { describe, it, expect } from 'vitest';
import {
    TaskSchema,
    ProjectSchema,
    BoardColumnSchema,
    ProjectTypeSchema,
    PriorityDefinitionSchema,
    CustomFieldDefinitionSchema,
    AppDataSchema,
    validateAndTransformImportedData,
} from '../validation';
import { z } from 'zod';

describe('validation schemas', () => {
    describe('TaskSchema', () => {
        it('should validate a valid task', () => {
            const validTask = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Test Task',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'high',
                status: 'Pending',
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            expect(() => TaskSchema.parse(validTask)).not.toThrow();
        });

        it('should reject task without title', () => {
            const invalidTask = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                subtitle: '',
                summary: '',
                assignee: '',
                priority: 'high',
                status: 'Pending',
                createdAt: new Date(),
                subtasks: [],
                attachments: [],
                tags: [],
                timeEstimate: 0,
                timeSpent: 0,
            };

            expect(() => TaskSchema.parse(invalidTask)).toThrow();
        });

        it('should validate task with optional fields', () => {
            const taskWithOptional = {
                id: 'task-1',
                jobId: 'TSK-1001',
                projectId: 'p1',
                title: 'Task',
                subtitle: 'Subtitle',
                summary: 'Summary',
                assignee: 'John',
                priority: 'medium',
                status: 'Pending',
                createdAt: new Date(),
                updatedAt: new Date(),
                dueDate: new Date(),
                subtasks: [
                    { id: 'sub-1', title: 'Subtask', completed: false },
                ],
                attachments: [],
                customFieldValues: { field1: 'value1' },
                links: [],
                tags: ['urgent'],
                timeEstimate: 120,
                timeSpent: 60,
                completedAt: new Date(),
            };

            expect(() => TaskSchema.parse(taskWithOptional)).not.toThrow();
        });
    });

    describe('ProjectSchema', () => {
        it('should validate a valid project', () => {
            const validProject = {
                id: 'p1',
                name: 'Test Project',
                type: 'folder',
            };

            expect(() => ProjectSchema.parse(validProject)).not.toThrow();
        });

        it('should reject project without name', () => {
            const invalidProject = {
                id: 'p1',
                type: 'folder',
            };

            expect(() => ProjectSchema.parse(invalidProject)).toThrow();
        });

        it('should validate project with optional fields', () => {
            const projectWithOptional = {
                id: 'p1',
                name: 'Project',
                type: 'folder',
                parentId: 'p0',
                pinned: true,
                order: 1,
            };

            expect(() => ProjectSchema.parse(projectWithOptional)).not.toThrow();
        });
    });

    describe('BoardColumnSchema', () => {
        it('should validate a valid column', () => {
            const validColumn = {
                id: 'col-1',
                title: 'To Do',
                color: '#ff0000',
            };

            expect(() => BoardColumnSchema.parse(validColumn)).not.toThrow();
        });

        it('should reject invalid hex color', () => {
            const invalidColumn = {
                id: 'col-1',
                title: 'To Do',
                color: 'red',
            };

            expect(() => BoardColumnSchema.parse(invalidColumn)).toThrow();
        });

        it('should validate column with optional fields', () => {
            const columnWithOptional = {
                id: 'col-1',
                title: 'Done',
                color: '#00ff00',
                isCompleted: true,
                wipLimit: 5,
            };

            expect(() => BoardColumnSchema.parse(columnWithOptional)).not.toThrow();
        });

        it('should reject negative wipLimit', () => {
            const invalidColumn = {
                id: 'col-1',
                title: 'Column',
                color: '#ff0000',
                wipLimit: -1,
            };

            expect(() => BoardColumnSchema.parse(invalidColumn)).toThrow();
        });
    });

    describe('PriorityDefinitionSchema', () => {
        it('should validate a valid priority', () => {
            const validPriority = {
                id: 'high',
                label: 'High',
                color: '#ff0000',
                level: 1,
            };

            expect(() => PriorityDefinitionSchema.parse(validPriority)).not.toThrow();
        });

        it('should validate priority with icon', () => {
            const priorityWithIcon = {
                id: 'high',
                label: 'High',
                color: '#ff0000',
                level: 1,
                icon: 'flame',
            };

            expect(() => PriorityDefinitionSchema.parse(priorityWithIcon)).not.toThrow();
        });

        it('should reject non-positive level', () => {
            const invalidPriority = {
                id: 'high',
                label: 'High',
                color: '#ff0000',
                level: 0,
            };

            expect(() => PriorityDefinitionSchema.parse(invalidPriority)).toThrow();
        });
    });

    describe('CustomFieldDefinitionSchema', () => {
        it('should validate text field', () => {
            const textField = {
                id: 'field-1',
                label: 'Custom Field',
                type: 'text',
            };

            expect(() => CustomFieldDefinitionSchema.parse(textField)).not.toThrow();
        });

        it('should validate dropdown field with options', () => {
            const dropdownField = {
                id: 'field-1',
                label: 'Status',
                type: 'dropdown',
                options: ['Option 1', 'Option 2'],
            };

            expect(() => CustomFieldDefinitionSchema.parse(dropdownField)).not.toThrow();
        });

        it('should reject invalid field type', () => {
            const invalidField = {
                id: 'field-1',
                label: 'Field',
                type: 'invalid',
            };

            expect(() => CustomFieldDefinitionSchema.parse(invalidField)).toThrow();
        });
    });

    describe('AppDataSchema', () => {
        it('should validate complete app data', () => {
            const appData = {
                columns: [
                    { id: 'col-1', title: 'Column', color: '#ff0000' },
                ],
                projects: [
                    { id: 'p1', name: 'Project', type: 'folder' },
                ],
                tasks: [],
                priorities: [
                    { id: 'high', label: 'High', color: '#ff0000', level: 1 },
                ],
                projectTypes: [
                    { id: 'type-1', label: 'Type', icon: 'folder' },
                ],
                customFields: [],
                activeProjectId: 'p1',
                sidebarCollapsed: false,
                grouping: 'none',
                version: '1.0.0',
            };

            expect(() => AppDataSchema.parse(appData)).not.toThrow();
        });

        it('should validate partial app data', () => {
            const partialData = {
                tasks: [],
            };

            expect(() => AppDataSchema.parse(partialData)).not.toThrow();
        });
    });
});

describe('validateAndTransformImportedData', () => {
    it('should validate and transform valid data', () => {
        const data = {
            tasks: [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: 'Pending',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
            ],
        };

        const result = validateAndTransformImportedData(data);

        expect(result).not.toBeNull();
        expect(result?.tasks).toBeDefined();
        expect(result?.tasks?.[0].createdAt).toBeInstanceOf(Date);
    });

    it('should transform date strings to Date objects', () => {
        const data = {
            tasks: [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: 'Pending',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    updatedAt: '2024-01-02T00:00:00.000Z',
                    dueDate: '2024-01-15T00:00:00.000Z',
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
            ],
        };

        const result = validateAndTransformImportedData(data);

        expect(result?.tasks?.[0].createdAt).toBeInstanceOf(Date);
        expect(result?.tasks?.[0].updatedAt).toBeInstanceOf(Date);
        expect(result?.tasks?.[0].dueDate).toBeInstanceOf(Date);
    });

    it('should handle recurring config dates', () => {
        const data = {
            tasks: [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: 'Pending',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                    recurring: {
                        enabled: true,
                        frequency: 'weekly',
                        interval: 1,
                        endDate: '2024-12-31T00:00:00.000Z',
                        nextOccurrence: '2024-01-08T00:00:00.000Z',
                    },
                },
            ],
        };

        const result = validateAndTransformImportedData(data);

        expect(result?.tasks?.[0].recurring?.endDate).toBeInstanceOf(Date);
        expect(result?.tasks?.[0].recurring?.nextOccurrence).toBeInstanceOf(Date);
    });

    it('should handle error logs', () => {
        const data = {
            tasks: [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: 'Pending',
                    createdAt: '2024-01-01T00:00:00.000Z',
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                    errorLogs: [
                        {
                            timestamp: '2024-01-01T00:00:00.000Z',
                            message: 'Error message',
                        },
                    ],
                },
            ],
        };

        const result = validateAndTransformImportedData(data);

        expect(result?.tasks?.[0].errorLogs?.[0].timestamp).toBeInstanceOf(Date);
        expect(result?.tasks?.[0].errorLogs?.[0].message).toBe('Error message');
    });

    it('should return null for null data', () => {
        const result = validateAndTransformImportedData(null);

        expect(result).toBeNull();
    });

    it('should throw error for invalid data', () => {
        const invalidData = {
            tasks: [
                {
                    // Missing required fields
                    id: 'task-1',
                },
            ],
        };

        expect(() => validateAndTransformImportedData(invalidData)).toThrow();
    });

    it('should handle invalid date strings gracefully', () => {
        const data = {
            tasks: [
                {
                    id: 'task-1',
                    jobId: 'TSK-1001',
                    projectId: 'p1',
                    title: 'Task',
                    subtitle: '',
                    summary: '',
                    assignee: '',
                    priority: 'medium',
                    status: 'Pending',
                    createdAt: 'invalid-date',
                    subtasks: [],
                    attachments: [],
                    tags: [],
                    timeEstimate: 0,
                    timeSpent: 0,
                },
            ],
        };

        const result = validateAndTransformImportedData(data);

        // Should create a new Date if parsing fails
        expect(result?.tasks?.[0].createdAt).toBeInstanceOf(Date);
    });
});

