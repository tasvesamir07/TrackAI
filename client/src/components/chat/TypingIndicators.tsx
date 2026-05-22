import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useTypingUsers } from './typingStore';

type ConversationUser = {
    id: number | string;
    username: string;
    profile_picture?: string;
    type?: 'team' | 'direct' | 'group';
};

type SharedProps = {
    conversationId: string;
    conversations: ConversationUser[];
    getAssetUrl: (path?: string | null) => string;
};

export const ConversationTypingPreview = React.memo(function ConversationTypingPreview({
    conversationId,
    conversations,
    getAssetUrl,
    isGroup,
    fallbackText,
    unreadCount
}: SharedProps & {
    isGroup: boolean;
    fallbackText: string;
    unreadCount: number;
}) {
    const typingUsers = useTypingUsers(conversationId);

    if (typingUsers.size === 0) {
        return (
            <p
                className={`text-xs truncate max-w-[180px] transition duration-200 ${unreadCount > 0
                    ? 'text-slate-800 font-semibold'
                    : 'text-slate-500'
                    }`}
            >
                {fallbackText}
            </p>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            {isGroup && (
                <div className="flex -space-x-1 overflow-hidden">
                    {Array.from(typingUsers).slice(0, 3).map((uid) => {
                        const user = conversations.find((c) => String(c.id) === String(uid));
                        if (!user) return null;

                        return (
                            <Avatar key={uid} className="w-3.5 h-3.5 border border-white">
                                {user.profile_picture && (
                                    <AvatarImage src={getAssetUrl(user.profile_picture)} className="object-cover" loading="lazy" />
                                )}
                                <AvatarFallback className="text-[6px] bg-slate-200">{user.username[0]}</AvatarFallback>
                            </Avatar>
                        );
                    })}
                </div>
            )}
            <div className="flex items-center gap-0.5">
                <span className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce"></span>
            </div>
        </div>
    );
});

export const MessageTypingIndicator = React.memo(function MessageTypingIndicator({
    conversationId,
    conversations,
    getAssetUrl,
    isGroup
}: SharedProps & { isGroup: boolean }) {
    const typingUsers = useTypingUsers(conversationId);

    if (typingUsers.size === 0) return null;

    return (
        <div className="flex items-center gap-2 ml-4 animate-in fade-in slide-in-from-bottom-2">
            {isGroup && (
                <div className="flex -space-x-2 overflow-hidden mr-1">
                    {Array.from(typingUsers).slice(0, 3).map((uid) => {
                        const user = conversations.find((c) => String(c.id) === String(uid));
                        if (!user) return null;

                        return (
                            <Avatar key={uid} className="w-5 h-5">
                                {user.profile_picture && (
                                    <AvatarImage
                                        src={getAssetUrl(user.profile_picture)}
                                        alt={user.username}
                                        className="object-cover"
                                        loading="lazy"
                                    />
                                )}
                                <AvatarFallback className="text-[8px] bg-slate-200 text-slate-600 font-bold">
                                    {user.username.charAt(0).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                        );
                    })}
                </div>
            )}

            <div className="bg-slate-200/50 p-3 rounded-2xl rounded-tl-sm flex items-center gap-1 shadow-sm">
                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"></span>
            </div>
        </div>
    );
});
