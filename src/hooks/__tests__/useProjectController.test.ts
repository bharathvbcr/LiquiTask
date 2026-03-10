import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProjectController } from '../useProjectController';
import type { Project, ProjectType, Task } from '../../../types';

const projectTypes: ProjectType[] = [{ id: 'custom', label: 'Custom', icon: 'folder' }];

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  jobId: 'job-1',
  projectId: 'project-1',
  title: 'Task',
  subtitle: '',
  summary: '',
  assignee: '',
  priority: 'medium',
  status: 'Pending',
  createdAt: new Date('2026-03-06T10:00:00Z'),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 0,
  timeSpent: 0,
  ...overrides,
});

describe('useProjectController', () => {
  it('removes tasks for a deleted workspace inside the controller flow', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const addToast = vi.fn();
    const setTasks = vi.fn();
    const setActiveProjectId = vi.fn();
    const projects: Project[] = [
      { id: 'project-1', name: 'Alpha', type: 'custom' },
      { id: 'project-2', name: 'Beta', type: 'custom' },
    ];

    const { result } = renderHook(() =>
      useProjectController({
        initialProjects: projects,
        initialProjectTypes: projectTypes,
        addToast,
        confirm,
      })
    );

    let deleted = false;
    await act(async () => {
      deleted = await result.current.handleDeleteProject('project-1', 'project-1', setActiveProjectId, setTasks);
    });

    expect(deleted).toBe(true);
    expect(setTasks).toHaveBeenCalledTimes(1);

    const updater = setTasks.mock.calls[0][0] as (tasks: Task[]) => Task[];
    const remainingTasks = updater([
      makeTask({ id: 'task-1', projectId: 'project-1' }),
      makeTask({ id: 'task-2', projectId: 'project-2' }),
    ]);

    expect(remainingTasks.map(task => task.id)).toEqual(['task-2']);
    expect(setActiveProjectId).toHaveBeenCalledWith('project-2');
  });
});
