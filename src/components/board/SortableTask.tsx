import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskCard } from '../../../components/TaskCard';
import { Task, PriorityDefinition, Project } from '../../../types';

interface SortableTaskProps {
    task: Task;
    priorities: PriorityDefinition[];
    isCompletedColumn?: boolean;
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    allTasks: Task[];
    isCompact?: boolean;
    onCopyTask?: (message: string) => void;
    projectName?: string;
    projects?: Project[];
    onMoveToWorkspace?: (taskId: string, projectId: string) => void;
    isFocused?: boolean;
}

export const SortableTask: React.FC<SortableTaskProps> = ({
    task,
    onCopyTask,
    projectName,
    projects,
    onMoveToWorkspace,
    isFocused = false,
    ...props
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: task.id,
        data: { type: 'task', task },
    });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            data-task-id={task.id}
            className={isFocused ? 'ring-2 ring-red-500/70 rounded-lg' : ''}
        >
            <TaskCard
                task={task}
                {...props}
                onCopyTask={onCopyTask}
                projectName={projectName}
                projects={projects}
                onMoveToWorkspace={onMoveToWorkspace}
                isFocused={isFocused}
            />
        </div>
    );
};
