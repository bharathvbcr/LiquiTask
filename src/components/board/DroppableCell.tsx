import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface DroppableCellProps {
    id: string;
    children: React.ReactNode;
    className?: string;
}

/**
 * A droppable cell component that properly integrates with dnd-kit.
 * Used in priority grouping view to create valid drop zones.
 */
export const DroppableCell: React.FC<DroppableCellProps> = ({ id, children, className = '' }) => {
    const { setNodeRef, isOver } = useDroppable({
        id,
        data: {
            type: 'DropZone',
            dropZoneId: id,
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={`${className} transition-colors duration-200 ${isOver ? 'border-blue-500/50 bg-blue-500/5' : ''}`}
        >
            {children}
        </div>
    );
};
