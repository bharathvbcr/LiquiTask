import type { AIContext, PriorityDefinition, Project, Task, TaskTemplate } from "../../types";
import { STORAGE_KEYS } from "../constants";
import storageService from "./storageService";

export class TemplateService {
  private templates: TaskTemplate[] = [];

  /**
   * Load templates from storage
   */
  loadTemplates(templates: TaskTemplate[]): void {
    this.templates = templates;
  }

  /**
   * Get all templates
   */
  getAllTemplates(): TaskTemplate[] {
    return [...this.templates];
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId: string): TaskTemplate | undefined {
    return this.templates.find((t) => t.id === templateId);
  }

  /**
   * Create task from template
   */
  createFromTemplate(templateId: string, variables?: Record<string, string>): Partial<Task> {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    // Replace variables in task data
    const taskData = this.replaceVariables(template.taskData, variables || {});

    return {
      ...(taskData && typeof taskData === "object" ? taskData : {}),
      // Reset instance-specific fields
      id: undefined, // Will be generated on creation
      createdAt: undefined,
      updatedAt: undefined,
      completedAt: undefined,
    };
  }

  /**
   * Save task as template
   */
  saveAsTemplate(task: Task, name: string, description?: string): TaskTemplate {
    const template: TaskTemplate = {
      id: `template-${Date.now()}`,
      name,
      description: description || `Template created from task "${task.title}"`,
      taskData: {
        title: task.title,
        subtitle: task.subtitle,
        summary: task.summary,
        assignee: task.assignee,
        priority: task.priority,
        status: task.status,
        tags: task.tags,
        timeEstimate: task.timeEstimate,
        subtasks: task.subtasks,
        customFieldValues: task.customFieldValues,
      },
      subtasks: task.subtasks || [],
      tags: task.tags || [],
      customFieldValues: task.customFieldValues || {},
      variables: this.extractVariables(task),
    };

    this.templates.push(template);
    return template;
  }

  /**
   * Delete template
   */
  deleteTemplate(templateId: string): void {
    this.templates = this.templates.filter((t) => t.id !== templateId);
  }

  /**
   * Update template
   */
  updateTemplate(templateId: string, updates: Partial<TaskTemplate>): void {
    const index = this.templates.findIndex((t) => t.id === templateId);
    if (index !== -1) {
      this.templates[index] = { ...this.templates[index], ...updates };
    }
  }

  /**
   * Replace variables in template data
   */
  private replaceVariables(data: unknown, variables: Record<string, string>): unknown {
    if (typeof data === "string") {
      // Replace {{variable}} patterns
      return data.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variables[varName] || match;
      });
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.replaceVariables(item, variables));
    }

    if (typeof data === "object" && data !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = {};
      for (const key in data) {
        result[key] = this.replaceVariables(data[key], variables);
      }
      return result;
    }

    return data;
  }

  /**
   * Extract variable names from task data
   */
  private extractVariables(task: Task): string[] {
    const variables: string[] = [];
    const text = JSON.stringify(task);
    const matches = text.match(/\{\{(\w+)\}\}/g);
    if (matches) {
      matches.forEach((match) => {
        const varName = match.replace(/\{\{|\}\}/g, "");
        if (!variables.includes(varName)) {
          variables.push(varName);
        }
      });
    }
    return variables;
  }

  async generateTemplateFromDescription(description: string): Promise<TaskTemplate> {
    const { aiService } = await import("./aiService");
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    const context: AIContext = { activeProjectId, projects, priorities };
    try {
      const result = await aiService.generateTemplate(description, context);
      const template: TaskTemplate = {
        id: `template-ai-${Date.now()}`,
        name: result.name,
        description: `AI-generated template from: "${description.substring(0, 80)}..."`,
        taskData: {
          title: result.taskData.title || "Untitled Template",
          summary: result.taskData.summary || "",
          priority: result.taskData.priority || "medium",
          status: result.taskData.status || "Pending",
          timeEstimate: result.taskData.timeEstimate || 0,
        },
        subtasks: result.subtasks.map((title, i) => ({
          id: `ai-st-${Date.now()}-${i}`,
          title,
          completed: false,
        })),
        tags: result.tags,
        customFieldValues: {},
        variables: result.variables,
      };
      this.templates.push(template);
      return template;
    } catch (e) {
      console.error("AI template generation failed:", e);
      throw new Error("Failed to generate template with AI. Please try again.");
    }
  }

  suggestTemplatesFromHistory(allTasks: Task[]): TaskTemplate[] {
    const completedTasks = allTasks.filter((t) => t.completedAt);
    const suggestions: TaskTemplate[] = [];
    const processedTitles = new Set<string>();
    for (const task of completedTasks) {
      const normalizedTitle = task.title.toLowerCase().trim();
      if (processedTitles.has(normalizedTitle)) continue;
      const similarTasks = completedTasks.filter(
        (t) => t.title.toLowerCase().trim() === normalizedTitle && t.id !== task.id,
      );
      if (similarTasks.length >= 1 || task.subtasks.length >= 2) {
        processedTitles.add(normalizedTitle);
        const template: TaskTemplate = {
          id: `template-suggest-${Date.now()}-${suggestions.length}`,
          name: `${task.title} (Suggested)`,
          description: `AI-suggested template based on ${similarTasks.length + 1} similar completed tasks`,
          taskData: {
            title: task.title,
            summary: task.summary,
            priority: task.priority,
            status: "Pending",
            tags: task.tags,
            timeEstimate: task.timeEstimate,
          },
          subtasks: task.subtasks,
          tags: task.tags,
          customFieldValues: task.customFieldValues || {},
          variables: this.extractVariables(task),
        };
        suggestions.push(template);
      }
    }
    return suggestions;
  }
}

// Singleton instance
export const templateService = new TemplateService();
