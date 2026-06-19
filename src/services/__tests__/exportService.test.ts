import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomFieldDefinition, Task } from "../../../types";
import { exportService } from "../exportService";

describe("exportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  describe("exportToCSV", () => {
    const mockTasks: Task[] = [
      {
        id: "task-1",
        jobId: "TSK-1001",
        projectId: "p1",
        title: "Test Task",
        subtitle: "Subtitle",
        summary: "Summary",
        assignee: "John Doe",
        priority: "high",
        status: "Pending",
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-02"),
        dueDate: new Date("2024-01-15"),
        subtasks: [],
        attachments: [],
        tags: ["urgent", "important"],
        timeEstimate: 120,
        timeSpent: 60,
      },
    ];

    it("should export tasks to CSV format", () => {
      const csv = exportService.exportToCSV(mockTasks);

      expect(csv).toContain("Title");
      expect(csv).toContain("Test Task");
      expect(csv).toContain("John Doe");
      expect(csv).toContain("high");
    });

    it("should include all default columns", () => {
      const csv = exportService.exportToCSV(mockTasks);
      const lines = csv.split("\n");
      const headers = lines[0].split(",");

      expect(headers).toContain("Id");
      expect(headers).toContain("Title");
      expect(headers).toContain("Status");
      expect(headers).toContain("Priority");
      expect(headers).toContain("Assignee");
    });

    it("should format dates correctly", () => {
      const csv = exportService.exportToCSV(mockTasks);

      expect(csv).toContain("2024-01-01");
      expect(csv).toContain("2024-01-15");
    });

    it("should format tags as semicolon-separated", () => {
      const csv = exportService.exportToCSV(mockTasks);

      expect(csv).toContain("urgent; important");
    });

    it("should handle empty optional fields", () => {
      const taskWithoutOptional: Task = {
        id: "task-2",
        jobId: "TSK-1002",
        projectId: "p1",
        title: "Minimal Task",
        subtitle: "",
        summary: "",
        assignee: "",
        priority: "medium",
        status: "Pending",
        createdAt: new Date(),
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
      };

      const csv = exportService.exportToCSV([taskWithoutOptional]);

      expect(csv).toContain("Minimal Task");
      expect(csv).toContain("medium");
    });

    it("should escape CSV special characters", () => {
      const taskWithSpecialChars: Task = {
        id: "task-3",
        jobId: "TSK-1003",
        projectId: "p1",
        title: 'Task with "quotes" and, commas',
        subtitle: "",
        summary: "Line 1\nLine 2",
        assignee: "",
        priority: "medium",
        status: "Pending",
        createdAt: new Date(),
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
      };

      const csv = exportService.exportToCSV([taskWithSpecialChars]);

      expect(csv).toContain('"');
      expect(csv).toContain('""'); // Escaped quotes
    });

    it("should use project map for project names", () => {
      const projectMap = new Map<string, string>([["p1", "Project One"]]);

      const csv = exportService.exportToCSV(mockTasks, undefined, projectMap);

      expect(csv).toContain("Project One");
    });

    it("should include custom field values", () => {
      const taskWithCustomFields: Task = {
        id: "task-4",
        jobId: "TSK-1004",
        projectId: "p1",
        title: "Task with Custom Fields",
        subtitle: "",
        summary: "",
        assignee: "",
        priority: "medium",
        status: "Pending",
        createdAt: new Date(),
        subtasks: [],
        attachments: [],
        customFieldValues: {
          "custom-field-1": "Value 1",
          "custom-field-2": 42,
        },
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
      };

      const csv = exportService.exportToCSV(
        [taskWithCustomFields],
        ["title", "custom-field-1", "custom-field-2"],
      );

      expect(csv).toContain("Value 1");
      expect(csv).toContain("42");
    });

    it("should format subtasks correctly", () => {
      const taskWithSubtasks: Task = {
        id: "task-5",
        jobId: "TSK-1005",
        projectId: "p1",
        title: "Task with Subtasks",
        subtitle: "",
        summary: "",
        assignee: "",
        priority: "medium",
        status: "Pending",
        createdAt: new Date(),
        subtasks: [
          { id: "sub-1", title: "Subtask 1", completed: false },
          { id: "sub-2", title: "Subtask 2", completed: true },
        ],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
      };

      const csv = exportService.exportToCSV([taskWithSubtasks], ["title", "subtasks"]);

      expect(csv).toContain("[ ] Subtask 1");
      expect(csv).toContain("[x] Subtask 2");
    });
  });

  describe("exportToJSON", () => {
    it("should export data to JSON format", () => {
      const data = {
        tasks: [],
        projects: [],
      };

      const json = exportService.exportToJSON(data);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty("version");
      expect(parsed).toHaveProperty("exportedAt");
      expect(parsed).toHaveProperty("tasks");
      expect(parsed).toHaveProperty("projects");
    });

    it("should include exportedAt timestamp", () => {
      const data = { tasks: [] };
      const json = exportService.exportToJSON(data);
      const parsed = JSON.parse(json);

      expect(parsed.exportedAt).toBeDefined();
      expect(new Date(parsed.exportedAt)).toBeInstanceOf(Date);
    });
  });

  describe("exportToICS", () => {
    const makeTask = (overrides: Partial<Task> = {}): Task => ({
      id: "task-1",
      jobId: "TSK-1001",
      projectId: "p1",
      title: "Test Task",
      subtitle: "",
      summary: "",
      assignee: "",
      priority: "high",
      status: "Pending",
      createdAt: new Date("2024-01-01"),
      dueDate: new Date("2024-01-15T09:30:00Z"),
      subtasks: [],
      attachments: [],
      tags: [],
      timeEstimate: 0,
      timeSpent: 0,
      ...overrides,
    });

    let captured = "";
    let downloadSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      captured = "";
      downloadSpy = vi.spyOn(exportService, "downloadFile").mockImplementation((content) => {
        captured = content;
      });
    });
    afterEach(() => {
      downloadSpy.mockRestore();
    });

    it("should emit a valid VCALENDAR/VTODO structure", () => {
      exportService.exportToICS([makeTask()]);
      expect(captured).toContain("BEGIN:VCALENDAR");
      expect(captured).toContain("BEGIN:VTODO");
      expect(captured).toContain("UID:task-1@liquitask");
      expect(captured).toContain("DUE:20240115T093000Z");
      expect(captured).toContain("SUMMARY:Test Task");
      expect(captured).toContain("END:VTODO");
      expect(captured).toContain("END:VCALENDAR");
      // CRLF line endings per spec.
      expect(captured).toContain("\r\n");
    });

    it("should skip tasks without a due date", () => {
      exportService.exportToICS([makeTask({ dueDate: undefined })]);
      expect(captured).not.toContain("BEGIN:VTODO");
    });

    it("should map task priority to the iCal PRIORITY scale", () => {
      exportService.exportToICS([makeTask({ priority: "high" })]);
      expect(captured).toContain("PRIORITY:1");

      exportService.exportToICS([makeTask({ priority: "medium" })]);
      expect(captured).toContain("PRIORITY:5");

      exportService.exportToICS([makeTask({ priority: "low" })]);
      expect(captured).toContain("PRIORITY:9");
    });

    it("should omit PRIORITY for unknown priority values", () => {
      exportService.exportToICS([makeTask({ priority: "p2-custom" })]);
      expect(captured).not.toContain("PRIORITY:");
    });

    it("should export tags as CATEGORIES", () => {
      exportService.exportToICS([makeTask({ tags: ["urgent", "backend"] })]);
      expect(captured).toContain("CATEGORIES:urgent,backend");
    });

    it("should escape special characters in summary and categories", () => {
      exportService.exportToICS([makeTask({ title: "Fix; merge, conflict", tags: ["a,b"] })]);
      expect(captured).toContain("SUMMARY:Fix\\; merge\\, conflict");
      // A comma inside a tag is escaped so it is not read as a category separator.
      expect(captured).toContain("CATEGORIES:a\\,b");
    });

    it("should mark completed tasks with STATUS:COMPLETED", () => {
      exportService.exportToICS([makeTask({ status: "Completed" })]);
      expect(captured).toContain("STATUS:COMPLETED");
    });

    it("should fold lines longer than 75 octets", () => {
      const longSummary = "x".repeat(200);
      exportService.exportToICS([makeTask({ summary: longSummary })]);
      const lines = captured.split("\r\n");
      // Every emitted line must respect the 75-octet limit.
      expect(lines.every((line) => line.length <= 75)).toBe(true);
      // Continuation lines begin with a single space.
      expect(lines.some((line) => line.startsWith(" "))).toBe(true);
    });
  });

  describe("downloadFile", () => {
    it("should create and trigger download", () => {
      const createElementSpy = vi.spyOn(document, "createElement");
      const appendChildSpy = vi.spyOn(document.body, "appendChild");
      const removeChildSpy = vi.spyOn(document.body, "removeChild");

      exportService.downloadFile("test content", "test.txt", "text/plain");

      expect(createElementSpy).toHaveBeenCalledWith("a");
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
    });

    it("should create blob with correct content and type", () => {
      const blobSpy = vi.fn();
      global.Blob = blobSpy as unknown as typeof Blob;

      exportService.downloadFile("test content", "test.txt", "text/plain");

      expect(blobSpy).toHaveBeenCalledWith(["test content"], {
        type: "text/plain",
      });
    });
  });

  describe("downloadCSV", () => {
    it("should download CSV file", () => {
      const downloadFileSpy = vi.spyOn(exportService, "downloadFile");
      const tasks: Task[] = [
        {
          id: "task-1",
          jobId: "TSK-1001",
          projectId: "p1",
          title: "Test",
          subtitle: "",
          summary: "",
          assignee: "",
          priority: "medium",
          status: "Pending",
          createdAt: new Date(),
          subtasks: [],
          attachments: [],
          tags: [],
          timeEstimate: 0,
          timeSpent: 0,
        },
      ];

      exportService.downloadCSV(tasks, "test.csv");

      expect(downloadFileSpy).toHaveBeenCalledWith(
        expect.stringContaining("Title"),
        "test.csv",
        "text/csv;charset=utf-8;",
      );
    });

    it("should use default filename if not provided", () => {
      const downloadFileSpy = vi.spyOn(exportService, "downloadFile");
      const tasks: Task[] = [];

      exportService.downloadCSV(tasks);

      expect(downloadFileSpy).toHaveBeenCalledWith(
        expect.any(String),
        "tasks.csv",
        "text/csv;charset=utf-8;",
      );
    });
  });

  describe("downloadJSON", () => {
    it("should download JSON file", () => {
      const downloadFileSpy = vi.spyOn(exportService, "downloadFile");
      const data = { tasks: [] };

      exportService.downloadJSON(data, "test.json");

      expect(downloadFileSpy).toHaveBeenCalledWith(
        expect.stringContaining("version"),
        "test.json",
        "application/json",
      );
    });

    it("should use default filename if not provided", () => {
      const downloadFileSpy = vi.spyOn(exportService, "downloadFile");
      const data = { tasks: [] };

      exportService.downloadJSON(data);

      expect(downloadFileSpy).toHaveBeenCalledWith(
        expect.any(String),
        "liquitask-export.json",
        "application/json",
      );
    });
  });

  describe("getAvailableColumns", () => {
    it("should return default columns", () => {
      const columns = exportService.getAvailableColumns();

      expect(columns).toContain("id");
      expect(columns).toContain("title");
      expect(columns).toContain("status");
      expect(columns).toContain("priority");
    });

    it("should include custom field columns", () => {
      const customFields: CustomFieldDefinition[] = [
        { id: "custom-1", label: "Custom Field 1", type: "text" },
        { id: "custom-2", label: "Custom Field 2", type: "number" },
      ];

      const columns = exportService.getAvailableColumns(customFields);

      expect(columns).toContain("custom-1");
      expect(columns).toContain("custom-2");
    });
  });
});
