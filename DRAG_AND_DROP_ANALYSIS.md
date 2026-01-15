# Comprehensive Drag-and-Drop Analysis & Improvement Plan

## Phase 1: Code Analysis and Diagnostic Assessment

Based on the codebase review, here are the **five most probable technical issues** causing drag-and-drop failures or erratic behavior:

### Issue 1: **State Synchronization Race Condition** (State Management)
**Root Cause:** The `onDragEnd` handler in `ProjectBoard.tsx` relies on `activeTask` and `activeColumn` state that may become stale if the drag operation is interrupted or if React batches updates incorrectly. The state is set in `onDragStart`, but if the component re-renders between drag start and end, the closure may capture outdated values.

**Evidence:**
- `ProjectBoard.tsx:102-120`: `onDragStart` sets `activeTask`/`activeColumn` via `useState`
- `ProjectBoard.tsx:129-188`: `onDragEnd` reads from these state variables, which may be stale
- No use of refs or event data to ensure fresh values

**Impact:** Tasks may fail to move, or move to incorrect columns when rapid drags occur or during concurrent state updates.

---

### Issue 2: **Incomplete Drop Target Resolution** (Event Handling)
**Root Cause:** The drop target resolution logic in `onDragEnd` has multiple code paths that can fail silently:
- Line 162-164: Checks for column match with `drop-` prefix, but doesn't handle edge cases where `over.id` might be a task ID that happens to match a column ID pattern
- Line 169-172: Falls back to finding task by ID, but doesn't verify the task exists in a valid column
- Priority grouping view (line 254-265) has similar ambiguity issues

**Evidence:**
- `ProjectBoard.tsx:158-173`: Complex conditional logic with potential for `newStatus` to remain empty
- No validation that resolved `newStatus` actually exists in `columns` array
- Missing null checks for `overTask.status`

**Impact:** Drops may be ignored, tasks may disappear, or move to invalid states.

---

### Issue 3: **Missing Reordering Support Within Columns** (State Management)
**Root Cause:** The code explicitly acknowledges (line 179-182) that manual reordering within the same column is not supported. The `SortableContext` is configured for vertical sorting, but `onDragEnd` only handles cross-column moves. When a task is dropped on another task in the same column, it resolves to the same status and the move is skipped (line 175).

**Evidence:**
- `ProjectBoard.tsx:179-182`: Comment explicitly states reordering is not implemented
- `ProjectBoard.tsx:175`: Early return if `newStatus === activeTask.status`
- Tasks lack an `order` field in the `Task` type definition

**Impact:** Users cannot reorder tasks within columns, reducing UX flexibility.

---

### Issue 4: **Sensor Activation Conflicts with Interactive Elements** (Event Handling)
**Root Cause:** The `PointerSensor` has an 8px activation distance, and `TouchSensor` has a 200ms delay. However, task cards contain interactive elements (buttons, inputs, context menus) that may conflict with drag initiation. The drag listeners are applied to the entire `SortableTask` wrapper, which can interfere with nested interactions.

**Evidence:**
- `ProjectBoard.tsx:84-88`: Sensors configured with activation constraints
- `SortableTask.tsx:46`: `{...listeners}` spread on the wrapper div, capturing all pointer events
- `TaskCard.tsx`: Contains buttons, inputs, and context menu handlers that may conflict

**Impact:** Users may struggle to initiate drags, or drags may start accidentally when trying to interact with task content.

---

### Issue 5: **Priority Grouping View Composite ID Collision Risk** (Event Handling)
**Root Cause:** The priority grouping view uses composite IDs (`${priorityId}::${statusId}`) for drop zones. The parsing logic (line 211-217) assumes a strict format, but if a task ID or column ID accidentally contains `::`, it could be misparsed. Additionally, the `SortableContext` uses the same composite ID (line 316), which could cause conflicts with the droppable ID.

**Evidence:**
- `ProjectBoard.tsx:207-217`: Composite ID creation and parsing
- `ProjectBoard.tsx:316`: `SortableContext` uses `id={dropZoneId}` which matches droppable ID
- No validation that task/column IDs don't contain `::` separator

