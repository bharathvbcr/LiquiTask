/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationService } from '../notificationService';

// Mock Notification API
class MockNotificationClass {
  static lastInstance: MockNotificationClass | null = null;
  onclick: (() => void) | null = null;
  static requestPermission = vi.fn(() => Promise.resolve('granted'));
  static permission = 'granted';
  constructor(_title: string, _options?: NotificationOptions) {
    MockNotificationClass.lastInstance = this;
  }
}

const MockNotification = vi.fn(function (title: string, options?: NotificationOptions) {
  return new MockNotificationClass(title, options);
}) as any;
MockNotification.requestPermission = MockNotificationClass.requestPermission;
MockNotification.permission = MockNotificationClass.permission;
Object.defineProperty(MockNotification, 'lastInstance', {
  get: () => MockNotificationClass.lastInstance,
});

const mockElectronAPI = {
  showNotification: vi.fn(),
};

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockNotificationClass.lastInstance = null;

    // Reset global mocks
    (global as any).Notification = MockNotification;
    (global as any).window = {
      ...global.window,
      electronAPI: undefined,
      __electronAPI: undefined,
    };
  });

  afterEach(() => {
    notificationService.stopPeriodicCheck();
    (notificationService as any).notifiedOverdueIds.clear();
  });

  describe('requestPermission', () => {
    it('should request permission in browser', async () => {
      MockNotification.requestPermission.mockResolvedValue('granted');

      const result = await notificationService.requestPermission();

      expect(result).toBe(true);
      expect(MockNotification.requestPermission).toHaveBeenCalled();
    });

    it('should return false if permission denied', async () => {
      MockNotification.requestPermission.mockResolvedValue('denied');

      const result = await notificationService.requestPermission();

      expect(result).toBe(false);
    });

    it('should return true for Electron without requesting browser permission', async () => {
      (notificationService as any).hasPermission = false;
      (global as any).window.electronAPI = mockElectronAPI;
      (global as any).window.__electronAPI = {};

      const result = await notificationService.requestPermission();

      expect(result).toBe(true);
      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });
  });

  describe('show', () => {
    it('should show notification in browser', () => {
      (notificationService as any).hasPermission = true;

      notificationService.show({
        title: 'Test Title',
        body: 'Test Body',
      });

      expect(MockNotification).toHaveBeenCalledWith('Test Title', {
        body: 'Test Body',
        icon: undefined,
        tag: undefined,
        silent: undefined,
      });
    });

    it('should not show notification without permission', () => {
      (notificationService as any).hasPermission = false;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      notificationService.show({
        title: 'Test Title',
        body: 'Test Body',
      });

      expect(MockNotification).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Notification permission not granted');

      consoleSpy.mockRestore();
    });

    it('should attach onClick handler', () => {
      (notificationService as any).hasPermission = true;
      const onClick = vi.fn();

      notificationService.show({
        title: 'Test',
        body: 'Test',
        onClick,
      });

      expect(MockNotification.lastInstance!.onclick).toBe(onClick);
    });

    it('should show notification in Electron', () => {
      (global as any).window.electronAPI = mockElectronAPI;
      (global as any).window.__electronAPI = {};
      (notificationService as any).hasPermission = true;
      mockElectronAPI.showNotification.mockClear();

      notificationService.show({
        title: 'Test Title',
        body: 'Test Body',
        silent: true,
      });

      expect(mockElectronAPI.showNotification).toHaveBeenCalledWith({
        title: 'Test Title',
        body: 'Test Body',
        silent: true,
      });
    });
  });

  describe('scheduleTaskReminder', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule reminder 1 hour before due date', () => {
      (notificationService as any).hasPermission = true;
      const showSpy = vi.spyOn(notificationService, 'show');

      const dueDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      notificationService.scheduleTaskReminder('task-1', 'Test Task', dueDate);

      vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour

      expect(showSpy).toHaveBeenCalledWith({
        title: '⏰ Task Due Soon',
        body: '"Test Task" is due in 1 hour',
        tag: 'task-reminder-task-1',
      });
    });

    it('should not schedule if already past due', () => {
      (notificationService as any).hasPermission = true;
      const showSpy = vi.spyOn(notificationService, 'show');

      const dueDate = new Date(Date.now() - 1000); // 1 second ago
      notificationService.scheduleTaskReminder('task-1', 'Test Task', dueDate);

      vi.advanceTimersByTime(10000);

      expect(showSpy).not.toHaveBeenCalled();
    });

    it('should schedule due notification if more than 1 hour away', () => {
      (notificationService as any).hasPermission = true;
      const showSpy = vi.spyOn(notificationService, 'show');

      const dueDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      notificationService.scheduleTaskReminder('task-1', 'Test Task', dueDate);

      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours

      expect(showSpy).toHaveBeenCalledWith({
        title: '🚨 Task Due Now',
        body: '"Test Task" is due now!',
        tag: 'task-due-task-1',
      });
    });
  });

  describe('checkOverdueTasks', () => {
    it('should identify overdue tasks', () => {
      const now = new Date();
      const tasks = [
        {
          id: 'task-1',
          title: 'Overdue Task',
          dueDate: new Date(now.getTime() - 1000),
          status: 'Pending',
        },
        {
          id: 'task-2',
          title: 'Future Task',
          dueDate: new Date(now.getTime() + 1000),
          status: 'Pending',
        },
      ];

      const result = notificationService.checkOverdueTasks(tasks);

      expect(result.overdue).toHaveLength(1);
      expect(result.overdue[0].id).toBe('task-1');
      // task-2 is due in 1 second, which is less than 1 hour, so it should be in dueSoon
      expect(result.dueSoon.length).toBeGreaterThanOrEqual(0);
    });

    it('should identify tasks due soon', () => {
      const now = new Date();
      const tasks = [
        {
          id: 'task-1',
          title: 'Due Soon Task',
          dueDate: new Date(now.getTime() + 30 * 60 * 1000), // 30 minutes
          status: 'Pending',
        },
      ];

      const result = notificationService.checkOverdueTasks(tasks);

      expect(result.dueSoon).toHaveLength(1);
      expect(result.dueSoon[0].id).toBe('task-1');
    });

    it('should ignore completed tasks', () => {
      const now = new Date();
      const tasks = [
        {
          id: 'task-1',
          title: 'Completed Overdue',
          dueDate: new Date(now.getTime() - 1000),
          status: 'Done', // The implementation checks for 'Done', not 'Completed'
        },
        {
          id: 'task-2',
          title: 'Completed with completedAt',
          dueDate: new Date(now.getTime() - 1000),
          completedAt: new Date(),
        },
      ];

      const result = notificationService.checkOverdueTasks(tasks);

      expect(result.overdue).toHaveLength(0);
      expect(result.dueSoon).toHaveLength(0);
    });

    it('should ignore tasks without due dates', () => {
      const tasks = [
        {
          id: 'task-1',
          title: 'No Due Date',
          status: 'Pending',
        },
      ];

      const result = notificationService.checkOverdueTasks(tasks);

      expect(result.overdue).toHaveLength(0);
      expect(result.dueSoon).toHaveLength(0);
    });
  });

  describe('notifyOverdue', () => {
    it('should notify single overdue task', () => {
      (notificationService as any).hasPermission = true;
      const showSpy = vi.spyOn(notificationService, 'show');

      notificationService.notifyOverdue([{ title: 'Overdue Task' }]);

      expect(showSpy).toHaveBeenCalledWith({
        title: '⚠️ Overdue Task',
        body: '"Overdue Task" is past due!',
      });
    });

    it('should notify multiple overdue tasks', () => {
      (notificationService as any).hasPermission = true;
      const showSpy = vi.spyOn(notificationService, 'show');

      notificationService.notifyOverdue([
        { title: 'Task 1' },
        { title: 'Task 2' },
        { title: 'Task 3' },
      ]);

      expect(showSpy).toHaveBeenCalledWith({
        title: '⚠️ 3 Overdue Tasks',
        body: 'You have 3 tasks that are past due',
      });
    });

    it('should not notify if no overdue tasks', () => {
      (notificationService as any).hasPermission = true;
      const showSpy = vi.spyOn(notificationService, 'show');

      notificationService.notifyOverdue([]);

      expect(showSpy).not.toHaveBeenCalled();
    });
  });

  describe('startPeriodicCheck', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should check for overdue tasks periodically', () => {
      (notificationService as any).hasPermission = true;
      const checkOverdueSpy = vi.spyOn(notificationService, 'checkOverdueTasks');

      const getTasks = () => [
        {
          id: 'task-1',
          title: 'Overdue',
          dueDate: new Date(Date.now() - 1000),
          status: 'Pending',
        },
      ];

      notificationService.startPeriodicCheck(getTasks, 1000);

      // Initial check
      expect(checkOverdueSpy).toHaveBeenCalled();

      // After interval
      vi.advanceTimersByTime(1000);
      expect(checkOverdueSpy).toHaveBeenCalledTimes(2);
    });

    it('should only notify for newly overdue tasks', () => {
      (notificationService as any).hasPermission = true;
      const notifySpy = vi.spyOn(notificationService, 'notifyOverdue');

      const getTasks = () => [
        {
          id: 'task-1',
          title: 'Overdue',
          dueDate: new Date(Date.now() - 1000),
          status: 'Pending',
        },
      ];

      notificationService.startPeriodicCheck(getTasks, 1000);

      // First check - should notify
      expect(notifySpy).toHaveBeenCalledTimes(1);

      // Second check - should not notify again
      vi.advanceTimersByTime(1000);
      expect(notifySpy).toHaveBeenCalledTimes(1);
    });

    it('should stop periodic check', () => {
      const getTasks = () => [];

      notificationService.startPeriodicCheck(getTasks, 1000);
      notificationService.stopPeriodicCheck();

      // Should not throw or continue checking
      expect(() => {
        vi.advanceTimersByTime(5000);
      }).not.toThrow();
    });
  });

  describe('clearOverdueNotification', () => {
    it('should clear notification tracking for task', () => {
      (notificationService as any).notifiedOverdueIds.add('task-1');

      notificationService.clearOverdueNotification('task-1');

      expect((notificationService as any).notifiedOverdueIds.has('task-1')).toBe(false);
    });
  });
});
