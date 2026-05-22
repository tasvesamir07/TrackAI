import { useState, useMemo, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, User as UserIcon, MoreVertical, Trash2, FileText } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import TaskModal from './TaskModal';
import { format } from 'date-fns';
import { useSocket } from '@/context/SocketContext';
import { useAuth } from '@/context/AuthContext';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    DndContext,
    pointerWithin,
    rectIntersection,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    useDroppable,
} from '@dnd-kit/core';
import type {
    CollisionDetection,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function getAvatarSrc(path?: string | null) {
    if (!path) return undefined;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

const COLUMNS = [
    { id: 'todo', title: 'To Do', color: 'bg-100' },
    { id: 'in_progress', title: 'In Progress', color: 'bg-blue-50' },
    { id: 'ready_for_test', title: 'Ready for Test', color: 'bg-yellow-50' },
    { id: 'ready', title: 'Ready', color: 'bg-purple-50' },
    { id: 'done', title: 'Done', color: 'bg-emerald-50' }
];

interface Task {
    id: number;
    title: string;
    description: string;
    status: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    assigned_by_name?: string;
    assignees?: { id: number; username: string; profile_picture: string }[];
    assigned_to?: number;
    assignee_name?: string;
    assignee_avatar?: string;
    due_date?: string;
    position?: number;
}

interface ProjectSummary {
    id: number;
    name: string;
}

interface ProjectBoardProps {
    project: ProjectSummary;
}

interface ColumnProps {
    id: string;
    title: string;
    tasks: Task[];
    onEditTask: (task: Task) => void;
    onAddTask: (status: string) => void;
    onDeleteTask?: (taskId: number) => void;
    canDeleteTask?: boolean;
    dragPreview: { status: string; beforeTaskId: number | null } | null;
}

interface ProjectTaskSocketEvent {
    type: 'create' | 'update' | 'delete' | string;
    task?: { project_id?: number };
    projectId?: number;
}

interface ProjectLogDetails {
    title?: string;
    fromStatus?: string;
    toStatus?: string;
    addedNames?: string[];
    removedNames?: string[];
}

interface ProjectLogEntry {
    id: number;
    actor_username?: string;
    actor_role?: string;
    action_type: string;
    created_at: string;
    details?: ProjectLogDetails;
}

function getSortedTasks(tasks: Task[]) {
    return [...tasks].sort((a, b) => (a.position || 0) - (b.position || 0));
}

function areTaskListsEqual(left: Task[], right: Task[]) {
    if (left.length !== right.length) return false;

    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];

        if (
            a.id !== b.id ||
            a.status !== b.status ||
            (a.position || 0) !== (b.position || 0)
        ) {
            return false;
        }
    }

    return true;
}

function getProjectedTaskState(tasks: Task[], activeId: number, overId: string | number) {
    const sortedItems = getSortedTasks(tasks);
    const activeIndex = sortedItems.findIndex((task) => task.id === activeId);
    if (activeIndex === -1) return null;

    const activeTask = sortedItems[activeIndex];
    const overTask = sortedItems.find((task) => task.id === overId);
    const isColumnTarget = COLUMNS.some((column) => column.id === overId);
    const nextStatus = overTask ? overTask.status : (isColumnTarget ? String(overId) : activeTask.status);

    const remainingItems = sortedItems.filter((task) => task.id !== activeId);

    let insertIndex = remainingItems.length;
    if (overTask) {
        insertIndex = remainingItems.findIndex((task) => task.id === overId);
        if (insertIndex === -1) insertIndex = remainingItems.length;
    } else if (isColumnTarget) {
        const lastIndexInColumn = remainingItems.reduce((lastIndex, task, index) => (
            task.status === nextStatus ? index : lastIndex
        ), -1);
        insertIndex = lastIndexInColumn >= 0 ? lastIndexInColumn + 1 : remainingItems.length;
    }

    const projectedTask: Task = {
        ...activeTask,
        status: nextStatus,
    };

    remainingItems.splice(insertIndex, 0, projectedTask);

    const targetColumnTasks = remainingItems.filter((task) => task.status === nextStatus);
    const projectedIndex = targetColumnTasks.findIndex((task) => task.id === activeId);
    const previousTask = targetColumnTasks[projectedIndex - 1];
    const nextTask = targetColumnTasks[projectedIndex + 1];

    let nextPosition = projectedTask.position || 0;
    if (!previousTask && !nextTask) {
        nextPosition = 0;
    } else if (!previousTask) {
        nextPosition = (nextTask?.position || 0) - 600000;
    } else if (!nextTask) {
        nextPosition = (previousTask?.position || 0) + 600000;
    } else {
        nextPosition = ((previousTask.position || 0) + (nextTask.position || 0)) / 2;
    }

    projectedTask.position = nextPosition;

    return {
        tasks: remainingItems,
        task: projectedTask,
    };
}

