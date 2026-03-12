import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storageService } from '../storageService';
import { STORAGE_KEYS } from '../../constants';

describe('StorageService Extended', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('handles basic get/set with complex objects', () => {
    const data = { a: 1, b: [1, 2, 3] };
    storageService.set('test-key', data);
    expect(storageService.get('test-key', null)).toEqual(data);
  });

  it('handles removal of items', () => {
    storageService.set('remove-me', 'val');
    storageService.remove('remove-me');
    expect(storageService.get('remove-me', 'default')).toBe('default');
  });

  it('clears all data', () => {
    storageService.set('k1', 'v1');
    storageService.set('k2', 'v2');
    storageService.clear();
    expect(localStorage.length).toBe(0);
  });

  it('manages active project ID', () => {
    storageService.set(STORAGE_KEYS.ACTIVE_PROJECT, 'p123');
    expect(storageService.get(STORAGE_KEYS.ACTIVE_PROJECT, '')).toBe('p123');
  });

  it('exports and imports full app data', () => {
    const mockData = {
      projects: [{ id: 'p1', name: 'P1', type: 'folder' }],
      tasks: [{ 
          id: 't1', 
          jobId: 'JOB-1', 
          projectId: 'p1', 
          title: 'T1', 
          subtitle: 'S1', 
          summary: 'Sum1', 
          assignee: 'A1', 
          priority: 'high', 
          status: 'Pending', 
          createdAt: new Date().toISOString(),
          tags: [],
          timeEstimate: 0,
          timeSpent: 0,
          subtasks: [],
          attachments: []
      }],
      columns: [{ id: 'Pending', title: 'C1', color: '#64748b' }],
      priorities: [{ id: 'high', label: 'High', color: '#ef4444', level: 1 }],
      projectTypes: [{ id: 'folder', label: 'General', icon: 'folder' }],
      customFields: []
    };
    
    storageService.set(STORAGE_KEYS.PROJECTS, mockData.projects);
    storageService.set(STORAGE_KEYS.TASKS, mockData.tasks);
    storageService.set(STORAGE_KEYS.COLUMNS, mockData.columns);
    storageService.set(STORAGE_KEYS.PRIORITIES, mockData.priorities);
    storageService.set(STORAGE_KEYS.PROJECT_TYPES, mockData.projectTypes);
    storageService.set(STORAGE_KEYS.CUSTOM_FIELDS, mockData.customFields);

    const exported = storageService.exportData();
    expect(exported).toContain('projects');
    expect(exported).toContain('tasks');

    const result = storageService.importData(exported);
    expect(result.error).toBeUndefined();
    expect(result.data?.projects).toHaveLength(1);
  });

  it('handles corrupt JSON in importData', () => {
      const result = storageService.importData('invalid-json');
      expect(result.error).toBeDefined();
  });
});
