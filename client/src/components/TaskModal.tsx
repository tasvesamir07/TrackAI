import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Trash2, Send, Paperclip, Check, AlignLeft, Activity, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSocket } from '@/context/SocketContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/context/AuthContext';

interface TaskMember {
    id: number;
    username?: string;
    profile_picture?: string;
    account_role?: string;
    role?: string;
    [key: string]: unknown;
}

interface ProjectData {
    id?: number | string;
    title?: string;
    name?: string;
    member_preview?: TaskMember[];
    members?: TaskMember[];
    user_role?: string;
}

interface TaskAttachment {
    url?: string;
    name?: string;
    [key: string]: unknown;
}

interface TaskData {
    id?: number;
    title: string;
    description?: string;
    priority: string;
    status: string;
    assignees?: { id: number }[] | number[];
    assigned_to?: string | number;
    attachments?: TaskAttachment[];
}

interface TaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: ProjectData;
    task?: TaskData;
    initialStatus?: string;
}

export default function TaskModal({ isOpen, onClose, project, task, initialStatus }: TaskModalProps) {
    const queryClient = useQueryClient();
    const { socket } = useSocket();
    const { user } = useAuth();
    const [formData, setFormData] = useState<{
        title: string;
        description: string;
        priority: string;
        status: string;
        assignees: number[]; // Array of user IDs
        assigned_to?: string; // Keep for backward compatibility if needed, but mainly use assignees
    }>({
        title: '',
        description: '',
        priority: 'medium',
        status: initialStatus || 'todo',
        assignees: [],
        assigned_to: '',
        // due_date removed
    });
    const [newComment, setNewComment] = useState('');
    const commentsEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [localAttachments, setLocalAttachments] = useState<TaskAttachment[]>([]);

    // Sync local attachments from task prop
    useEffect(() => {
         
        if (task) {
            setLocalAttachments(task.attachments || []);
        } else {
            setLocalAttachments([]);
        }
    }, [task]);

    useEffect(() => {
        if (task) {
            // Use assignees as source of truth; only fall back to legacy assigned_to
            // when assignees field is truly missing from the payload.
            let initialAssignees: number[] = [];
            const hasAssigneesField = Array.isArray(task.assignees);
            if (hasAssigneesField) {
                initialAssignees = (task.assignees as unknown[])
                    .map((a: unknown) => Number((a as { id?: number })?.id))
                    .filter((id: number) => Number.isInteger(id) && id > 0);
            } else if (task.assigned_to) {
                const parsed = Number.parseInt(String(task.assigned_to), 10);
                initialAssignees = Number.isInteger(parsed) && parsed > 0 ? [parsed] : [];
            }

             
            setFormData({
                title: task.title,
                description: task.description || '',
                priority: task.priority,
                status: task.status,
                assignees: initialAssignees,
                assigned_to: task.assigned_to?.toString() || '',
            });
        } // ... rest is handled in next chunk or assumed same if logic allows.
        // actually I need to close the bracket properly.
        else {
             
            setFormData({
                title: '',
                description: '',
                priority: 'medium',
                status: initialStatus || 'todo',
                assignees: [],
                assigned_to: '',
            });
        }
    }, [task, initialStatus]);

    // Only project members can be assigned to tasks.
    const { data: projectDetails } = useQuery({
        queryKey: ['project-task-members', project?.id],
        queryFn: async () => {
            const res = await api.get(`/projects/${project.id}`);
            return res.data;
        },
        enabled: isOpen && !!project?.id
    });
    const members = ((projectDetails?.members || project?.member_preview || []) as TaskMember[]).filter(
        (member: TaskMember) => (member.account_role || member.role) === 'employee'
    );
    const assignableMemberIds = new Set(members.map((member: TaskMember) => member.id));
    const currentMemberRole = ((projectDetails?.members || []) as TaskMember[]).find((member: TaskMember) => member.id === user?.id)?.role || project?.user_role;
    const canDeleteTask = user?.role === 'admin' || user?.role === 'moderator' || currentMemberRole === 'leader';

    useEffect(() => {
        if (!projectDetails) return;

         
        setFormData((prev) => {
            const sanitizedAssignees = (prev.assignees || []).filter((id) => assignableMemberIds.has(id));
            if (sanitizedAssignees.length === (prev.assignees || []).length) {
                return prev;
            }

            return {
                ...prev,
                assignees: sanitizedAssignees,
                assigned_to: sanitizedAssignees[0]?.toString() || '',
            };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectDetails]);

    // Fetch comments if editing
    const { data: comments, refetch: refetchComments } = useQuery({
        queryKey: ['task-comments', task?.id],
        queryFn: async () => {
            if (!task?.id) return [];
            const res = await api.get(`/projects/tasks/${task.id}/comments`);
            return res.data;
        },
        enabled: !!task?.id
    });

    // Real-time comments
    useEffect(() => {
        if (!socket || !task?.id) return;
        const handleComment = (data: { taskId?: number | string }) => {
            if (String(data.taskId) === String(task.id)) {
                refetchComments();
            }
        };
        socket.on('task_comment_update', handleComment);
        return () => { socket.off('task_comment_update', handleComment); };
    }, [socket, task?.id, refetchComments]);

    const mutation = useMutation({
        mutationFn: async (data: Record<string, unknown>) => {
            if (task) {
                return api.put(`/projects/tasks/${task.id}`, data);
            } else {
                return api.post(`/projects/${project.id}/tasks`, { ...data, project_id: project.id });
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async () => {
            return api.delete(`/projects/tasks/${task?.id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
            onClose();
        }
    });

    const commentMutation = useMutation({
        mutationFn: async () => {
            return api.post(`/projects/tasks/${task?.id}/comments`, { content: newComment });
        },
        onSuccess: () => {
            setNewComment('');
            refetchComments();
        }
    });

    const uploadMutation = useMutation({
        mutationFn: async (files: FileList) => {
            const formData = new FormData();
            Array.from(files).forEach(file => {
                formData.append('attachments', file);
            });
            return api.post(`/projects/tasks/${task?.id}/attachments`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (res) => {
            // Optimistically add the new attachments to local state
            const newAttachments = res.data?.attachments || [];
            setLocalAttachments(prev => [...prev, ...newAttachments]);
            queryClient.invalidateQueries({ queryKey: ['project-tasks', project.id] });
        }
    });



    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            uploadMutation.mutate(e.target.files);
        }
    };

    const handleSubmit = () => {
        const sanitizedAssignees = (formData.assignees || []).filter((id) => assignableMemberIds.has(id));
        mutation.mutate({
            ...formData,
            assignees: sanitizedAssignees,
            assigned_to: formData.assigned_to ? parseInt(formData.assigned_to) : null
        }, {
            onSuccess: () => {
                onClose();
            }
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (newComment.trim()) commentMutation.mutate();
        }
    };

    // Auto-scroll to bottom of comments
    useEffect(() => {
        commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comments]);


    if (!task) {
        // --- CREATE MODE ---
        return (
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="sm:max-w-[500px] bg-card/95 backdrop-blur-xl rounded-2xl shadow-2xl p-0 overflow-hidden border border-indigo-100">
                    <div className="bg-linear-to-r from-indigo-500 via-indigo-600 to-purple-600 px-6 py-5">
                        <DialogTitle className="text-lg font-bold text-white flex items-center gap-2.5">
                            <div className="p-1.5 bg-white/15 rounded-lg backdrop-blur-sm">
                                <Plus className="w-4 h-4 text-white" />
                            </div>
                            Create Task
                        </DialogTitle>
                        <DialogDescription className="text-sm text-indigo-100/90 mt-1 ml-9">
                            Adding to <span className="font-semibold text-white/90 capitalize">{initialStatus?.replace('_', ' ')}</span>
                        </DialogDescription>
                    </div>

                    <div className="p-6 space-y-5">
                        <div className="space-y-1.5">
                            <Label htmlFor="title" className="text-sm font-semibold text-700">Task Title</Label>
                            <Input
                                id="title"
                                value={formData.title}
                                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                                placeholder="What needs to be done?"
                                autoFocus
                                className="h-11 rounded-xl border-200 bg-50/50 focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-400"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="description" className="text-sm font-semibold text-700">Description</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Add details and context..."
                                className="min-h-[100px] resize-none rounded-xl border-200 bg-50/50 focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-400"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-sm font-medium text-700">Priority</Label>
                                <Select
                                    value={formData.priority}
                                    onValueChange={(val) => setFormData(prev => ({ ...prev, priority: val }))}
                                >
                                    <SelectTrigger className="h-10 border-200 focus-visible:ring-indigo-100">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="low">Low</SelectItem>
                                        <SelectItem value="medium">Medium</SelectItem>
                                        <SelectItem value="high">High</SelectItem>
                                        <SelectItem value="urgent">Urgent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-sm font-medium text-700">Assignees</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start h-10 border-200 font-normal px-3">
                                            {formData.assignees && formData.assignees.length > 0 ? (
                                                <div className="flex -space-x-1 overflow-hidden">
                                                    {formData.assignees.slice(0, 3).map((id) => {
                                                        const m = members?.find((user: TaskMember) => user.id === id);
                                                        return m ? (
                                                            <Avatar key={id} className="w-6 h-6 border-2 border-white">
                                                                <AvatarImage src={`${import.meta.env.VITE_API_URL}${m.profile_picture}`} className="object-cover" />
                                                                <AvatarFallback className="text-[9px] bg-100 text-600">{m.username?.[0]}</AvatarFallback>
                                                            </Avatar>
                                                        ) : null;
                                                    })}
                                                    {formData.assignees.length > 3 && (
                                                        <div className="w-6 h-6 rounded-full bg-100 border-2 border-white flex items-center justify-center text-[9px] text-600">
                                                            +{formData.assignees.length - 3}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-400">Add members</span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[240px] p-2 bg-white" align="end">
                                        <div className="grid max-h-[220px] overflow-y-auto">
                                            {members?.map((m: TaskMember) => {
                                                const isSelected = formData.assignees?.includes(m.id);
                                                return (
                                                    <div
                                                        key={m.id}
                                                        className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-50"
                                                        onClick={() => {
                                                            setFormData(prev => {
                                                                const current = prev.assignees || [];
                                                                if (current.includes(m.id)) {
                                                                    return { ...prev, assignees: current.filter(id => id !== m.id) };
                                                                } else {
                                                                    return { ...prev, assignees: [...current, m.id] };
                                                                }
                                                            });
                                                        }}
                                                    >
                                                        <div className={cn(
                                                            "w-4 h-4 border rounded flex items-center justify-center transition",
                                                            isSelected ? "bg-indigo-600 border-indigo-600" : "border-300"
                                                        )}>
                                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                                        </div>
                                                        <Avatar className="w-6 h-6">
                                                            <AvatarImage src={`${import.meta.env.VITE_API_URL}${m.profile_picture}`} className="object-cover" />
                                                            <AvatarFallback className="text-xs">{m.username?.[0]}</AvatarFallback>
                                                        </Avatar>
                                                        <span className="text-sm text-700 truncate">{m.username}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-4 mt-2 border-t border-100">
                            <Button variant="ghost" onClick={onClose} className="text-500 hover:text-700 hover:bg-100">Cancel</Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={mutation.isPending || !formData.title}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 px-6 transition active:scale-95"
                            >
                                {mutation.isPending ? 'Creating...' : 'Create Task'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    // --- VIEW / EDIT MODE ---
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent
                className="max-w-4xl h-[85vh] sm:h-[80vh] bg-card p-0 overflow-hidden flex flex-col gap-0 border-200/60 shadow-2xl sm:rounded-2xl"
                aria-describedby="task-desc"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>Edit Task: {task.title}</DialogTitle>
                    <DialogDescription id="task-desc">Edit task details and view comments</DialogDescription>
                </DialogHeader>

                {/* Gradient accent bar */}
                <div className="h-1.5 bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500 shrink-0" />

                {/* Header Section */}
                <div className="bg-card px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-100">
                    <div className="flex-1 min-w-0 space-y-1 w-full">
                        <div className="flex items-center gap-2 text-xs font-medium text-500 mb-2">
                            <span className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-md font-semibold">TASK-{task?.id || 'NEW'}</span>
                            <span className="text-300">•</span>
                            <span className="text-500">{String(project.title || project.name || 'Project')}</span>
                            <span className="text-300">•</span>
                            <span className="capitalize bg-100 text-600 px-2 py-0.5 rounded-md">{formData.status?.replace('_', ' ')}</span>
                        </div>
                        <Input
                            className="text-2xl font-bold text-900 border-transparent hover:border-200 focus-visible:ring-indigo-100 focus-visible:border-indigo-300 bg-transparent px-2 h-auto py-1 transition -ml-2 w-full"
                            value={formData.title}
                            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                            placeholder="Task Title"
                        />
                    </div>
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        {canDeleteTask && (
                            <Button
                                variant="outline"
                                onClick={() => deleteMutation.mutate()}
                                disabled={deleteMutation.isPending}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200/50 shadow-none transition"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                            </Button>
                        )}
                        <Button
                            onClick={handleSubmit}
                            disabled={mutation.isPending || !formData.title}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 px-6 transition active:scale-95"
                        >
                            {mutation.isPending ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
                    {/* Left Column: Core Details */}
                    <div className="flex-1 flex flex-col overflow-y-auto p-6 sm:p-8 border-r border-100">
                        <div className="space-y-8">
                            {/* Description Section */}
                            <div>
                                <Label className="text-sm font-semibold text-700 flex items-center gap-2 mb-3">
                                    <AlignLeft className="w-4 h-4 text-400" />
                                    Description
                                </Label>
                                <Textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Add details about this task..."
                                    className="min-h-[120px] resize-none bg-50/50 border-200 focus-visible:ring-indigo-100 p-4 rounded-xl text-700"
                                />
                            </div>

                            {/* Attachments Section */}
                            <div>
                                <Label className="text-sm font-semibold text-700 flex items-center gap-2 mb-3">
                                    <Paperclip className="w-4 h-4 text-400" />
                                    Attachments
                                    <span className="text-400 font-normal">({localAttachments.length})</span>
                                </Label>
                                <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border border-dashed border-300 rounded-xl p-6 text-center hover:bg-50 hover:border-indigo-300 transition cursor-pointer bg-50/30"
                                >
                                    <div className="w-10 h-10 bg-card rounded-full flex items-center justify-center mx-auto shadow-sm border border-100 mb-2">
                                        <Paperclip className="w-4 h-4 text-400" />
                                    </div>
                                    <p className="text-sm font-medium text-600">
                                        {uploadMutation.isPending ? 'Uploading...' : 'Click to add attachments'}
                                    </p>
                                </div>                                {localAttachments.length > 0 && (
                                    <div className="mt-3 grid gap-2">
                                        {localAttachments.map((file: TaskAttachment, index: number) => {
                                            const fileUrl = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/${(file.url || '').replace(/^\//, '')}`;
                                            const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file.name || file.url || '');
                                            return (
                                                <div key={index} className="flex items-center gap-3 p-2.5 bg-card border border-200 rounded-xl hover:border-300 transition">
                                                    {/* Thumbnail or icon */}
                                                    {isImage ? (
                                                        <div
                                                            className="shrink-0 cursor-zoom-in"
                                                            onClick={(e) => { e.stopPropagation(); window.open(fileUrl, '_blank'); }}
                                                        >
                                                            <img
                                                                src={fileUrl}
                                                                alt={file.name}
                                                                className="w-14 h-14 rounded-lg object-cover border border-100 hover:opacity-80 transition-opacity"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                                                            <Paperclip className="w-4 h-4 text-indigo-500" />
                                                        </div>
                                                    )}
                                                    {/* Filename ?" opens in new tab without closing dialog */}
                                                    <span
                                                        className="flex-1 min-w-0 text-sm font-medium text-700 truncate hover:text-indigo-600 transition-colors cursor-pointer"
                                                        onClick={(e) => { e.stopPropagation(); window.open(fileUrl, '_blank'); }}
                                                    >
                                                        {file.name}
                                                    </span>
                                                    {/* Delete button */}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            const updatedAttachments = localAttachments.filter((a: TaskAttachment) => a.url !== file.url);
                                                            setLocalAttachments(updatedAttachments);
                                                            mutation.mutate({ attachments: updatedAttachments });
                                                        }}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        className="w-8 h-8 flex items-center justify-center rounded-lg text-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Activity Section */}
                            <div>
                                <Label className="text-sm font-semibold text-700 flex items-center gap-2 mb-4">
                                    <Activity className="w-4 h-4 text-400" />
                                    Activity
                                </Label>
                                <div className="space-y-4 mb-4 min-h-[100px]">
                                    {(!comments || comments.length === 0) && (
                                        <div className="text-400 text-sm text-center py-4 bg-50 rounded-xl">No comments yet.</div>
                                    )}
                                    {comments?.map((comment: Record<string, unknown>) => (
                                        <div key={String(comment.id)} className="flex gap-3">
                                            <Avatar className="w-8 h-8 shrink-0">
                                                <AvatarImage src={`${import.meta.env.VITE_API_URL}${comment.profile_picture}`} className="object-cover" />
                                                <AvatarFallback className="bg-100 text-600 text-xs font-semibold">{String(comment.username || '')?.[0]}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-semibold text-700">{String(comment.username || '')}</span>
                                                    <span className="text-xs text-400">
                                                        {new Date(String(comment.created_at || '')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-600 bg-card border border-100 p-3 rounded-xl rounded-tl-sm shadow-sm inline-block max-w-full">
                                                    {String(comment.content || '')}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={commentsEndRef} />
                                </div>
                                <div className="flex gap-2">
                                    <Textarea
                                        placeholder="Write a comment..."
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        className="resize-none min-h-[40px] max-h-[120px] rounded-xl focus-visible:ring-indigo-100"
                                        rows={1}
                                    />
                                    <Button
                                        size="icon"
                                        onClick={() => commentMutation.mutate()}
                                        disabled={!newComment.trim() || commentMutation.isPending}
                                        className="shrink-0 rounded-xl bg-indigo-600 hover:bg-indigo-700"
                                    >
                                        <Send className="w-4 h-4 text-white" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Sidebar: Metadata & Controls */}
                    <div className="w-full sm:w-72 bg-50/50 p-6 sm:p-8 flex flex-col gap-6 overflow-y-auto">

                        {/* Priority Section */}
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold text-500 uppercase tracking-wider">Priority</Label>
                            <Select
                                value={formData.priority}
                                onValueChange={(val) => {
                                    const sanitizedAssignees = (formData.assignees || []).filter((id) => assignableMemberIds.has(id));
                                    setFormData(prev => ({ ...prev, priority: val }));
                                    mutation.mutate({ ...formData, priority: val, assignees: sanitizedAssignees });
                                }}
                            >
                                <SelectTrigger className="w-full bg-card h-10 border-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="low">Low</SelectItem>
                                    <SelectItem value="medium">Medium</SelectItem>
                                    <SelectItem value="high">High</SelectItem>
                                    <SelectItem value="urgent">Urgent</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Assignees Section */}
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold text-500 uppercase tracking-wider">Assignees</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start h-auto min-h-[40px] bg-card border-200 py-2 px-3 font-normal overflow-hidden">
                                        {formData.assignees && formData.assignees.length > 0 ? (
                                            <div className="flex flex-wrap gap-1.5">
                                                {formData.assignees.map(id => {
                                                    const user = members?.find((m: TaskMember) => m.id === id);
                                                    return user ? (
                                                        <div key={id} className="flex items-center gap-1.5 bg-100 text-700 px-2 py-0.5 rounded-md text-xs font-medium max-w-full">
                                                            <Avatar className="w-4 h-4 shrink-0">
                                                                <AvatarImage src={`${import.meta.env.VITE_API_URL}${user.profile_picture}`} />
                                                                <AvatarFallback>{user.username?.[0]}</AvatarFallback>
                                                            </Avatar>
                                                            <span className="truncate">{user.username}</span>
                                                        </div>
                                                    ) : null;
                                                })}
                                            </div>
                                        ) : <span className="text-400">Add assignees...</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-2 bg-card rounded-xl shadow-lg border-200" align="end">
                                    <div className="grid max-h-[250px] overflow-y-auto">
                                            {members?.map((m: TaskMember) => {
                                                const memberId = Number(m.id);
                                                const isSelected = (formData.assignees || []).includes(memberId);
                                                return (
                                                    <div
                                                        key={memberId}
                                                        className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-50 transition-colors"
                                                        onClick={() => {
                                                            setFormData((prev) => {
                                                                const current = (prev.assignees || [])
                                                                    .map((id) => Number(id))
                                                                    .filter((id) => Number.isInteger(id) && id > 0);

                                                                const next = current.includes(memberId)
                                                                    ? current.filter((id) => id !== memberId)
                                                                    : [...current, memberId];

                                                                return { ...prev, assignees: next };
                                                            });
                                                        }}
                                                    >
                                                    <div className={cn(
                                                        "w-4 h-4 border rounded flex items-center justify-center transition",
                                                        isSelected ? "bg-indigo-600 border-indigo-600" : "border-300"
                                                    )}>
                                                        {isSelected && <Check className="w-3 h-3 text-white" />}
                                                    </div>
                                                    <Avatar className="w-6 h-6">
                                                        <AvatarImage src={`${import.meta.env.VITE_API_URL}${m.profile_picture}`} className="object-cover" />
                                                        <AvatarFallback className="text-[10px]">{m.username?.[0]}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="text-sm text-700 truncate">{m.username}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