**Impact:** Drops in priority view may resolve incorrectly, tasks may move to wrong priority/status combinations.

---

## Phase 2: Comprehensive Issue Catalog

### Cross-Browser/Device Compatibility

1. **Touch Event Handling**
   - Current: 200ms delay with 5px tolerance may feel sluggish on mobile
   - Issue: Users may accidentally scroll instead of dragging
   - Missing: No handling for `touchcancel` events that could leave drag state inconsistent

2. **Pointer Events vs Mouse Events**
   - Current: Uses `PointerSensor` which should handle both
   - Issue: Some older browsers may not support Pointer Events API
   - Missing: Fallback to mouse events for legacy browsers

3. **Safari-Specific Issues**
   - Known: Safari has quirks with `draggable` attribute and touch events
   - Missing: Safari-specific workarounds or detection

4. **High-DPI/Retina Displays**
   - Issue: 8px activation distance may be too small on high-DPI screens
   - Missing: Device pixel ratio consideration

### Performance Issues

5. **Excessive Re-renders During Drag**
   - Current: `onDragOver` is empty but still called frequently
   - Issue: Each drag move may trigger React re-renders of entire board
   - Missing: `useMemo`/`useCallback` optimization for drag handlers

6. **Large Task Lists**
   - Current: All tasks rendered in DOM, even when not visible
   - Issue: Dragging with 100+ tasks per column causes jank
   - Missing: Virtual scrolling or lazy rendering

7. **Measuring Strategy**
   - Current: `MeasuringStrategy.Always` (line 278, 380)
   - Issue: Recalculates positions on every drag move, expensive for large boards
   - Missing: Consider `MeasuringStrategy.WhileDragging` for better performance

8. **Animation Performance**
   - Current: CSS transitions on transform/opacity
   - Issue: May not use GPU acceleration on all browsers
   - Missing: `will-change` CSS property or `transform3d` hints

### User Experience Issues

9. **Accidental Drops**
   - Current: No visual feedback during drag about valid drop zones
   - Issue: Users may drop tasks in invalid locations
   - Missing: Clear visual indicators (highlighted drop zones, invalid zone styling)

10. **Scroll While Dragging**
    - Current: No handling for container scrolling during drag
    - Issue: Dragging near edges doesn't auto-scroll
    - Missing: Auto-scroll implementation when dragging near viewport edges

11. **Drag Preview Customization**
    - Current: Uses default drag image or `DragOverlay`
    - Issue: Drag preview may be too large or obscure drop targets
    - Missing: Custom drag preview sizing/positioning

12. **Keyboard Accessibility**
    - Current: `KeyboardSensor` configured but may not work with all interactive elements
    - Issue: Keyboard users may not be able to move tasks efficiently
    - Missing: ARIA labels, focus management, and keyboard shortcut documentation

13. **Drag Cancellation**
    - Current: No explicit cancel handling (ESC key, click outside)
    - Issue: Users cannot cancel an accidental drag start
   - Missing: `onDragCancel` handler and ESC key support

### State Management Issues

14. **Optimistic Updates Missing**
    - Current: State only updates in `onDragEnd`
    - Issue: No immediate visual feedback during drag
    - Missing: Optimistic UI updates with rollback on failure

15. **Concurrent Drag Prevention**
    - Current: No check to prevent multiple simultaneous drags
    - Issue: Rapid drags could cause state corruption
    - Missing: Drag state lock/mutex

16. **Undo/Redo Integration**
    - Current: `moveTask` pushes to undo stack, but drag operations may not
    - Issue: Drag-and-drop moves may not be undoable if state updates are batched incorrectly
    - Missing: Guaranteed undo stack updates for all drag operations

17. **Task Order Persistence**
    - Current: Tasks have no `order` field
    - Issue: Task order is not preserved across refreshes or when filtered
    - Missing: Order field in Task type and persistence logic

