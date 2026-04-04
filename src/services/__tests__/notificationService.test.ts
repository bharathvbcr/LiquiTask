import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationService } from "../notificationService";

// Mock Notification class
class MockNotification {
  static lastInstance: MockNotification | null = null;
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn().mockResolvedValue("granted");
  
  onclick: (() => void) | null = null;
  title: string;
  options: any;

  constructor(title: string, options?: any) {
    this.title = title;
    this.options = options;
    MockNotification.lastInstance = this;
  }
}

const mockElectronAPI = {
  showNotification: vi.fn(),
};

interface NotificationServiceInternal {
  hasPermission: boolean;
  notifiedOverdueIds: Set<string>;
}

describe("notificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockNotification.lastInstance = null;
    MockNotification.permission = "default";
    MockNotification.requestPermission.mockResolvedValue("granted");

    // Setup global mocks
    vi.stubGlobal("Notification", MockNotification);
    
    // Default to web runtime
    vi.stubGlobal("window", {
      ...globalThis,
      Notification: MockNotification,
      electronAPI: undefined,
    });
    
    // Reset service state (hacky since it's a singleton)
    const internal = notificationService as unknown as NotificationServiceInternal;
    internal.hasPermission = false;
    internal.notifiedOverdueIds.clear();
  });

  afterEach(() => {
    notificationService.stopPeriodicCheck();
    vi.unstubAllGlobals();
  });

  describe("requestPermission", () => {
    it("should request permission in browser", async () => {
      const result = await notificationService.requestPermission();

      expect(result).toBe(true);
      expect(MockNotification.requestPermission).toHaveBeenCalled();
    });

    it("should return false if permission denied", async () => {
      MockNotification.requestPermission.mockResolvedValue("denied");

      const result = await notificationService.requestPermission();

      expect(result).toBe(false);
    });

    it("should return true for Electron without requesting browser permission", async () => {
      vi.stubGlobal("window", {
        ...globalThis,
        electronAPI: mockElectronAPI,
      });

      const result = await notificationService.requestPermission();

      expect(result).toBe(true);
      expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    });
  });

  describe("show", () => {
    it("should show notification in browser", async () => {
      // Must have permission first
      MockNotification.requestPermission.mockResolvedValue("granted");
      await notificationService.requestPermission();

      notificationService.show({
        title: "Test Title",
        body: "Test Body",
      });

      expect(MockNotification.lastInstance).not.toBeNull();
      expect(MockNotification.lastInstance?.title).toBe("Test Title");
      expect(MockNotification.lastInstance?.options.body).toBe("Test Body");
    });

    it("should not show notification without permission", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      notificationService.show({
        title: "Test Title",
        body: "Test Body",
      });

      expect(MockNotification.lastInstance).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith("Notification permission not granted");
    });

    it("should attach onClick handler", async () => {
      await notificationService.requestPermission();
      const onClick = vi.fn();

      notificationService.show({
        title: "Test",
        body: "Test",
        onClick,
      });

      expect(MockNotification.lastInstance?.onclick).toBe(onClick);
    });

    it("should show notification in Electron", async () => {
      vi.stubGlobal("window", {
        ...globalThis,
        electronAPI: mockElectronAPI,
      });
      
      await notificationService.requestPermission();
      mockElectronAPI.showNotification.mockClear();

      notificationService.show({
        title: "Test Title",
        body: "Test Body",
        silent: true,
      });

      expect(mockElectronAPI.showNotification).toHaveBeenCalledWith({
        title: "Test Title",
        body: "Test Body",
        silent: true,
      });
    });
  });

  describe("scheduleTaskReminder", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should schedule reminder 1 hour before due date", async () => {
      await notificationService.requestPermission();
      const showSpy = vi.spyOn(notificationService, "show");

      const dueDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      notificationService.scheduleTaskReminder("task-1", "Test Task", dueDate);

      vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour

      expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({
        title: "⏰ Task Due Soon",
        body: expect.stringContaining("due in 1 hour"),
      }));
    });
  });

  describe("checkOverdueTasks", () => {
    it("should identify overdue tasks", () => {
      const now = new Date();
      const tasks = [
        {
          id: "task-1",
          title: "Overdue Task",
          dueDate: new Date(now.getTime() - 1000),
          status: "Pending",
        },
        {
          id: "task-2",
          title: "Future Task",
          dueDate: new Date(now.getTime() + 1000),
          status: "Pending",
        },
      ];

      const result = notificationService.checkOverdueTasks(tasks as any);

      expect(result.overdue).toHaveLength(1);
      expect(result.overdue[0].id).toBe("task-1");
    });
  });

  describe("notifyOverdue", () => {
    it("should notify single overdue task", async () => {
      await notificationService.requestPermission();
      const showSpy = vi.spyOn(notificationService, "show");

      notificationService.notifyOverdue([{ title: "Overdue Task" }]);

      expect(showSpy).toHaveBeenCalledWith(expect.objectContaining({
        title: "⚠️ Overdue Task",
      }));
    });
  });

  describe("startPeriodicCheck", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should check for overdue tasks periodically", async () => {
      await notificationService.requestPermission();
      const checkOverdueSpy = vi.spyOn(notificationService, "checkOverdueTasks");

      const getTasks = () => [
        {
          id: "task-1",
          title: "Overdue",
          dueDate: new Date(Date.now() - 1000),
          status: "Pending",
        },
      ];

      notificationService.startPeriodicCheck(getTasks as any, 1000);

      expect(checkOverdueSpy).toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(checkOverdueSpy).toHaveBeenCalledTimes(2);
    });
  });
});
