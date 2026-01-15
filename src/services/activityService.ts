import { Task, ActivityItem, ActivityType } from '../../types';

export const activityService = {
    createActivity(
        type: ActivityType,
        details: string,
        field?: string,
        oldValue?: unknown,
        newValue?: unknown
    ): ActivityItem {
        return {
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type,
            timestamp: new Date(),
            userId: 'current-user', // Mock user for now
            details,
            field,
            oldValue,
            newValue
        };
    },

    logChange(task: Task, changes: Partial<Task>, activityType: ActivityType = 'update'): Task {
        const activities: ActivityItem[] = [];

        // Compare fields
        if (changes.status && changes.status !== task.status) {
            activities.push(this.createActivity('move', `Moved to ${changes.status}`, 'status', task.status, changes.status));
        }
        if (changes.priority && changes.priority !== task.priority) {
            activities.push(this.createActivity('update', `Changed priority to ${changes.priority}`, 'priority', task.priority, changes.priority));
        }
        if (changes.assignee && changes.assignee !== task.assignee) {
            activities.push(this.createActivity('update', `Assigned to ${changes.assignee || 'Unassigned'}`, 'assignee', task.assignee, changes.assignee));
        }
        if (changes.dueDate) {
            const oldDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No date';
            const newDate = changes.dueDate ? new Date(changes.dueDate).toLocaleDateString() : 'No date';
            if (oldDate !== newDate) {
                activities.push(this.createActivity('update', `Due date changed to ${newDate}`, 'dueDate', task.dueDate, changes.dueDate));
            }
        }
        // ... add more field comparisons as needed

        if (activities.length === 0 && activityType === 'create') {
            activities.push(this.createActivity('create', 'Task created'));
        }

        return {
            ...task,
            ...changes,
            activity: [...(task.activity || []), ...activities]
        };
    }
};