18. **WIP Limit Enforcement**
    - Current: WIP limits are displayed but not enforced during drag
    - Issue: Users can drag tasks into columns that exceed WIP limits
    - Missing: Validation in `onDragEnd` to prevent exceeding limits

### Edge Cases and Error Scenarios

19. **Missing Column Validation**
    - Current: `newStatus` is not validated against existing columns
    - Issue: If a column is deleted mid-drag, task could be assigned invalid status
    - Missing: Validation that `newStatus` exists in `columns` array

20. **Task Deletion During Drag**
    - Current: No handling if task is deleted while being dragged
    - Issue: `onDragEnd` may try to update a non-existent task
    - Missing: Existence check before state update

21. **Column Reordering During Task Drag**
    - Current: Columns can be reordered independently
    - Issue: If column order changes during task drag, drop target resolution may fail
    - Missing: Lock column reordering during active task drag

22. **Rapid Successive Drags**
    - Current: No debouncing or throttling
    - Issue: Rapid drag-drop operations may cause race conditions
    - Missing: Request deduplication or operation queue

23. **Network/Storage Failures**
    - Current: No error handling for storage service failures
    - Issue: If `debouncedSaveTasks` fails, state may be inconsistent
    - Missing: Error boundaries and retry logic for persistence

24. **Empty Drop Zones**
    - Current: Empty drop zones show "Drop here" but may not be properly registered
    - Issue: Dropping on empty zones in priority view may fail
    - Missing: Explicit empty state handling in drop resolution

---

## Phase 3: Reliability and Architectural Improvement Strategy

### 3.1 Global Drag State Management

**Current Problem:** Drag state (`activeTask`, `activeColumn`) is local to `ProjectBoard` component, making it vulnerable to closure stale values and difficult to coordinate with other parts of the app.

**Proposed Solution:** Create a dedicated drag context or use a ref-based approach:

```typescript
// Option A: Context-based (Recommended for complex apps)
interface DragContextValue {
  activeDrag: {
    type: 'task' | 'column' | null;
    id: string | null;
    data: Task | BoardColumn | null;
  } | null;
  setActiveDrag: (drag: DragContextValue['activeDrag']) => void;
  clearDrag: () => void;
}

// Option B: Ref-based (Simpler, for current architecture)
const activeDragRef = useRef<{
  type: 'task' | 'column';
  id: string;
  data: Task | BoardColumn;
} | null>(null);
```

**Benefits:**
- Eliminates stale closure issues
- Enables drag state inspection from anywhere
- Simplifies debugging and logging
- Allows coordination with other features (e.g., preventing column deletion during drag)

**Implementation:**
- Replace `useState` for `activeTask`/`activeColumn` with refs or context
- Read from ref/context in `onDragEnd` instead of state
- Consider using `useSyncExternalStore` if drag state needs to trigger re-renders

---

### 3.2 Event Handling Optimizations

**A. RequestAnimationFrame for Smooth Updates**

```typescript
const rafRef = useRef<number | null>(null);

function onDragOver(event: DragOverEvent) {
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current);
  }
  
  rafRef.current = requestAnimationFrame(() => {
    // Update visual feedback (e.g., highlight drop zones)
    // This ensures smooth 60fps updates
  });
}
```

**B. Debounced Drop Zone Highlighting**

```typescript
const highlightDropZone = useMemo(
  () => debounce((zoneId: string | null) => {
    setHighlightedZone(zoneId);
  }, 50), // 50ms debounce for visual updates
  []
);
```

**C. Sensor Configuration Refinement**

```typescript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
    // Prevent drag when clicking interactive elements
    activationConstraint: {
      delay: 0,
      tolerance: 8,
      // Add check to ignore clicks on buttons/inputs
    },
  }),
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150, // Reduced from 200ms for better responsiveness
      tolerance: 8, // Increased from 5px
    },
  }),
  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  })
);
```

**D. Interactive Element Handling**

