import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from '@/context/AuthContext';

interface Category {
    id: number;
    name: string;
}

interface UserData {
    id: number;
    username: string;
    role: string;
    profile_picture?: string | null;
    categories?: string[];
}

interface CallInviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selectedCategoryIds: number[], selectedUserIds: number[]) => void;
    title?: string;
    showUsers?: boolean;
    showCategories?: boolean;
}

export default function CallInviteModal({
    isOpen,
    onClose,
    onConfirm,
    title = "Select Participants",
    showUsers = true,
    showCategories = true
}: CallInviteModalProps) {
    const { user } = useAuth();
    const apiBaseUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    const [searchQuery, setSearchQuery] = useState("");
    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

    const { data } = useQuery({
        queryKey: ['call-invite-data'],
        queryFn: async () => {
            const userResPromise = api.get('/auth/colleagues');
            const catResPromise = user?.role === 'admin'
                ? api.get('/admin/categories')
                : Promise.resolve({ data: [] as Category[] });
            const [catRes, userRes] = await Promise.all([catResPromise, userResPromise]);
            return {
                categories: (catRes.data || []) as Category[],
                users: (userRes.data || []) as UserData[],
            };
        },
        enabled: isOpen,
        staleTime: 60_000,
    });

    const categories = data?.categories || [];
    const users = data?.users || [];

    const toggleCategory = (id: number) => {
        setSelectedCategoryIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleUser = (id: number) => {
        setSelectedUserIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const filteredCategories = categories.filter(c =>
        c.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
    );

    const filteredUsers = users.filter(u =>
        u.username.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
    );

    const handleConfirm = () => {
        onConfirm(selectedCategoryIds, selectedUserIds);
        setSelectedCategoryIds([]);
        setSelectedUserIds([]);
        setSearchQuery("");
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden bg-card/95 backdrop-blur-xl border-200 shadow-2xl rounded-3xl">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="text-xl font-bold text-900 flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-600" />
                        {title}
                    </DialogTitle>
                </DialogHeader>

                <div className="px-6 py-2">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-400 group-focus-within:text-indigo-500 transition-colors" />
                        <Input
                            placeholder="Search categories or fans..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 bg-50 border-200 rounded-xl focus-visible:ring-indigo-500/20 h-10"
                        />
                    </div>
                </div>

                <ScrollArea className="h-[400px] px-6 py-2">
                    <div className="space-y-6">
                        {showCategories && categories.length > 0 && (
                            <div>
                                <h4 className="text-xs font-bold text-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    Categories
                                    {/* Divider */}
                                    <div className="h-px flex-1 bg-100" />
                                </h4>
                                <div className="grid grid-cols-2 gap-2">
                                    {filteredCategories.map(category => (
                                        <button
                                            key={category.id}
                                            onClick={() => toggleCategory(category.id)}
                                            className={cn(
                                                "flex items-center justify-between p-3 rounded-xl border text-sm font-medium transition duration-200",
                                                selectedCategoryIds.includes(category.id)
                                                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm"
                                                    : "bg-card border-200 text-600 hover:border-indigo-300 hover:bg-50"
                                            )}
                                        >
                                            <span className="truncate">{category.name}</span>
                                            {selectedCategoryIds.includes(category.id) && (
                                                <div className="bg-indigo-600 rounded-full p-0.5 animate-in zoom-in">
                                                    <Check className="w-3 h-3 text-white" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {showUsers && (
                            <div>
                                <h4 className="text-xs font-bold text-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    People
                                    {/* Divider */}
                                    <div className="h-px flex-1 bg-100" />
                                </h4>
                                <div className="space-y-1">
                                    {filteredUsers.map(u => (
                                        <button
                                            key={u.id}
                                            onClick={() => toggleUser(u.id)}
                                            className={cn(
                                                "w-full flex items-center gap-3 p-2 rounded-xl border transition duration-200",
                                                selectedUserIds.includes(u.id)
                                                    ? "bg-indigo-50 border-indigo-200 shadow-sm"
                                                    : "bg-transparent border-transparent hover:bg-50"
                                            )}
                                        >
                                            <div className="relative">
                                                <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                                                    {u.profile_picture && (
                                                        <AvatarImage
                                                            src={`${apiBaseUrl}${u.profile_picture}`}
                                                            className="object-cover"
                                                        />
                                                    )}
                                                    <AvatarFallback className="bg-linear-to-br from-indigo-500 to-purple-600 text-white font-bold">
                                                        {u.username.charAt(0).toUpperCase()}
                                                    </AvatarFallback>
                                                </Avatar>
                                                {selectedUserIds.includes(u.id) && (
                                                    <div className="absolute -top-1 -right-1 bg-indigo-600 rounded-full p-1 border-2 border-white animate-in zoom-in">
                                                        <Check className="w-2 h-2 text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 text-left min-w-0">
                                                <div className="font-semibold text-900 truncate">{u.username}</div>
                                                <div className="text-[10px] text-500 truncate">{u.role}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                <DialogFooter className="p-6 bg-50/50 border-t border-100 flex-row gap-2">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                        className="flex-1 rounded-xl"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        className="flex-1 rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-200 transition duration-300"
                        disabled={selectedCategoryIds.length === 0 && selectedUserIds.length === 0}
                    >
                        Send Invites
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
