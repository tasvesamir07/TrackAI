import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Users, Calendar, ChevronRight, MoreVertical, Trash2, ArrowLeft, FolderKanban, Edit3 } from 'lucide-react';
import { format } from 'date-fns';
import ProjectBoard from '@/components/ProjectBoard';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function getAvatarSrc(path?: string | null) {
    if (!path) return undefined;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

interface Project {
    id: number;
    name: string;
    description: string;
    status: 'active' | 'archived' | 'completed';
    created_at: string;
    member_count: number;
    creator_name: string;
    user_role?: string;
    member_preview?: User[];
}

interface User {
    id: number;
    username: string;
    profile_picture?: string;
    role?: 'admin' | 'moderator' | 'employee';
    account_role?: string;
}

interface ProjectDetails {
    members: User[];
}

function sameNumberArray(a: number[], b: number[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export default function Projects() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const canManageProjects = user?.role === 'COMPANY_ADMIN' || user?.role === 'moderator';
    const canDeleteProjects = user?.role === 'COMPANY_ADMIN' || user?.role === 'moderator';
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
    const [isManageMembersOpen, setIsManageMembersOpen] = useState(false);
    const [isManageMembersDirty, setIsManageMembersDirty] = useState(false);
    const [newProject, setNewProject] = useState({ name: '', description: '', member_ids: [] as number[] });
    const [editProject, setEditProject] = useState({ name: '', description: '', status: 'active' as Project['status'] });
    const [manageMemberIds, setManageMemberIds] = useState<number[]>([]);
    const [isSavingMembers, setIsSavingMembers] = useState(false);

    const resetNewProject = () => {
        setNewProject({ name: '', description: '', member_ids: [] });
    };

    const { data: projects, isLoading } = useQuery({
        queryKey: ['projects', user?.id, user?.role],
        queryFn: async () => {
            const res = await api.get('/projects');
            return res.data;
        },
        enabled: !!user?.id
    });

    const selectedProjectId = Number(searchParams.get('project'));
    const selectedProject = projects?.find((project: Project) => project.id === selectedProjectId) || null;

    const setSelectedProjectId = (projectId: number | null) => {
        const nextParams = new URLSearchParams(searchParams);

        if (projectId === null) {
            nextParams.delete('project');
        } else {
            nextParams.set('project', String(projectId));
        }

        setSearchParams(nextParams);
    };

    const { data: selectedProjectDetails } = useQuery<ProjectDetails | null>({
        queryKey: ['project-details', user?.id, selectedProject?.id],
        queryFn: async () => {
            if (!selectedProject) return null;
            const res = await api.get(`/projects/${selectedProject.id}`);
            return res.data;
        },
        enabled: !!selectedProject
    });

    const createMutation = useMutation({
        mutationFn: async (data: typeof newProject) => {
            return api.post('/projects', data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            setIsCreateModalOpen(false);
            resetNewProject();
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            return api.delete(`/projects/${id}`);
        },
        onSuccess: (_data, id) => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            if (selectedProject?.id === id) setSelectedProjectId(null);
        }
    });

    const updateMutation = useMutation({
        mutationFn: async (data: { id: number; name: string; description: string; status: Project['status'] }) => {
            return api.put(`/projects/${data.id}`, {
                name: data.name,
                description: data.description,
                status: data.status
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            queryClient.invalidateQueries({ queryKey: ['project-details', selectedProject?.id] });
            setIsEditProjectOpen(false);
        }
    });

    // --- Members Management ---
    const { data: allUsers = [] } = useQuery<User[]>({
        queryKey: ['users'],
        queryFn: async () => {
            const res = await api.get('/admin/users');
            return res.data;
        },
        enabled: (isManageMembersOpen || isCreateModalOpen) && canManageProjects
    });

    const addMemberMutation = useMutation({
        mutationFn: async ({ projectId, userId }: { projectId: number, userId: number }) => {
            return api.post(`/projects/${projectId}/members`, { user_id: userId });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project-details', selectedProject?.id] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
        }
    });

    const removeMemberMutation = useMutation({
        mutationFn: async ({ projectId, userId }: { projectId: number, userId: number }) => {
            return api.delete(`/projects/${projectId}/members/${userId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['project-details', selectedProject?.id] });
            queryClient.invalidateQueries({ queryKey: ['projects'] });
        }
    });

    const projectMembers: User[] = selectedProjectDetails?.members || [];
    const projectEmployeeMemberIds = (projectMembers || [])
        .filter((member: User) => (member.account_role || member.role) === 'employee')
        .map((member) => member.id);
    const headerMembers: User[] = selectedProjectDetails?.members || selectedProject?.member_preview || [];
    const visibleSelectedMembers = headerMembers.slice(0, 5);
    const headerMemberCount = selectedProjectDetails?.members?.length ?? selectedProject?.member_count ?? 0;
    const remainingSelectedMembers = Math.max(headerMemberCount - visibleSelectedMembers.length, 0);
    const manageableUsers = allUsers.filter((member) => member.role === 'employee');
    const assignableUsers = manageableUsers.filter((member) => member.id !== user?.id);

    useEffect(() => {
        if (!isManageMembersOpen) return;
        if (isManageMembersDirty) return;
        setManageMemberIds((prev) => (
            sameNumberArray(prev, projectEmployeeMemberIds) ? prev : projectEmployeeMemberIds
        ));
    }, [isManageMembersOpen, isManageMembersDirty, projectEmployeeMemberIds]);

    if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading projects...</div>;

    if (selectedProject) {
        return (
            <div className="h-full flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10 gap-3 sm:gap-4">
                    <div className="flex items-center gap-2 sm:gap-4 min-w-0 w-full sm:w-auto">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedProjectId(null)} className="shrink-0 px-2 sm:px-3">
                            <ChevronRight className="w-4 h-4 rotate-180 sm:mr-1" />
                            <span className="hidden sm:inline">Back</span>
                        </Button>
                        <div className="min-w-0">
                            <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">{selectedProject.name}</h1>
                            <p className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-[500px]">{selectedProject.description}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                        {canManageProjects && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setEditProject({
                                        name: selectedProject.name || '',
                                        description: selectedProject.description || '',
                                        status: selectedProject.status || 'active'
                                    });
                                    setIsEditProjectOpen(true);
                                }}
                                className="shrink-0"
                            >
                                <Edit3 className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">Edit</span>
                            </Button>
                        )}
                        {canManageProjects && (
                            <Button variant="outline" size="sm" onClick={() => {
                                setIsManageMembersDirty(false);
                                setManageMemberIds(projectEmployeeMemberIds);
                                setIsManageMembersOpen(true);
                            }} className="shrink-0">
                                <Users className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">Members</span>
                            </Button>
                        )}
                        <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                            <div className="flex -space-x-2">
                                {visibleSelectedMembers.map((member: User) => (
                                    <Avatar key={member.id} className="w-6 h-6 sm:w-8 sm:h-8 border-2 border-white shadow-sm">
                                        <AvatarImage src={getAvatarSrc(member.profile_picture)} />
                                        <AvatarFallback className="text-[10px] sm:text-xs">{member.username?.[0]?.toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                ))}
                                {remainingSelectedMembers > 0 && (
                                    <span className="flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-muted text-[10px] sm:text-xs border-2 border-white text-muted-foreground font-medium">
                                        +{remainingSelectedMembers}
                                    </span>
                                )}
                            </div>
                            <span className="text-sm text-muted-foreground hidden sm:inline">{headerMemberCount} members</span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    <ProjectBoard project={selectedProject} />
                </div>
                {/* Manage Members Modal */}
                <Dialog open={isManageMembersOpen} onOpenChange={(open) => {
                    if (open) {
                        setIsManageMembersDirty(false);
                        setManageMemberIds(projectEmployeeMemberIds);
                    }
                    if (!open) {
                        setIsManageMembersDirty(false);
                    }
                    setIsManageMembersOpen(open);
                }}>
                    <DialogContent className="sm:max-w-[425px] bg-card/95 backdrop-blur-xl border border-indigo-100 shadow-2xl p-0 overflow-hidden">
                        <div className="bg-linear-to-r from-indigo-500 to-indigo-700 p-6 text-left">
                            <DialogTitle className="text-xl font-bold text-white mb-2">Manage Members</DialogTitle>
                            <DialogDescription className="text-indigo-100 flex items-center justify-between">
                                Add or remove members from this project.
                            </DialogDescription>
                        </div>
                        <div className="p-6">
                            <ScrollArea className="h-[320px] pr-4 -mr-4">
                                <div className="space-y-3 pr-4">
                                    {manageableUsers.map((u) => {
                                        const isSelected = manageMemberIds.includes(u.id);
                                        return (
                                            <div 
                                                key={u.id} 
                                                className={`flex items-center justify-between p-3 rounded-xl border transition duration-200 cursor-pointer ${isSelected ? 'bg-indigo-50/70 border-indigo-200 shadow-sm' : 'bg-card border-border/50 hover:border-border hover:bg-muted'}`}
                                                onClick={() => {
                                                    setIsManageMembersDirty(true);
                                                    setManageMemberIds(prev => 
                                                        prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                                                    );
                                                }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Avatar className={`w-10 h-10 border-2 transition-colors ${isSelected ? 'border-indigo-200' : 'border-transparent'}`}>
                                                        <AvatarImage src={getAvatarSrc(u.profile_picture)} />
                                                        <AvatarFallback className="bg-muted text-indigo-700 font-medium">{u.username[0]?.toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="flex flex-col">
                                                        <span className={`text-sm font-semibold ${isSelected ? 'text-indigo-900' : 'text-foreground'}`}>{u.username}</span>
                                                        <span className="text-xs text-muted-foreground capitalize">{u.role || 'Member'}</span>
                                                    </div>
                                                </div>
                                                <Checkbox
                                                    checked={isSelected}
                                                    onChange={(e) => {
                                                        setIsManageMembersDirty(true);
                                                        const checked = e.target.checked;
                                                        if (checked) {
                                                            setManageMemberIds(prev => [...prev, u.id]);
                                                        } else {
                                                            setManageMemberIds(prev => prev.filter(id => id !== u.id));
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-5 h-5 rounded-md border-slate-300 checked:bg-indigo-600 checked:border-indigo-600"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                            <DialogFooter className="mt-6 pt-4 border-t border-border/50/50 flex gap-2 sm:justify-end">
                                <Button variant="ghost" onClick={() => setIsManageMembersOpen(false)} className="hover:bg-muted text-muted-foreground">
                                    Cancel
                                </Button>
                                <Button 
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 px-6 transition active:scale-95" 
                                    disabled={isSavingMembers}
                                    onClick={async () => {
                                        setIsSavingMembers(true);
                                        const originalIds = projectEmployeeMemberIds;
                                        const toAdd = manageMemberIds.filter(id => !originalIds.includes(id));
                                        const toRemove = originalIds.filter(id => !manageMemberIds.includes(id));
                                        
                                        try {
                                            const promises = [];
                                            for (const id of toAdd) {
                                                promises.push(addMemberMutation.mutateAsync({ projectId: selectedProject.id, userId: id }));
                                            }
                                            for (const id of toRemove) {
                                                promises.push(removeMemberMutation.mutateAsync({ projectId: selectedProject.id, userId: id }));
                                            }
                                            await Promise.all(promises);
                                            queryClient.invalidateQueries({ queryKey: ['project-details', selectedProject.id] });
                                            queryClient.invalidateQueries({ queryKey: ['projects'] });
                                        } finally {
                                            setIsSavingMembers(false);
                                            setIsManageMembersDirty(false);
                                            setIsManageMembersOpen(false);
                                        }
                                    }}
                                >
                                    {isSavingMembers ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </DialogFooter>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Edit Project Modal */}
                <Dialog open={isEditProjectOpen} onOpenChange={setIsEditProjectOpen}>
                    <DialogContent 
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        className="sm:max-w-[480px] bg-card/95 backdrop-blur-xl border border-indigo-100 shadow-2xl p-0 overflow-hidden"
                    >
                        <div className="bg-linear-to-r from-indigo-500 via-indigo-600 to-purple-600 p-6">
                            <DialogHeader className="space-y-1">
                                <DialogTitle className="text-xl font-bold text-white flex items-center gap-2.5">
                                    <div className="p-1.5 bg-card/15 rounded-lg backdrop-blur-sm">
                                        <Edit3 className="w-4 h-4 text-white" />
                                    </div>
                                    Edit Project
                                </DialogTitle>
                                <DialogDescription className="text-indigo-100/90 text-sm">
                                    Update project details and description.
                                </DialogDescription>
                            </DialogHeader>
                        </div>
                        <div className="p-6 space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="edit-project-name" className="text-sm font-semibold text-foreground">Project Name</Label>
                                <Input
                                    id="edit-project-name"
                                    value={editProject.name}
                                    onChange={(e) => setEditProject((prev) => ({ ...prev, name: e.target.value }))}
                                    className="h-11 rounded-xl border-border bg-muted/50 focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="edit-project-description" className="text-sm font-semibold text-foreground">Description</Label>
                                <Textarea
                                    id="edit-project-description"
                                    value={editProject.description}
                                    onChange={(e) => setEditProject((prev) => ({ ...prev, description: e.target.value }))}
                                    className="min-h-[100px] rounded-xl border-border bg-muted/50 focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition resize-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="edit-project-status" className="text-sm font-semibold text-foreground">Status</Label>
                                <select
                                    id="edit-project-status"
                                    value={editProject.status}
                                    onChange={(e) => setEditProject((prev) => ({ ...prev, status: e.target.value as Project['status'] }))}
                                    className="h-11 w-full rounded-xl border border-border bg-muted/50 px-3 text-sm outline-none focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
                                >
                                    <option value="active">active</option>
                                    <option value="archived">archived</option>
                                    <option value="completed">completed</option>
                                </select>
                            </div>
                        </div>
                        <DialogFooter className="px-6 pb-6 flex gap-2 sm:justify-end border-t border-border/50/50 pt-4 mt-0">
                            <Button
                                variant="ghost"
                                onClick={() => setIsEditProjectOpen(false)}
                                className="hover:bg-muted text-muted-foreground"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={() => {
                                    if (!selectedProject) return;
                                    updateMutation.mutate({
                                        id: selectedProject.id,
                                        name: editProject.name.trim(),
                                        description: editProject.description,
                                        status: editProject.status
                                    });
                                }}
                                disabled={!editProject.name.trim() || updateMutation.isPending}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 px-6 transition active:scale-95"
                            >
                                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
</div>
        );
    }

    const cardAccents = [
        'from-indigo-500 to-purple-500',
        'from-emerald-500 to-teal-500',
        'from-amber-500 to-orange-500',
        'from-rose-500 to-pink-500',
        'from-cyan-500 to-blue-500',
        'from-violet-500 to-fuchsia-500',
    ];

    return (
        <div className="min-h-screen animate-in fade-in duration-500">
            {/* Hero Header */}
            <div className="relative overflow-hidden bg-linear-to-br from-indigo-600 via-indigo-700 to-purple-800 px-4 py-6 sm:px-8 sm:py-10">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAgTSAwIDIwIEwgNDAgMjAgTSAyMCAwIEwgMjAgNDAgTSAwIDMwIEwgNDAgMzAgTSAzMCAwIEwgMzAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50" />
                <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-400/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
                
                <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(
                                user?.role === 'employee'
                                    ? '/dashboard'
                                    : user?.role === 'moderator'
                                        ? '/project-manager'
                                        : '/admin'
                            )}
                            className="rounded-full bg-card/10 hover:bg-card/20 text-white border border-white/10 backdrop-blur-sm shrink-0"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2 sm:gap-3">
                                <div className="p-1.5 sm:p-2 bg-card/10 rounded-xl backdrop-blur-sm border border-white/10">
                                    <FolderKanban className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                                </div>
                                Projects
                            </h1>
                            <p className="text-indigo-200 mt-1 sm:mt-1.5 ml-11 sm:ml-14 text-sm sm:text-base">Manage tasks and track progress together.</p>
                        </div>
                    </div>
                    {canManageProjects && (
                        <Button onClick={() => setIsCreateModalOpen(true)} className="bg-card text-indigo-700 hover:bg-indigo-50 shadow-lg shadow-black/10 hover:shadow-xl transition font-semibold px-4 sm:px-5 w-full sm:w-auto active:scale-95">
                            <Plus className="w-4 h-4 mr-2 shrink-0" />
                            New Project
                        </Button>
                    )}
                </div>
            </div>

            {/* Project Cards */}
            <div className="p-8">
                {projects?.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="p-5 bg-indigo-50 rounded-2xl mb-5">
                            <FolderKanban className="w-12 h-12 text-indigo-400" />
                        </div>
                        <h3 className="text-xl font-bold text-foreground mb-2">No projects yet</h3>
                        <p className="text-muted-foreground max-w-sm mb-6">Create your first project to start collaborating with your team and tracking progress.</p>
                        {canManageProjects && (
                            <Button onClick={() => setIsCreateModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 px-6">
                                <Plus className="w-4 h-4 mr-2" />
                                Create First Project
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {projects?.map((project: Project, index: number) => (
                            <Card
                                key={project.id}
                                className="group hover:shadow-2xl hover:-translate-y-1 transition duration-300 cursor-pointer border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden relative"
                                onClick={() => setSelectedProjectId(project.id)}
                            >
                                {/* Colored accent strip */}
                                <div className={`h-1.5 bg-linear-to-r ${cardAccents[index % cardAccents.length]}`} />
                                
                                <CardHeader className="pb-3 pt-5">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1.5 flex-1 min-w-0">
                                            <CardTitle className="text-lg font-bold text-foreground group-hover:text-indigo-600 transition-colors flex items-center gap-2">
                                                {project.name}
                                                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition opacity-0 group-hover:opacity-100" />
                                            </CardTitle>
                                            <CardDescription className="line-clamp-2 text-sm">
                                                {project.description || "No description provided"}
                                            </CardDescription>
                                        </div>
                                        {canDeleteProjects && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1 -mr-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                                        <MoreVertical className="w-4 h-4 text-muted-foreground/70" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem className="text-red-600" onClick={(e) => {
                                                        e.stopPropagation();
                                                        deleteMutation.mutate(project.id);
                                                    }}>
                                                        <Trash2 className="w-4 h-4 mr-2" />
                                                        Delete Project
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="pb-5">
                                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/50">
                                        <div className="flex items-center gap-4">
                                            <div className="flex items-center -space-x-2">
                                                {project.member_preview?.slice(0, 4).map((member) => (
                                                    <Avatar key={member.id} className="w-7 h-7 border-2 border-white shadow-sm ring-1 ring-slate-100">
                                                        <AvatarImage src={getAvatarSrc(member.profile_picture)} />
                                                        <AvatarFallback className="text-[10px] bg-indigo-50 text-indigo-600 font-medium">
                                                            {member.username?.[0]?.toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                ))}
                                                {project.member_count > (project.member_preview?.length || 0) && (
                                                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-50 text-[10px] border-2 border-white text-indigo-600 font-semibold ring-1 ring-slate-100">
                                                        +{project.member_count - (project.member_preview?.length || 0)}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="flex items-center gap-1.5 font-medium">
                                                <Users className="w-3.5 h-3.5 text-indigo-400" />
                                                {project.member_count}
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Calendar className="w-3.5 h-3.5 text-muted-foreground/70" />
                                                {format(new Date(project.created_at), 'MMM d, yyyy')}
                                            </span>
                                        </div>
                                        <Badge variant={project.status === 'active' ? 'default' : 'secondary'} className={
                                            project.status === 'active' 
                                                ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 font-semibold border border-emerald-200/50' 
                                                : 'font-semibold'
                                        }>
                                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${project.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                                            {project.status}
                                        </Badge>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Project Modal */}
            <Dialog
                open={isCreateModalOpen}
                onOpenChange={(open) => {
                    setIsCreateModalOpen(open);
                    if (!open) resetNewProject();
                }}
            >
                <DialogContent className="sm:max-w-[480px] bg-card/95 backdrop-blur-xl border border-indigo-100 shadow-2xl p-0 overflow-hidden">
                    <div className="bg-linear-to-r from-indigo-500 via-indigo-600 to-purple-600 p-6">
                        <DialogHeader className="space-y-1">
                            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2.5">
                                <div className="p-1.5 bg-card/15 rounded-lg backdrop-blur-sm">
                                    <Plus className="w-4 h-4 text-white" />
                                </div>
                                Create New Project
                            </DialogTitle>
                            <DialogDescription className="text-indigo-100/90 text-sm">
                                Start a new project and assign your team.
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    <div className="p-6 space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="name" className="text-sm font-semibold text-foreground">Project Name</Label>
                            <Input
                                id="name"
                                value={newProject.name}
                                onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="e.g. Website Redesign"
                                className="h-11 rounded-xl border-border bg-muted/50 focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-muted-foreground/70"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description" className="text-sm font-semibold text-foreground">Description <span className="font-normal text-muted-foreground/70">(Optional)</span></Label>
                            <Textarea
                                id="description"
                                value={newProject.description}
                                onChange={(e) => setNewProject(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Briefly describe the project goals..."
                                className="min-h-[80px] rounded-xl border-border bg-muted/50 focus:bg-card focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-muted-foreground/70 resize-none"
                            />
                        </div>
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-sm font-semibold text-foreground">Assign Members</Label>
                                {newProject.member_ids.length > 0 && (
                                    <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100 font-semibold text-xs px-2.5 py-0.5 rounded-full">
                                        {newProject.member_ids.length} selected
                                    </Badge>
                                )}
                            </div>
                            <ScrollArea className="h-[220px] rounded-xl border border-border/80 bg-muted/30 pr-1">
                                <div className="space-y-2 p-3">
                                    {assignableUsers.map((member: User) => {
                                        const checked = newProject.member_ids.includes(member.id);
                                        return (
                                            <label 
                                                key={member.id} 
                                                className={`flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition duration-200 ${
                                                    checked 
                                                        ? 'bg-indigo-50/80 border-indigo-200 shadow-sm shadow-indigo-100/50' 
                                                        : 'bg-card border-border/50 hover:border-border hover:bg-muted/80 hover:shadow-sm'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <Avatar className={`w-10 h-10 border-2 transition-colors ${checked ? 'border-indigo-200' : 'border-transparent'}`}>
                                                        <AvatarImage src={getAvatarSrc(member.profile_picture)} />
                                                        <AvatarFallback className="bg-muted text-indigo-700 font-medium text-sm">{member.username?.[0]?.toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className={`text-sm font-semibold truncate ${checked ? 'text-indigo-900' : 'text-foreground'}`}>{member.username}</p>
                                                        <p className="text-xs text-muted-foreground capitalize">{member.role || 'member'}</p>
                                                    </div>
                                                </div>
                                                <Checkbox
                                                    checked={checked}
                                                    onChange={(e) => {
                                                        const nextChecked = e.target.checked;
                                                        setNewProject((prev) => ({
                                                            ...prev,
                                                            member_ids: nextChecked
                                                                ? [...prev.member_ids, member.id]
                                                                : prev.member_ids.filter((id) => id !== member.id)
                                                        }));
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-5 h-5 rounded-md border-slate-300 checked:bg-indigo-600 checked:border-indigo-600"
                                                />
                                            </label>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                    <DialogFooter className="px-6 pb-6 flex gap-2 sm:justify-end border-t border-border/50/50 pt-4 mt-0">
                        <Button 
                            variant="ghost" 
                            onClick={() => setIsCreateModalOpen(false)}
                            className="hover:bg-muted text-muted-foreground"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => createMutation.mutate(newProject)}
                            disabled={!newProject.name || createMutation.isPending}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 px-6 transition active:scale-95"
                        >
                            {createMutation.isPending ? 'Creating...' : 'Create Project'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