```typescript
// In SortableTask, conditionally apply listeners
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: task.id,
  data: { type: 'Task', task },
});

// Create filtered listeners that ignore clicks on interactive elements
const dragListeners = useMemo(() => {
  return {
    ...listeners,
    onPointerDown: (e: React.PointerEvent) => {
      // Don't start drag if clicking on button, input, or link
      const target = e.target as HTMLElement;
      if (target.closest('button, input, a, [role="button"]')) {
        return;
      }
      listeners.onPointerDown?.(e);
    },
  };
}, [listeners]);
```

---

### 3.3 Architectural Decisions

**Decision 1: Library vs Custom Solution**

**Recommendation: Continue using @dnd-kit** (Current choice is correct)

**Rationale:**
- ✅ Modern, actively maintained, TypeScript-first
- ✅ Excellent accessibility support
- ✅ Flexible sensor system
- ✅ Good performance with large lists
- ✅ Well-documented and has active community

**Alternative Considered:** React DnD (older, more complex) or native HTML5 DnD (limited functionality)

**Action Items:**
- Keep @dnd-kit but address the identified issues
- Consider upgrading to latest version if not already
- Add custom error boundaries around DndContext

---

**Decision 2: State Update Strategy**

**Current:** Optimistic updates only in `onDragEnd`

**Proposed:** Hybrid approach with optimistic UI + confirmed persistence

```typescript
function onDragEnd(event: DragEndEvent) {
  // 1. Immediately update UI optimistically
  const optimisticUpdate = calculateNewState(event);
  setTasks(optimisticUpdate); // Immediate visual feedback
  
  // 2. Validate the move
  const validation = validateMove(event, optimisticUpdate);
  if (!validation.valid) {
    // Rollback optimistic update
    setTasks(previousTasks);
    addToast(validation.error, 'error');
    return;
  }
  
  // 3. Persist to storage (async, with error handling)
  persistMove(event)
    .then(() => {
      addToast('Task moved', 'success');
    })
    .catch((error) => {
      // Rollback on persistence failure
      setTasks(previousTasks);
      addToast('Failed to save. Changes reverted.', 'error');
    });
}
```

---

**Decision 3: Task Ordering System**

**Proposed:** Add `order` field to Task type and implement reordering

```typescript
interface Task {
  // ... existing fields
  order: number; // Position within column (0-based or timestamp-based)
}

// In onDragEnd, when dropped in same column:
if (newStatus === activeTask.status && overTask) {
  const tasksInColumn = tasks.filter(t => t.status === newStatus);
  const overIndex = tasksInColumn.findIndex(t => t.id === overTask.id);
  const newOrder = calculateOrder(tasksInColumn, overIndex, activeTask.id);
  
  onMoveTask(activeTask.id, newStatus, undefined, newOrder);
}
```

**Migration Strategy:**
- Add `order` field with default values based on creation time
- Gradually migrate existing tasks
- Maintain backward compatibility during transition

---

**Decision 4: Error Recovery and Resilience**

**Proposed:** Add comprehensive error handling and recovery

```typescript
// Error boundary for drag operations
class DragErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    // Log to error tracking service
    // Attempt to recover drag state
    this.props.onDragError?.(error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <DragErrorFallback onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}

// Wrap DndContext
<DragErrorBoundary onDragError={handleDragError}>
  <DndContext ...>
    ...
  </DndContext>
</DragErrorBoundary>
```

---

## Phase 4: Implementation Outline

### 4.1 Core Fix: Reliable Drop Target Resolution

**Pseudocode for Improved `onDragEnd`:**