function getDragPreview(activeTask: Task | null, dragOverId: string | number | null, tasks: Task[]) {
    if (!activeTask || dragOverId == null) return null;

    const overTask = tasks.find((task) => task.id === dragOverId);
    const isColumnTarget = COLUMNS.some((column) => column.id === dragOverId);
    const status = overTask ? overTask.status : (isColumnTarget ? String(dragOverId) : null);

    if (!status || status === activeTask.status) return null;

    return {
        status,
        beforeTaskId: overTask && overTask.id !== activeTask.id ? overTask.id : null,
    };
}

function DropIndicator() {
    return (
        <div className="h-[100px] w-full rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/30 animate-pulse transition duration-300 flex items-center justify-center">
            <div className="w-8 h-1 bg-indigo-100 rounded-full" />
        </div>
    );
}

// --- Reusable Task Card ---
function getPriorityLabel(priority: string) {
    switch (priority) {
        case 'urgent': return { label: 'Urgent', cls: 'bg-red-50 text-red-600 border-red-100' };
        case 'high': return { label: 'High', cls: 'bg-orange-50 text-orange-600 border-orange-100' };
        case 'medium': return { label: 'Medium', cls: 'bg-blue-50 text-blue-600 border-blue-100' };
        case 'low': return { label: 'Low', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
        default: return { label: 'None', cls: 'bg-50 text-500 border-100' };
    }
}

function TaskCard({
    task,
    onClick,
    onDelete,
    canDelete,
    className,
    style
}: {
    task: Task,
    onClick?: (task: Task) => void,
    onDelete?: (taskId: number) => void,
    canDelete?: boolean,
    className?: string,
    style?: CSSProperties
}) {
    const priority = getPriorityLabel(task.priority);
    return (
        <Card
            className={cn("cursor-grab hover:shadow-lg hover:-translate-y-0.5 transition duration-200 border-l-4 group active:cursor-grabbing bg-white rounded-xl", className)}
            style={{ borderLeftColor: getPriorityColor(task.priority), ...style }}
            onClick={() => onClick && onClick(task)}
        >
            <CardContent className="p-3.5 space-y-2.5">
                <div className="flex justify-between items-start gap-2">
                    <h4 className="text-sm font-semibold leading-tight text-800 line-clamp-2 group-hover:text-indigo-700 transition-colors">{task.title}</h4>
                    <div className="flex items-center gap-1 shrink-0">
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-md border uppercase tracking-wider", priority.cls)}>
                            {priority.label}
                        </span>
                        {canDelete && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="h-6 w-6 inline-flex items-center justify-center rounded-md text-400 hover:text-700 hover:bg-100"
                                        onClick={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                    >
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {canDelete && onDelete && (
                                        <DropdownMenuItem
                                            className="text-red-600"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDelete(task.id);
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4 mr-2" />
                                            Delete Card
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </div>

                {task.assigned_by_name && (
                    <p className="text-[10px] text-500">
                        Assigned by <span className="font-semibold text-700">{task.assigned_by_name}</span>
                    </p>
                )}

                <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center -space-x-1.5 overflow-hidden pl-1">
                        {task.assignees && task.assignees.length > 0 ? (
                            task.assignees.map((user) => (
                                <Avatar key={user.id} className="w-6 h-6 border-2 border-white ring-1 ring-slate-100 shadow-sm">
                                    <AvatarImage src={getAvatarSrc(user.profile_picture)} className="object-cover" />
                                    <AvatarFallback className="bg-linear-to-br from-indigo-500 to-purple-500 text-white text-[9px] font-semibold">
                                        {user.username?.[0]?.toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                            ))
                        ) : (
                            <div className="w-6 h-6 rounded-full bg-100 border-2 border-white flex items-center justify-center shadow-sm">
                                <UserIcon className="w-3 h-3 text-400" />
                            </div>
                        )}
                    </div>

                    {task.due_date && (
                        <div className={cn("flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                            new Date(task.due_date) < new Date() ? 'text-red-600 bg-red-50' : 'text-400 bg-50'
                        )}>
                            <Calendar className="w-3 h-3" />
                            {format(new Date(task.due_date), 'MMM d')}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function getPriorityColor(priority: string) {
    switch (priority) {
        case 'urgent': return '#ef4444';
        case 'high': return '#f97316';
        case 'medium': return '#3b82f6';
        case 'low': return '#22c55e';
        default: return '#cbd5e1';
    }
}

// --- Sortable Task Item ---
function SortableTask({
    task,
    onClick,
    onDeleteTask,
    canDeleteTask,
}: {
    task: Task,
    onClick: (task: Task) => void,
    onDeleteTask?: (taskId: number) => void,
    canDeleteTask?: boolean,
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: task.id,
        data: {
            type: 'Task',
            task,
        },
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
    };

    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="pointer-events-none opacity-[0.2] scale-[0.98] transition duration-200"
            >
                <TaskCard task={task} className="shadow-none border-dashed" />
            </div>
        );
    }

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none">
            <TaskCard task={task} onClick={onClick} onDelete={onDeleteTask} canDelete={canDeleteTask} />
        </div>
    );
}

// --- Droppable Column ---
function Column({ id, title, tasks, onEditTask, onAddTask, onDeleteTask, canDeleteTask, dragPreview }: ColumnProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: id,
        data: {
            type: 'Column',
            id
        }
    });

    const columnStyles = useMemo(() => {
        const styles = id === 'todo'
            ? {
                wrapper: 'border-orange-200/80 bg-orange-50/70',
                header: 'text-orange-700 bg-orange-100/70',
                active: 'ring-2 ring-orange-400/50 bg-orange-100/40'
            }
            : id === 'in_progress'
                ? {
                    wrapper: 'border-blue-200/80 bg-blue-50/70',
                    header: 'text-blue-700 bg-blue-100/70',
                    active: 'ring-2 ring-blue-400/50 bg-blue-100/40'
                }
                : id === 'ready_for_test'
                    ? {
                        wrapper: 'border-amber-200/80 bg-amber-50/70',
                        header: 'text-amber-700 bg-amber-100/70',
                        active: 'ring-2 ring-amber-400/50 bg-amber-100/40'
                    }
                    : id === 'ready'
                        ? {
                            wrapper: 'border-purple-200/80 bg-purple-50/70',
                            header: 'text-purple-700 bg-purple-100/70',
                            active: 'ring-2 ring-purple-400/50 bg-purple-100/40'
                        }
                        : {
                            wrapper: 'border-emerald-200/80 bg-emerald-50/70',
                            header: 'text-emerald-700 bg-emerald-100/70',
                            active: 'ring-2 ring-emerald-400/50 bg-emerald-100/40'
                        };
        return styles;
    }, [id]);

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "flex flex-col h-full min-w-[280px] w-72 rounded-2xl border shadow-sm overflow-hidden transition duration-300",
                columnStyles.wrapper,
                isOver && columnStyles.active,
                isOver && "scale-[1.01] shadow-md"
            )}
        >
            <div className={cn("px-4 py-3.5 flex justify-between items-center border-b border-white/60", columnStyles.header)}>
                <div className="flex items-center gap-2">
                    <span className="uppercase tracking-[0.16em] text-[11px] font-bold">{title}</span>
                    <span className="bg-white/70 px-2 py-0.5 rounded-full text-[10px] font-semibold shadow-sm">{tasks.length}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-white/60" onClick={() => onAddTask(id)}>
                    <Plus className="w-3.5 h-3.5" />
                </Button>
            </div>

            <div className="flex-1 p-3 overflow-y-auto min-h-0 custom-scrollbar">
                <SortableContext items={tasks.map((t: Task) => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2 pb-4 min-h-[50px]">
                        {tasks.map((task: Task) => (
                            <div key={task.id}>
                                {dragPreview?.status === id && dragPreview.beforeTaskId === task.id && (
                                    <DropIndicator />
                                )}
                                <SortableTask task={task} onClick={onEditTask} onDeleteTask={onDeleteTask} canDeleteTask={canDeleteTask} />
                            </div>
                        ))}
                        {dragPreview?.status === id && !dragPreview.beforeTaskId && (
                            <DropIndicator />
                        )}
                    </div>
                </SortableContext>
            </div>
        </div>
    );
}


export default function ProjectBoard({ project }: ProjectBoardProps) {
    const queryClient = useQueryClient();
    const { socket } = useSocket();
    const { user } = useAuth();
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [initialStatus, setInitialStatus] = useState<string>('todo');
    const [isProjectLogOpen, setIsProjectLogOpen] = useState(false);
    const logScrollRef = useRef<HTMLDivElement | null>(null);

    const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
    const [isDraggingTask, setIsDraggingTask] = useState(false);
    const [dragOverId, setDragOverId] = useState<string | number | null>(null);
    const canDeleteTask = user?.role === 'admin' || user?.role === 'moderator';

    const { data: tasks = [] } = useQuery<Task[]>({
        queryKey: ['project-tasks', project.id],
        queryFn: async () => {
            const res = await api.get(`/projects/${project.id}/tasks`);
            return res.data;
        }
    });

    const { data: projectLogs = [], isFetching: isProjectLogsLoading } = useQuery<ProjectLogEntry[]>({
        queryKey: ['project-logs', project.id],
        queryFn: async () => {
            const res = await api.get(`/projects/${project.id}/activity-logs`);
            return res.data;
        },
        enabled: isProjectLogOpen && user?.role === 'admin'
    });

    // Update socket listener to just refetch (Dnd will handle local state optimistically, but server sync is good)
    useEffect(() => {
        if (!socket) return;
        const handleUpdate = (data: ProjectTaskSocketEvent) => {
            if (isDraggingTask) return;
            if ((data.type === 'create' || data.type === 'update') && (data.task && data.task.project_id === project.id)) {
                queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
            }
            if (data.type === 'delete' && data.projectId === project.id) {
                queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
            }
        };
        socket.on('project_task_update', handleUpdate);
        return () => { socket.off('project_task_update', handleUpdate); };
    }, [socket, project.id, queryClient, isDraggingTask]);

    const updateTaskMutation = useMutation({
        mutationFn: async ({ taskId, status, position }: { taskId: number, status: string, position: number }) => {
            return api.put(`/projects/tasks/${taskId}`, { status, position });
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['project-tasks', project.id] });
            const previous = queryClient.getQueryData<Task[]>(['project-tasks', project.id]);
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['project-tasks', project.id], context.previous);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
        }
    });
    const shouldVirtualizeLogs = projectLogs.length > 50;
    // eslint-disable-next-line react-hooks/incompatible-library
    const logVirtualizer = useVirtualizer({
        count: shouldVirtualizeLogs ? projectLogs.length : 0,
        getScrollElement: () => logScrollRef.current,
        estimateSize: () => 110,
        overscan: 8
    });


    const deleteTaskMutation = useMutation({
        mutationFn: async (taskId: number) => api.delete(`/projects/tasks/${taskId}`),
        onMutate: async (taskId: number) => {
            await queryClient.cancelQueries({ queryKey: ['project-tasks', project.id] });
            const previous = queryClient.getQueryData<Task[]>(['project-tasks', project.id]);
            queryClient.setQueryData<Task[]>(['project-tasks', project.id], (current = []) => current.filter((t) => t.id !== taskId));
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) {
                queryClient.setQueryData(['project-tasks', project.id], context.previous);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
        }
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const collisionDetectionStrategy: CollisionDetection = (args) => {
        const dragOriginTask = activeDragTask;

        if (args.pointerCoordinates) {
            const pointerColumn = args.droppableContainers.find((container) => {
                if (container.data.current?.type !== 'Column') return false;
                const rect = args.droppableRects.get(container.id);
                if (!rect) return false;

                return (
                    args.pointerCoordinates!.x >= rect.left &&
                    args.pointerCoordinates!.x <= rect.right &&
                    args.pointerCoordinates!.y >= rect.top &&
                    args.pointerCoordinates!.y <= rect.bottom
                );
            });

            if (pointerColumn && dragOriginTask && dragOriginTask.status !== String(pointerColumn.id)) {
                return [{
                    id: pointerColumn.id,
                    data: {
                        droppableContainer: pointerColumn,
                        value: 1,
                    },
                }];
            }
        }

        const pointerCollisions = pointerWithin(args);
        if (pointerCollisions.length > 0) {
            return pointerCollisions;
        }

        return rectIntersection(args);
    };

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const task = tasks.find(t => t.id === active.id);
        if (task) {
            setActiveDragTask(task);
            setIsDraggingTask(true);
            setDragOverId(task.id);
        }
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event;
        if (!over) return;
        setDragOverId((current) => (current === over.id ? current : over.id));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveDragTask(null);
        setIsDraggingTask(false);
        setDragOverId(null);

        if (!over) return;

        const projected = getProjectedTaskState(tasks, Number(active.id), over.id);
        if (!projected) return;

        queryClient.setQueryData<Task[]>(['project-tasks', project.id], (current = []) => (
            areTaskListsEqual(current, projected.tasks) ? current : projected.tasks
        ));

        updateTaskMutation.mutate({
            taskId: Number(active.id),
            status: projected.task.status,
            position: projected.task.position || 0
        });
    };

    const handleDragCancel = () => {
        setActiveDragTask(null);
        setIsDraggingTask(false);
        setDragOverId(null);
    };

    const dragPreview = useMemo(
        () => getDragPreview(activeDragTask, dragOverId, tasks),
        [activeDragTask, dragOverId, tasks]
    );

    const tasksByStatus = useMemo(() => {
        const acc: Record<string, Task[]> = {
            todo: [],
            in_progress: [],
            ready_for_test: [],
            ready: [],
            done: []
        };
        const sortedTasks = [...tasks].sort((a, b) => (a.position || 0) - (b.position || 0));

        sortedTasks.forEach((task: Task) => {
            const status = task.status || 'todo';
            if (acc[status]) {
                acc[status].push(task);
            } else {
                acc['todo'].push(task);
            }
        });
        return acc;
    }, [tasks]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <div className="h-full flex flex-col p-4 overflow-hidden bg-50/30">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-800">{project.name}</h2>
                        {user?.role === 'admin' && (
                            <Button
                                variant="outline"
                                size="sm"
                                onMouseEnter={() => {
                                    queryClient.prefetchQuery({
                                        queryKey: ['project-logs', project.id],
                                        queryFn: async () => {
                                            const res = await api.get(`/projects/${project.id}/activity-logs`);
                                            return res.data;
                                        }
                                    });
                                }}
                                onClick={() => setIsProjectLogOpen(true)}
                                className="gap-2 ml-4 bg-white"
                            >
                                <FileText className="w-4 h-4" />
                                Project Log
                            </Button>
                        )}
                    </div>
                </div>

                <div className="flex flex-1 gap-4 overflow-x-auto pb-4 min-h-0">
                    {COLUMNS.map(col => (
                        <Column
                            key={col.id}
                            id={col.id}
                            title={col.title}
                            tasks={tasksByStatus[col.id]}
                            canDeleteTask={canDeleteTask}
                            onDeleteTask={(taskId: number) => {
                                deleteTaskMutation.mutate(taskId);
                            }}
                            dragPreview={dragPreview}
                            onEditTask={(task: Task) => {
                                setEditingTask(task);
                                setInitialStatus(task.status);
                                setIsTaskModalOpen(true);
                            }}
                            onAddTask={(status: string) => {
                                setEditingTask(null);
                                setInitialStatus(status);
                                setIsTaskModalOpen(true);
                            }}
                        />
                    ))}
                </div>

                {isTaskModalOpen && (
                    <TaskModal
                        isOpen={isTaskModalOpen}
                        onClose={() => setIsTaskModalOpen(false)}
                        project={project}
                        task={editingTask || undefined}
                        initialStatus={initialStatus}
                    />
                )}

                <Dialog open={isProjectLogOpen} onOpenChange={setIsProjectLogOpen}>
                    <DialogContent className="sm:max-w-[720px] bg-white">
                        <DialogHeader>
                            <DialogTitle>Project Activity Log</DialogTitle>
                            <DialogDescription>
                                Full history for "{project.name}"
                            </DialogDescription>
                        </DialogHeader>
                        <div ref={logScrollRef} className="max-h-[500px] overflow-y-auto space-y-3 pr-1 mt-4">
                            {isProjectLogsLoading && (
                                <div className="text-sm text-500 py-8 text-center">Loading project logs...</div>
                            )}
                            {!isProjectLogsLoading && projectLogs.length === 0 && (
                                <div className="text-sm text-500 py-8 text-center">No activity found for this project.</div>
                            )}
                            {!isProjectLogsLoading && !shouldVirtualizeLogs && projectLogs.map((log) => {
                                const actor = log.actor_username ? `${log.actor_username}${log.actor_role ? ` (${log.actor_role})` : ''}` : 'System';
                                const actionType = log.action_type.replace(/_/g, ' ');
                                const taskTitle = log.details?.title || 'Unknown Task';

                                return (
                                    <div key={log.id} className="rounded-xl border border-100 bg-50/30 p-4 hover:border-indigo-100 transition-colors">
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 uppercase tracking-wider">
                                                    {actionType}
                                                </span>
                                                <p className="text-sm font-semibold text-900 line-clamp-1">{taskTitle}</p>
                                            </div>
                                            <p className="text-[11px] text-400 font-medium">{format(new Date(log.created_at), 'MMM d, HH:mm')}</p>
                                        </div>
                                        
                                        <div className="flex flex-col gap-1">
                                            <p className="text-xs text-500 font-medium">By <span className="text-700">{actor}</span></p>
                                            {log.action_type === 'status_updated' && (
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[10px] text-400 line-through">{log.details?.fromStatus}</span>
                                                    <span className="text-[10px] text-indigo-500 font-bold">→</span>
                                                    <span className="text-[10px] text-indigo-600 font-bold">{log.details?.toStatus}</span>
                                                </div>
                                            )}
                                            {log.action_type === 'assignees_updated' && (
                                                <div className="text-[10px] text-600 mt-1">
                                                    {log.details?.addedNames?.length ? <span className="text-emerald-600 font-medium">Added: {log.details.addedNames.join(', ')} </span> : null}
                                                    {log.details?.removedNames?.length ? <span className="text-red-600 font-medium">Removed: {log.details.removedNames.join(', ')}</span> : null}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {!isProjectLogsLoading && shouldVirtualizeLogs && (
                                <div style={{ height: logVirtualizer.getTotalSize(), position: 'relative' }}>
                                    {logVirtualizer.getVirtualItems().map((virtualRow: { index: number; start: number; size: number }) => {
                                        const log = projectLogs[virtualRow.index];
                                        if (!log) return null;
                                        const actor = log.actor_username ? `${log.actor_username}${log.actor_role ? ` (${log.actor_role})` : ''}` : 'System';
                                        const actionType = log.action_type.replace(/_/g, ' ');
                                        const taskTitle = log.details?.title || 'Unknown Task';
                                        return (
                                            <div
                                                key={log.id}
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    transform: `translateY(${virtualRow.start}px)`
                                                }}
                                            >
                                                <div className="rounded-xl border border-100 bg-50/30 p-4 hover:border-indigo-100 transition-colors mb-3">
                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 uppercase tracking-wider">{actionType}</span>
                                                            <p className="text-sm font-semibold text-900 line-clamp-1">{taskTitle}</p>
                                                        </div>
                                                        <p className="text-[11px] text-400 font-medium">{format(new Date(log.created_at), 'MMM d, HH:mm')}</p>
                                                    </div>
                                                    <p className="text-xs text-500 font-medium">By <span className="text-700">{actor}</span></p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>


                <DragOverlay zIndex={9999}>
                    {activeDragTask ? (
                        <div className="rotate-2 transition-transform duration-200">
                            <TaskCard
                                task={activeDragTask}
                                className="w-72 border-2 border-indigo-500/50 cursor-grabbing shadow-[0_20px_50px_rgba(0,0,0,0.2)] opacity-95 ring-4 ring-indigo-500/10"
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </div>
        </DndContext>
    );
}
