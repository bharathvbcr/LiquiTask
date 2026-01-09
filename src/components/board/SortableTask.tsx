import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from '../../../components/TaskCard';
import { Task, PriorityDefinition, Project } from '../../../types';

interface SortableTaskProps {
    task: Task;
    priorities: PriorityDefinition[];
    isCompletedColumn?: boolean;
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string) => void;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    allTasks: Task[];
    isCompact?: boolean;
    onCopyTask?: (message: string) => void;
    projectName?: string;
    projects?: Project[];
    onMoveToWorkspace?: (taskId: string, projectId: string) => void;
}

export const SortableTask: React.FC<SortableTaskProps> = ({ task, onCopyTask, projectName, projects, onMoveToWorkspace, ...props }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: task.id,
        data: {
            type: 'Task',
            task,
        },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <TaskCard task={task} {...props} onCopyTask={onCopyTask} projectName={projectName} projects={projects} onMoveToWorkspace={onMoveToWorkspace} />
        </div>
    );
};