```typescript
function onDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  
  // Use ref instead of state to avoid stale closures
  const dragData = activeDragRef.current;
  if (!dragData || !over) {
    clearDragState();
    return;
  }
  
  const overId = String(over.id);
  
  // Validate drop target exists
  if (!isValidDropTarget(overId)) {
    clearDragState();
    addToast('Invalid drop target', 'error');
    return;
  }
  
  if (dragData.type === 'column') {
    handleColumnReorder(active.id, overId);
  } else if (dragData.type === 'task') {
    handleTaskMove(dragData.data as Task, overId, over);
  }
  
  clearDragState();
}

function handleTaskMove(task: Task, overId: string, over: Over) {
  let newStatus = '';
  let newPriority: string | undefined = undefined;
  let newOrder: number | undefined = undefined;
  
  if (boardGrouping === 'priority') {
    // Priority grouping logic
    const dropZone = parseDropZoneId(overId);
    if (dropZone) {
      newStatus = dropZone.statusId;
      newPriority = dropZone.priorityId;
    } else {
      // Dropped on task - get its location
      const targetTask = findTask(overId);
      if (targetTask) {
        newStatus = targetTask.status;
        newPriority = targetTask.priority;
        newOrder = calculateOrderForTask(targetTask);
      }
    }
  } else {
    // Standard column view
    const overColumn = findColumn(overId);
    if (overColumn) {
      newStatus = overColumn.id;
    } else {
      const overTask = findTask(overId);
      if (overTask) {
        newStatus = overTask.status;
        newOrder = calculateOrderForTask(overTask);
      }
    }
  }
  
  // Validate move
  if (!newStatus) {
    addToast('Could not determine drop target', 'error');
    return;
  }
  
  if (!columns.find(c => c.id === newStatus)) {
    addToast('Invalid column', 'error');
    return;
  }
  
  // Check WIP limit
  if (isOverWipLimit(newStatus)) {
    addToast('Column WIP limit exceeded', 'error');
    return;
  }
  
  // Execute move with optimistic update
  moveTaskOptimistically(task.id, newStatus, newPriority, newOrder);
}

function isValidDropTarget(id: string): boolean {
  // Check if ID matches known patterns:
  // - Column ID
  // - Task ID
  // - Drop zone ID (priority::status format)
  // - Drop zone with prefix (drop-{columnId})
  return (
    columns.some(c => c.id === id || `drop-${c.id}` === id) ||
    tasks.some(t => t.id === id) ||
    /^[^:]+::[^:]+$/.test(id) // Composite drop zone pattern
  );
}
```

---

### 4.2 Enhanced `onDragStart` Logic

```typescript
function onDragStart(event: DragStartEvent) {
  const { active } = event;
  const activeId = String(active.id);
  
  // Store in ref for reliable access in onDragEnd
  const task = tasks.find(t => t.id === activeId);
  if (task) {
    activeDragRef.current = {
      type: 'task',
      id: activeId,
      data: task,
      startTime: Date.now(), // For performance tracking
    };
    setActiveTask(task); // For DragOverlay only
    return;
  }
  
  const column = columns.find(c => c.id === activeId);
  if (column) {
    activeDragRef.current = {
      type: 'column',
      id: activeId,
      data: column,
      startTime: Date.now(),
    };
    setActiveColumn(column);
    return;
  }
  
  // Log error if drag started on unknown element
  console.warn('Drag started on unknown element:', activeId);
  activeDragRef.current = null;
}
```

---

### 4.3 Optimized `onDragOver` for Visual Feedback

```typescript
const [highlightedZone, setHighlightedZone] = useState<string | null>(null);
const rafIdRef = useRef<number | null>(null);

function onDragOver(event: DragOverEvent) {
  // Cancel previous frame
  if (rafIdRef.current !== null) {
    cancelAnimationFrame(rafIdRef.current);
  }
  
  // Schedule update for next frame
  rafIdRef.current = requestAnimationFrame(() => {
    const overId = event.over ? String(event.over.id) : null;
    
    // Only update if different to prevent unnecessary re-renders
    if (overId !== highlightedZone) {
      setHighlightedZone(overId);
      
      // Optional: Provide haptic feedback on mobile
      if ('vibrate' in navigator && overId) {
        navigator.vibrate(10); // Subtle feedback
      }
    }
    
    rafIdRef.current = null;
  });
}
```

---

### 4.4 Integration with Existing `moveTask` Function

