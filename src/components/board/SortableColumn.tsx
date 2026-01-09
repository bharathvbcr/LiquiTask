import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { BoardColumn, Task, PriorityDefinition } from '../../../types';
import { SortableTask } from './SortableTask';
import { AlertOctagon } from 'lucide-react';

interface SortableColumnProps {
    column: BoardColumn;
    tasks: Task[];
    priorities: PriorityDefinition[];
    allTasks: Task[];
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string) => void;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    isCompact?: boolean;
    onCopyTask?: (message: string) => void;
    projectName?: string;
}

export const SortableColumn: React.FC<SortableColumnProps> = ({
    column,
    tasks,
    priorities,
    allTasks,
    onMoveTask,
    onEditTask,
    onUpdateTask,
    onDeleteTask,
    isCompact,
    onCopyTask,
    projectName,
}) => {

    const {
        attributes,
        listeners,
        setNodeRef: setSortableRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: column.id,
        data: {
            type: 'Column',
            column,
        },
    });

    // Make column body a drop target for tasks
    // Use different ID prefix to avoid collision with useSortable (which also uses column.id)
    const { setNodeRef: setDroppableRef, isOver } = useDroppable({
        id: `drop-${column.id}`,
        data: {
            type: 'Column',
            column,
        },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const wipLimit = column.wipLimit || 0;
    const isOverLimit = wipLimit > 0 && tasks.length > wipLimit;
    const accentColor = column.color.startsWith('#') ? column.color : '#64748b';

    return (
        <div
            ref={setSortableRef}
            style={style}
            className="flex-1 flex flex-col min-w-[300px]"
        >
            {/* Header */}
            <div
                {...attributes}
                {...listeners}
                className="flex items-center justify-between mb-4 px-4 cursor-grab active:cursor-grabbing group/colheader"
            >
                <div className="flex items-center gap-3">
                    <h3 className={`font-bold text-sm tracking-wide uppercase text-shadow-sm transition-colors ${isOverLimit ? 'text-red-400' : 'text-slate-200'}`}>
                        {column.title}
                    </h3>
                    <span className={`text-xs px-2 py-0.5 rounded border ${isOverLimit ? 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse' : 'bg-white/5 text-slate-400 border-white/5'}`}>
                        {tasks.length} {wipLimit > 0 && `/ ${wipLimit}`}
                    </span>
                    {isOverLimit && <AlertOctagon size={16} className="text-red-500 animate-pulse" />}
                </div>
                <div className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: isOverLimit ? '#ef4444' : accentColor, color: isOverLimit ? '#ef4444' : accentColor }}></div>
            </div>

            {/* Task List Area */}
            <div
                className={`flex-1 rounded-3xl p-3 flex flex-col gap-4 transition-all duration-500 
          ${isOverLimit ? 'bg-red-900/10 border-red-500/20' : 'bg-transparent border border-transparent'}
        `}
            >
                <div
                    ref={setDroppableRef}
                    className={`h-full rounded-2xl bg-[#0a0a0a]/50 backdrop-blur-md border p-4 flex flex-col gap-4 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] min-h-[300px] transition-colors duration-200 ${isOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/10'}`}
                >
                    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        {tasks.map(task => (
                            <SortableTask
                                key={task.id}
                                task={task}
                                priorities={priorities}
                                isCompletedColumn={column.isCompleted}
                                onMoveTask={onMoveTask}
                                onEditTask={onEditTask}
                                onUpdateTask={onUpdateTask}
                                onDeleteTask={onDeleteTask}
                                allTasks={allTasks}
                                isCompact={isCompact}
                                onCopyTask={onCopyTask}
                                projectName={projectName}
                            />
                        ))}
                    </SortableContext>
                </div>
            </div>
        </div>
    );
};
