import { Task, Project } from '../../types';

/**
 * Converts a task to a JSON string formatted for LLM consumption
 * Includes all task details in a clean, readable format
 */
export function taskToJson(task: Task, projectName?: string): string {
  const taskData = {
    // Basic Information
    id: task.id,
    jobId: task.jobId,
    title: task.title,
    subtitle: task.subtitle || undefined,
    summary: task.summary || undefined,
    
    // Project & Status
    projectId: task.projectId,
    project: projectName || task.projectId,
    status: task.status,
    priority: task.priority,
    
    // Assignment
    assignee: task.assignee || undefined,
    
    // Dates
    createdAt: task.createdAt ? task.createdAt.toISOString() : undefined,
    updatedAt: task.updatedAt ? task.updatedAt.toISOString() : undefined,
    dueDate: task.dueDate ? task.dueDate.toISOString() : undefined,
    completedAt: task.completedAt ? task.completedAt.toISOString() : undefined,
    
    // Time Tracking (include both formatted and raw values)
    timeEstimate: task.timeEstimate > 0 ? `${Math.round(task.timeEstimate / 60 * 10) / 10} hours` : undefined,
    timeEstimateMinutes: task.timeEstimate > 0 ? task.timeEstimate : undefined,
    timeSpent: task.timeSpent > 0 ? `${Math.round(task.timeSpent / 60 * 10) / 10} hours` : undefined,
    timeSpentMinutes: task.timeSpent > 0 ? task.timeSpent : undefined,
    
    // Subtasks (include all fields)
    subtasks: task.subtasks && task.subtasks.length > 0 ? task.subtasks.map(st => ({
      id: st.id,
      title: st.title,
      completed: st.completed
    })) : undefined,
    
    // Attachments (include all fields)
    attachments: task.attachments && task.attachments.length > 0 ? task.attachments.map(att => ({
      id: att.id,
      name: att.name,
      url: att.url,
      type: att.type
    })) : undefined,
    
    // Task Links (include all fields)
    links: task.links && task.links.length > 0 ? task.links.map(link => ({
      type: link.type,
      targetTaskId: link.targetTaskId
    })) : undefined,
    
    // Custom Fields
    customFieldValues: task.customFieldValues && Object.keys(task.customFieldValues).length > 0 
      ? task.customFieldValues 
      : undefined,
    
    // Tags
    tags: task.tags && task.tags.length > 0 ? task.tags : undefined,
    
    // Recurring (include all fields)
    recurring: task.recurring ? {
      enabled: task.recurring.enabled,
      frequency: task.recurring.frequency,
      interval: task.recurring.interval,
      daysOfWeek: task.recurring.daysOfWeek,
      dayOfMonth: task.recurring.dayOfMonth,
      endDate: task.recurring.endDate ? task.recurring.endDate.toISOString() : undefined,
      nextOccurrence: task.recurring.nextOccurrence ? task.recurring.nextOccurrence.toISOString() : undefined
    } : undefined,
    
    // Error Logs (include all fields)
    errorLogs: task.errorLogs && task.errorLogs.length > 0 ? task.errorLogs.map(log => ({
      timestamp: log.timestamp.toISOString(),
      message: log.message
    })) : undefined
  };
  
  // Remove undefined fields for cleaner JSON
  const cleanData = Object.fromEntries(
    Object.entries(taskData).filter(([_, value]) => value !== undefined)
  );
  
  return JSON.stringify(cleanData, null, 2);
}

