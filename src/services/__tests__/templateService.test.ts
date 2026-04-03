import { beforeEach, describe, expect, it } from "vitest";
import type { Task, TaskTemplate } from "../../types";
import { TemplateService } from "../templateService";

describe("TemplateService", () => {
  let service: TemplateService;

  const mockTask: Task = {
    id: "1",
    title: "Task with {{name}}",
    subtitle: "Subtitle",
    summary: "Summary for {{project}}",
    assignee: "Alice",
    priority: "Medium",
    status: "Todo",
    tags: ["tag1", "{{tag}}"],
    projectId: "p1",
    createdAt: new Date(),
    updatedAt: new Date(),
    subtasks: [{ id: "st1", title: "Subtask {{num}}", completed: false }],
  } as Task;

  beforeEach(() => {
    service = new TemplateService();
  });

  it("should save task as template", () => {
    const template = service.saveAsTemplate(mockTask, "My Template");
    expect(template.name).toBe("My Template");
    expect(template.variables).toContain("name");
    expect(template.variables).toContain("project");
    expect(template.variables).toContain("tag");
    expect(template.variables).toContain("num");
    expect(service.getAllTemplates()).toHaveLength(1);
  });

  it("should create task from template with variable replacement", () => {
    const template = service.saveAsTemplate(mockTask, "My Template");
    const variables = {
      name: "Alice",
      project: "LiquiTask",
      tag: "urgent",
      num: "1",
    };

    const newTask = service.createFromTemplate(template.id, variables);
    expect(newTask.title).toBe("Task with Alice");
    expect(newTask.summary).toBe("Summary for LiquiTask");
    expect(newTask.tags).toContain("urgent");
    expect(newTask.subtasks?.[0].title).toBe("Subtask 1");

    // Ensure IDs and dates are reset
    expect(newTask.id).toBeUndefined();
    expect(newTask.createdAt).toBeUndefined();
  });

  it("should load and get templates", () => {
    const templates: TaskTemplate[] = [
      {
        id: "t1",
        name: "T1",
        taskData: {},
        variables: [],
        tags: [],
        subtasks: [],
        customFieldValues: {},
      },
    ];
    service.loadTemplates(templates);
    expect(service.getAllTemplates()).toEqual(templates);
    expect(service.getTemplate("t1")).toEqual(templates[0]);
  });

  it("should delete template", () => {
    service.saveAsTemplate(mockTask, "T1");
    const templates = service.getAllTemplates();
    service.deleteTemplate(templates[0].id);
    expect(service.getAllTemplates()).toHaveLength(0);
  });

  it("should update template", () => {
    const template = service.saveAsTemplate(mockTask, "T1");
    service.updateTemplate(template.id, { name: "Updated" });
    expect(service.getTemplate(template.id)?.name).toBe("Updated");
  });

  it("should throw error when template not found", () => {
    expect(() => service.createFromTemplate("non-existent")).toThrow(
      "Template non-existent not found",
    );
  });

  it("should handle missing variables during replacement", () => {
    const template = service.saveAsTemplate(mockTask, "My Template");
    const newTask = service.createFromTemplate(template.id, {}); // No variables provided
    expect(newTask.title).toBe("Task with {{name}}"); // Should keep placeholder if no value
  });
});
