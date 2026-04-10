import { beforeEach, describe, expect, it } from "vitest";
import type { Task, TaskTemplate } from "../../types";
import { TemplateService } from "../templateService";

describe("TemplateService", () => {
  let service: TemplateService;

  // Use a factory function to get fresh mocks for each test
  const getMockTemplates = (): TaskTemplate[] => [
    {
      id: "t1",
      name: "Template 1",
      description: "Desc",
      taskData: { title: "Task with {{name}}" },
      subtasks: [],
      tags: ["tag1"],
      customFieldValues: {},
      variables: ["name"],
    },
  ];

  beforeEach(() => {
    service = new TemplateService();
    service.loadTemplates(getMockTemplates());
  });

  it("should get all templates", () => {
    expect(service.getAllTemplates()).toHaveLength(1);
  });

  it("should get template by id", () => {
    expect(service.getTemplate("t1")).toBeDefined();
    expect(service.getTemplate("t1")?.id).toBe("t1");
    expect(service.getTemplate("missing")).toBeUndefined();
  });

  it("should create task from template with variables", () => {
    const variables = { name: "World" };
    const task = service.createFromTemplate("t1", variables);
    expect((task as any).title).toBe("Task with World");
    expect(task.id).toBeUndefined();
  });

  it("should save task as template", () => {
    const task: Task = {
      id: "1",
      title: "New Task {{foo}}",
      summary: "Summary",
      projectId: "p1",
      priority: "high",
      status: "Todo",
      createdAt: new Date(),
      subtasks: [],
      attachments: [],
      tags: [],
      timeEstimate: 0,
      timeSpent: 0,
    } as any;

    const template = service.saveAsTemplate(task, "Saved Template");
    expect(template.name).toBe("Saved Template");
    expect(template.variables).toContain("foo");
    expect(service.getAllTemplates()).toHaveLength(2);
  });

  it("should delete template", () => {
    const allBefore = service.getAllTemplates();
    expect(allBefore).toHaveLength(1);
    expect(allBefore[0].id).toBe("t1");

    service.deleteTemplate("t1");

    const allAfter = service.getAllTemplates();
    expect(allAfter).toHaveLength(0);
  });

  it("should update template", () => {
    service.updateTemplate("t1", { name: "Updated Name" });
    expect(service.getTemplate("t1")?.name).toBe("Updated Name");
  });

  it("should suggest templates from history", () => {
    const tasks: Task[] = [
      {
        id: "1",
        title: "Repetitive Task",
        completedAt: new Date(),
        subtasks: [],
        tags: [],
      } as any,
      {
        id: "2",
        title: "Repetitive Task",
        completedAt: new Date(),
        subtasks: [],
        tags: [],
      } as any,
    ];
    const suggestions = service.suggestTemplatesFromHistory(tasks);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].name).toContain("Repetitive Task");
  });
});