```typescript
// Enhanced moveTask signature
const moveTask = useCallback((
  taskId: string, 
  newStatus: string, 
  newPriority?: string,
  newOrder?: number
) => {
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    addToast('Task not found', 'error');
    return;
  }
  
  // Validation
  if (!columns.find(c => c.id === newStatus)) {
    addToast('Invalid column', 'error');
    return;
  }
  
  // Dependency check (existing logic)
  if (newStatus !== columns[0].id) {
    const blockedLinks = task.links?.filter(l => l.type === 'blocked-by') || [];
    for (const link of blockedLinks) {
      const blocker = tasks.find(t => t.id === link.targetTaskId);
      if (blocker) {
        const blockerCol = columns.find(c => c.id === blocker.status);
        if (!blockerCol?.isCompleted && blocker.status !== COLUMN_STATUS.DELIVERED) {
          addToast(`Cannot start: Blocked by task ${blocker.jobId}`, 'error');
          return;
        }
      }
    }
  }
  
  // WIP limit check
  const targetColumn = columns.find(c => c.id === newStatus);
  if (targetColumn?.wipLimit) {
    const tasksInColumn = tasks.filter(t => t.status === newStatus);
    if (tasksInColumn.length >= targetColumn.wipLimit && task.status !== newStatus) {
      addToast(`Column "${targetColumn.title}" has reached its WIP limit`, 'error');
      return;
    }
  }
  
  // Create updated task
  const previousTask = { ...task };
  const updatedTask: Task = {
    ...task,
    status: newStatus,
    priority: newPriority ?? task.priority,
    order: newOrder ?? task.order ?? Date.now(), // Fallback to timestamp
    updatedAt: new Date(),
  };
  
  // Update state
  pushUndo({ type: 'task-move', task: updatedTask, previousState: previousTask });
  setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
  
  // Optional: Analytics/logging
  logTaskMove(taskId, previousTask.status, newStatus);
}, [tasks, columns, addToast, pushUndo]);
```

---

### 4.5 Implementation Checklist

**Priority 1: Critical Fixes (Week 1)**
- [ ] Replace `useState` with `useRef` for `activeTask`/`activeColumn` in `onDragStart`/`onDragEnd`
- [ ] Add comprehensive validation in `onDragEnd` (check column exists, task exists, etc.)
- [ ] Fix drop target resolution logic to handle all edge cases
- [ ] Add error handling and user feedback for invalid drops
- [ ] Test with rapid successive drags to identify race conditions

**Priority 2: Performance & UX (Week 2)**
- [ ] Implement `requestAnimationFrame` for `onDragOver` visual updates
- [ ] Add auto-scroll when dragging near viewport edges
- [ ] Improve sensor configuration to prevent conflicts with interactive elements
- [ ] Add visual feedback for valid/invalid drop zones
- [ ] Implement drag cancellation (ESC key, click outside)

**Priority 3: Feature Enhancements (Week 3)**
- [ ] Add `order` field to Task type
- [ ] Implement within-column reordering
- [ ] Add WIP limit enforcement during drag
- [ ] Implement optimistic updates with rollback
- [ ] Add comprehensive error boundaries

**Priority 4: Polish & Testing (Week 4)**
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile device testing (iOS, Android)
- [ ] Accessibility audit and improvements
- [ ] Performance profiling with large datasets (100+ tasks)
- [ ] Add unit tests for drag-and-drop logic
- [ ] Add integration tests for common drag scenarios

---

## Summary

The current implementation using `@dnd-kit` is architecturally sound, but suffers from:
1. **State management issues** (stale closures)
2. **Incomplete error handling** (silent failures)
3. **Missing edge case coverage** (invalid drops, concurrent operations)
4. **Performance optimizations needed** (excessive re-renders, no virtual scrolling)
5. **UX gaps** (no reordering, limited feedback)

The proposed improvements focus on **reliability first** (fixing state management and validation), then **performance** (optimizing renders and animations), and finally **features** (reordering, WIP limits, etc.).
