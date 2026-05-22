import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo, lazy, Suspense } from 'react';
import throttle from 'lodash/throttle';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Search, MoreVertical, Users as UsersIcon, Bell, BellOff, Smile, Paperclip, Trash2, Edit2, Check, CheckCheck, Copy, Forward as ForwardIcon, Phone, Video, Mic, StopCircle, PhoneOff, VideoOff, Clock, X, Plus, ArrowLeft } from 'lucide-react';
import api from '@/lib/api';
import { syncAppIconBadge } from '@/lib/pushNotifications';
import { format, isToday, isYesterday } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSocket } from '@/context/SocketContext';
import { Toast } from '@/components/ui/Toast';
import CallInviteModal from './CallInviteModal';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as ContextMenu from '@radix-ui/react-context-menu';
import type { EmojiClickData } from 'emoji-picker-react';
import { ConversationTypingPreview, MessageTypingIndicator } from '@/components/chat/TypingIndicators';
import { clearAllTyping, clearTypingContext, setTypingUser } from '@/components/chat/typingStore';
import { compressFileList } from '@/lib/imageCompression';

const EmojiPicker = lazy(() => import('emoji-picker-react'));
const StreamChatInterface = lazy(() => import('./StreamChatInterface'));
const USE_STREAM_CHAT = String(import.meta.env.VITE_USE_STREAM_CHAT || '').trim().toLowerCase() === 'true';


interface Message {
    id: number;
    user_id: number;
    recipient_id: number | null;
    group_id?: number | null;
    group_name?: string;
    username: string;
    role: string;
    content: string;
    created_at: string;
    profile_picture?: string;
    attachment_url?: string;
    attachment_type?: string;
    attachments?: Record<string, unknown>[];
    is_edited?: boolean;
    reply_to_id?: number | null;
    reply_content?: string;
    reply_username?: string;
    reactions?: { [emoji: string]: number[] }; // emoji -> array of user_ids
    is_pinned?: boolean;
    is_forwarded?: boolean;
    status?: 'sending' | 'sent' | 'delivered' | 'seen' | string;
    client_temp_id?: string | null;
}

interface HistoryCursor {
    beforeCreatedAt: string;
    beforeId: number;
}

interface ChatHistoryResponse {
    messages: Message[];
    hasMore: boolean;
    nextCursor: HistoryCursor | null;
}

interface ConversationUser {
    id: number | string;
    type?: 'team' | 'direct' | 'group';
    rawGroupId?: number;
    username: string;
    role: string;
    status?: string;
    lastMessage?: string | null;
    lastMessageTime?: string | null;
    department?: string;
    profile_picture?: string;
    memberCount?: number;
}

interface ChatInterfaceProps {
    isVisible?: boolean;
    onUnreadTotalChange?: (count: number) => void;
    adminMode?: boolean;
}

type VirtualMessageRow =
    | {
        key: string;
        type: 'date';
        top: number;
        height: number;
        dateLabel: string;
    }
    | {
        key: string;
        type: 'message';
        top: number;
        height: number;
        message: Message;
        index: number;
    };

const HISTORY_PAGE_SIZE = 30;
const HISTORY_OVERSCAN_PX = 700;
const DEFAULT_DATE_ROW_HEIGHT = 36;
const COMPOSER_MIN_HEIGHT_PX = 40;
const COMPOSER_MAX_HEIGHT_PX = 140;

const compareMessages = (a: Message, b: Message) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id - b.id;
};

const mergeMessages = (...collections: Message[][]) => {
    const merged = new Map<number, Message>();

    collections.flat().forEach((message) => {
        const existing = merged.get(message.id);
        merged.set(message.id, existing ? { ...existing, ...message } : message);
    });

    return Array.from(merged.values()).sort(compareMessages);
};

const getApiOrigin = () => {
    const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
    return raw.replace(/\/api$/i, '');
};

const getAssetUrl = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw;
    }

    const path = raw.startsWith('/') ? raw : `/${raw}`;
    const origin = getApiOrigin();
    return origin ? `${origin}${path}` : path;
};

const getConversationFromLocation = (): number | string => {
    if (typeof window === 'undefined') return '';

    const searchParams = new URLSearchParams(window.location.search);
    const rawChat = String(searchParams.get('chat') || '').trim();
    if (!rawChat) return '';

    if (rawChat.startsWith('group-')) return rawChat;

    const parsedId = Number.parseInt(rawChat, 10);
    return Number.isInteger(parsedId) ? parsedId : '';
};

function isGroupConversationId(value: number | string) {
    return typeof value === 'string' && value.startsWith('group-');
}

function getGroupIdFromConversationId(value: number | string) {
    if (typeof value !== 'string' || !value.startsWith('group-')) return null;
    const parsed = Number.parseInt(value.replace('group-', ''), 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function getConversationRoomId(value: number | string, currentUserId?: number) {
    const groupId = getGroupIdFromConversationId(value);
    if (groupId) return `chat:group:${groupId}`;
    if (value === 'team') return 'chat:team';
    if (typeof value === 'number' && Number.isInteger(value) && Number.isInteger(currentUserId)) {
        const [a, b] = [value, Number(currentUserId)].sort((x, y) => x - y);
        return `chat:dm:${a}:${b}`;
    }
    return null;
}

export default function ChatInterface(props: ChatInterfaceProps) {
    // Keep admin dashboard chat on the in-app renderer for stability.
    if (USE_STREAM_CHAT && !props.adminMode) {
        return (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-500 text-sm">Loading Stream chat...</div>}>
                <StreamChatInterface
                    isVisible={props.isVisible}
                    onUnreadTotalChange={props.onUnreadTotalChange}
                />
            </Suspense>
        );
    }
    return <InternalChatInterface {...props} />;
}

function InternalChatInterface({ isVisible = true, onUnreadTotalChange }: ChatInterfaceProps) {
    const { socket, setOutgoingCall } = useSocket();
    const { user } = useAuth();

    const [messages, setMessages] = useState<Message[]>([]);
    const [hasMoreHistory, setHasMoreHistory] = useState(false);
    const [historyCursor, setHistoryCursor] = useState<HistoryCursor | null>(null);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);
    const [isOlderHistoryLoading, setIsOlderHistoryLoading] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: string } | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<{ file: File; preview: string }[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
    const [editContent, setEditContent] = useState('');
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null);

    const [isTyping, setIsTyping] = useState(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Group Call Invitation State
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [pendingCallType, setPendingCallType] = useState<'audio' | 'video' | null>(null);

    // Voice Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const [isRecordingFinished, setIsRecordingFinished] = useState(false);

    // New state for selection mode
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(new Set());

    const [isConversationSelectionMode, setIsConversationSelectionMode] = useState(false);
    const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string | number>>(new Set());
    const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<Set<number>>(new Set());
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [isGroupMembersOpen, setIsGroupMembersOpen] = useState(false);
    type GroupMember = { id: number; username: string; profile_picture?: string; status?: string; department?: string; role?: string };
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const defaultDocumentTitleRef = useRef(typeof document !== 'undefined' ? document.title : 'Royal Bengal AI EMS');

    const handleBulkMarkAsRead = () => {
        setUnreadCounts(prev => {
            const next = { ...prev };
            selectedConversationIds.forEach(id => {
                next[id] = 0;
            });
            return next;
        });
        setIsConversationSelectionMode(false);
        setSelectedConversationIds(new Set());
        setToast({ message: 'Marked as read', type: 'success' });
    };

    const handleBulkMute = () => {
        setMutedConversations(prev => {
            const next = new Set(prev);
            const newlyMuted: string[] = [];
            selectedConversationIds.forEach(id => {
                const idStr = id.toString();
                if (next.has(idStr)) {
                    next.delete(idStr);
                } else {
                    next.add(idStr);
                    newlyMuted.push(idStr);
                }
            });
            if (newlyMuted.length > 0) {
                setUnreadCounts((prevUnread) => {
                    const nextUnread = { ...prevUnread };
                    newlyMuted.forEach((id) => { nextUnread[id] = 0; });
                    return nextUnread;
                });
            }
            localStorage.setItem('mutedConversations', JSON.stringify(Array.from(next)));
            return next;
        });
        setIsConversationSelectionMode(false);
        setSelectedConversationIds(new Set());
        setToast({ message: 'Updated mute settings', type: 'success' });
    };

    const handleBulkDeleteConversations = async () => {
        if (!confirm(`Are you sure you want to clear history for ${selectedConversationIds.size} conversations?`)) return;
        try {
            await Promise.all(
                Array.from(selectedConversationIds).map(id => api.delete(`/chat/conversations/${id}`))
            );
            
            if (selectedConversationIds.has(activeContactId)) {
                setMessages([]);
            }
            
            setIsConversationSelectionMode(false);
            setSelectedConversationIds(new Set());
            setToast({ message: 'Conversations cleared', type: 'success' });
            fetchConversations();
        } catch (error) {
            console.error('Failed to bulk delete', error);
            setToast({ message: 'Failed to clear some conversations', type: 'info' });
        }
    };

    const handleFetchGroupMembers = async () => {
        const groupId = getGroupIdFromConversationId(activeContactId);
        if (!groupId) return;

        setIsLoadingMembers(true);
        try {
            const res = await api.get(`/chat/groups/${groupId}/members`);
            setGroupMembers(res.data);
            setIsGroupMembersOpen(true);
        } catch (error) {
            console.error('Failed to fetch group members', error);
            setToast({ message: 'Failed to load group members', type: 'info' });
        } finally {
            setIsLoadingMembers(false);
        }
    };

    const getConversationKeyFromMessage = (message: Message) => {
        if (message.group_id) return `group-${message.group_id}`;
        return message.user_id.toString();
    };

    const getTypingContextKey = (data: { userId: number; recipientId?: number | string; groupId?: number }) => {
        if (data.groupId) return `group-${data.groupId}`;
        return data.userId.toString();
    };

    const toggleConversationSelection = (id: string | number) => {
        setSelectedConversationIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const startEditing = (msg: Message) => {
        setEditingMessageId(msg.id);
        setEditContent(msg.content);
        setReplyingTo(null);
    };

    const cancelEditing = () => {
        setEditingMessageId(null);
        setEditContent('');
    };

    const startReplying = (msg: Message) => {
        setReplyingTo(msg);
        setEditingMessageId(null);
        setTimeout(() => {
            inputRef.current?.focus();
        }, 50);
    };

    const cancelReply = () => {
        setReplyingTo(null);
    };

    const handleAddReaction = async (msgId: number, emoji: string) => {
        try {
            await api.post(`/chat/message/${msgId}/reaction`, { emoji });
        } catch (error) {
            console.error('Failed to add reaction', error);
        }
    };

    const handleTogglePin = async (msgId: number) => {
        try {
            await api.put(`/chat/message/${msgId}/pin`);
        } catch (error) {
            console.error('Failed to pin message', error);
        }
    };


    const handleSelectMode = (msgId: number) => {
        setSelectionMode(true);
        setSelectedMessageIds(new Set([msgId]));
    };

    const toggleMessageSelection = (msgId: number) => {
        setSelectedMessageIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) {
                next.delete(msgId);
            } else {
                next.add(msgId);
            }
            return next;
        });
    };

    const saveEdit = async (msgId: number) => {
        if (!editContent.trim()) return;
        try {
            await api.put(`/chat/message/${msgId}`, { content: editContent });
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: editContent, is_edited: true } : m));
            setEditingMessageId(null);
        } catch (error) {
            console.error('Failed to edit message', error);
            setToast({ message: 'Failed to edit message', type: 'info' });
        }
    };

    const handleDeleteMessage = async (msgId: number, type: 'me' | 'everyone') => {
        try {
            await api.delete(`/chat/message/${msgId}?type=${type}`);
            setMessages(prev => prev.filter(m => m.id !== msgId));
        } catch (error) {
            console.error('Failed to delete message', error);
            setToast({ message: 'Failed to delete message', type: 'info' });
        }
    };

    const handleBulkDelete = async () => {
        if (selectedMessageIds.size === 0) return;
        try {
            await Promise.all(
                Array.from(selectedMessageIds).map(id => api.delete(`/chat/message/${id}?type=me`))
            );
            setMessages(prev => prev.filter(m => !selectedMessageIds.has(m.id)));
            setSelectionMode(false);
            setSelectedMessageIds(new Set());
            setToast({ message: `Deleted ${selectedMessageIds.size} messages`, type: 'success' });
        } catch (error) {
            console.error('Failed to bulk delete', error);
            setToast({ message: 'Failed to delete some messages', type: 'info' });
        }
    };

    const handleBulkCopy = () => {
        const text = messages
            .filter(m => selectedMessageIds.has(m.id))
            .map(m => `[${m.username}]: ${m.content}`)
            .join('\n');
        navigator.clipboard.writeText(text);
        setToast({ message: 'Messages copied to clipboard', type: 'success' });
        setSelectionMode(false);
        setSelectedMessageIds(new Set());
    };

    const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
    const [conversations, setConversations] = useState<ConversationUser[]>([]);
    const [activeContactId, setActiveContactId] = useState<number | string>(() => getConversationFromLocation());
    const [isMobileLayout, setIsMobileLayout] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
    const [showMobileConversationList, setShowMobileConversationList] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false);
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const [unreadCounts, setUnreadCounts] = useState<{ [key: string]: number }>({});

    const [lastReadTimestamps, setLastReadTimestamps] = useState<{ [key: string]: string }>(() => {
        const saved = localStorage.getItem('lastReadTimestamps');
        return saved ? JSON.parse(saved) : {};
    });

    const [mutedConversations, setMutedConversations] = useState<Set<string>>(() => {
        const saved = localStorage.getItem('mutedConversations');
        const parsed = saved ? JSON.parse(saved) : [];
        return new Set(parsed.map((id: unknown) => String(id)));
    });
    const [toast, setToast] = useState<{ message: string; type?: 'info' | 'success' } | null>(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // Conversation Search State
    const [isConversationSearchOpen, setIsConversationSearchOpen] = useState(false);
    const [conversationSearchQuery, setConversationSearchQuery] = useState('');
    const debouncedConversationSearchQuery = useDebounce(conversationSearchQuery, 300);
    const [searchMessages, setSearchMessages] = useState<Message[] | null>(null);
    const [isSearchLoadingAll, setIsSearchLoadingAll] = useState(false);

    // Forward Dialog State
    const [isForwardDialogOpen, setIsForwardDialogOpen] = useState(false);
    const [forwardingItems, setForwardingItems] = useState<Message[]>([]);
    const [selectedForwardTargets, setSelectedForwardTargets] = useState<Set<number | string>>(new Set());
    const [forwardSearchQuery, setForwardSearchQuery] = useState('');
    const debouncedForwardSearchQuery = useDebounce(forwardSearchQuery, 300);

    const handleForwardMessage = (msg: Message) => {
        setForwardingItems([msg]);
        setIsForwardDialogOpen(true);
        setSelectedForwardTargets(new Set());
    };

    const handleSendForward = async () => {
        if (selectedForwardTargets.size === 0 || forwardingItems.length === 0) return;

        try {
            // Send each message to each target
            selectedForwardTargets.forEach(targetId => {
                forwardingItems.forEach(item => {
                    const groupId = getGroupIdFromConversationId(targetId);
                    const messageData = {
                        userId: user?.id,
                        recipientId: targetId === 'team' || groupId ? null : targetId,
                        groupId: groupId ?? undefined,
                        content: item.content,
                        attachment_url: item.attachment_url,
                        attachment_type: item.attachment_type,
                        is_forwarded: item.user_id !== user?.id // Only mark as forwarded if original author is different
                    };

                    socket?.emit('send_message', messageData);
                });
            });

            setIsForwardDialogOpen(false);
            setForwardingItems([]);
            setSelectedForwardTargets(new Set());
            setToast({ message: `Forwarded to ${selectedForwardTargets.size} recipients`, type: 'success' });
        } catch (error) {
            console.error('Failed to forward messages', error);
            setToast({ message: 'Failed to forward messages', type: 'info' });
        }
    };

    const toggleForwardTarget = (id: number | string) => {
        setSelectedForwardTargets(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const filteredForwardContacts = conversations.filter(c =>
        c.username.toLowerCase().includes(debouncedForwardSearchQuery.toLowerCase())
    );

    const directContacts = conversations.filter((conversation) => conversation.type === 'direct' && typeof conversation.id === 'number');

    const toggleGroupMember = (memberId: number) => {
        setSelectedGroupMemberIds((prev) => {
            const next = new Set(prev);
            if (next.has(memberId)) {
                next.delete(memberId);
            } else {
                next.add(memberId);
            }
            return next;
        });
    };

    const handleCreateGroup = async () => {
        const trimmedName = groupName.trim();
        if (!trimmedName) {
            setToast({ message: 'Group name is required', type: 'info' });
            return;
        }

        if (selectedGroupMemberIds.size === 0) {
            setToast({ message: 'Select at least one member', type: 'info' });
            return;
        }

        setIsCreatingGroup(true);
        try {
            const res = await api.post('/chat/groups', {
                name: trimmedName,
                memberIds: Array.from(selectedGroupMemberIds)
            });

            await fetchConversations();
            const createdGroupId = res.data?.group?.id;
            if (createdGroupId) {
                setActiveContactId(`group-${createdGroupId}`);
            }
            setGroupName('');
            setSelectedGroupMemberIds(new Set());
            setIsCreateGroupOpen(false);
            setToast({ message: 'Group created successfully', type: 'success' });
        } catch (error: unknown) {
            console.error('Failed to create group', error);
            setToast({ message: (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create group', type: 'info' });
        } finally {
            setIsCreatingGroup(false);
        }
    };

    const handleBulkForward = () => {
        const selectedMsgs = messages.filter(m => selectedMessageIds.has(m.id));
        setForwardingItems(selectedMsgs);
        setIsForwardDialogOpen(true);
        setSelectedForwardTargets(new Set());
        setSelectionMode(false);
        setSelectedMessageIds(new Set());
    };

    const onEmojiClick = (emojiData: EmojiClickData) => {
        setNewMessage(prev => prev + emojiData.emoji);
        setTimeout(() => resizeComposer(), 0);
        // Keep picker open for multiple emojis
    };

    const [mentionSearch, setMentionSearch] = useState<string | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const hasAudioPermissionAttemptedRef = useRef(false);
    const messageScrollAreaRef = useRef<HTMLDivElement>(null);
    const pendingPrependScrollRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
    const historyRequestIdRef = useRef(0);
    const searchRequestIdRef = useRef(0);
    const optimisticMessageIdRef = useRef(-1);
    const lastSeenEmitRef = useRef('');
    const measuredRowHeightsRef = useRef<Record<string, number>>({});
    const rowObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
    const [virtualLayoutVersion, setVirtualLayoutVersion] = useState(0);
    const [viewportMetrics, setViewportMetrics] = useState({ scrollTop: 0, height: 0 });
    const [pageVisibilityVersion, setPageVisibilityVersion] = useState(0);

    const ensureAudioContext = useCallback(async () => {
        if (typeof window === 'undefined') return null;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;

        if (!audioContextRef.current) {
            audioContextRef.current = new AudioCtx();
        }

        if (audioContextRef.current.state === 'suspended') {
            try {
                await audioContextRef.current.resume();
            } catch (error) {
                console.warn('Audio context resume failed', error);
            }
        }

        return audioContextRef.current;
    }, []);

    const playNotificationSound = useCallback(async () => {
        const audioContext = await ensureAudioContext();
        if (!audioContext) return;

        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.18);

        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start(now);
        oscillator.stop(now + 0.25);
    }, [ensureAudioContext]);

    useEffect(() => {
        const unlockAudio = () => {
            if (hasAudioPermissionAttemptedRef.current) return;
            hasAudioPermissionAttemptedRef.current = true;
            ensureAudioContext().catch(() => undefined);
        };

        window.addEventListener('pointerdown', unlockAudio, { once: true });
        window.addEventListener('keydown', unlockAudio, { once: true });

        return () => {
            window.removeEventListener('pointerdown', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
        };
    }, [ensureAudioContext]);

    useEffect(() => {
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(() => undefined);
                audioContextRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const observers = rowObserversRef.current;
        return () => {
            observers.forEach((observer) => observer.disconnect());
            observers.clear();
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
            }
        };
    }, []);

    const scrollRef = useRef<HTMLDivElement>(null);
    const shouldStickToBottomRef = useRef(true);
    const lastMessageCountRef = useRef(0);
    const lastConversationRef = useRef<number | string>('');
    const sidebarRef = useRef<HTMLDivElement>(null);
    const selectionBarRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isLongPressing, setIsLongPressing] = useState<number | string | null>(null);

    const getMessageViewport = useCallback(() => {
        if (!messageScrollAreaRef.current) return null;
        return messageScrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    }, []);

    const clearMeasuredRows = useCallback(() => {
        rowObserversRef.current.forEach((observer) => observer.disconnect());
        rowObserversRef.current.clear();
        measuredRowHeightsRef.current = {};
        setVirtualLayoutVersion((version) => version + 1);
    }, []);

    const measureVirtualRow = useCallback((key: string) => (node: HTMLDivElement | null) => {
        const existingObserver = rowObserversRef.current.get(key);
        if (existingObserver) {
            existingObserver.disconnect();
            rowObserversRef.current.delete(key);
        }

        if (!node) return;

        const updateHeight = () => {
            const nextHeight = Math.ceil(node.getBoundingClientRect().height);
            if (!nextHeight) return;
            if (measuredRowHeightsRef.current[key] === nextHeight) return;
            measuredRowHeightsRef.current[key] = nextHeight;
            setVirtualLayoutVersion((version) => version + 1);
        };

        updateHeight();

        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            updateHeight();
        });
        observer.observe(node);
        rowObserversRef.current.set(key, observer);
    }, []);

    // Click outside to cancel selection mode
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!isConversationSelectionMode) return;
            
            const target = event.target as Node;
            const isOutsideSidebar = sidebarRef.current && !sidebarRef.current.contains(target);
            const isOutsideSelectionBar = selectionBarRef.current && !selectionBarRef.current.contains(target);
            
            if (isOutsideSidebar && isOutsideSelectionBar) {
                setIsConversationSelectionMode(false);
                setSelectedConversationIds(new Set());
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isConversationSelectionMode]);

    const startLongPress = (id: number | string) => {
        if (isConversationSelectionMode) return;
        
        setIsLongPressing(id);
        longPressTimerRef.current = setTimeout(() => {
            setIsConversationSelectionMode(true);
            setSelectedConversationIds(new Set([id]));
            setIsLongPressing(null);
            // Vibrate if supported
            if (navigator.vibrate) navigator.vibrate(50);
        }, 3000); // 3 seconds as requested
    };

    const cancelLongPress = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        setIsLongPressing(null);
    };

    const handleConversationClick = (id: number | string) => {
        if (isConversationSelectionMode) {
            toggleConversationSelection(id);
        } else {
            setActiveContactId(id);
            if (isMobileLayout) {
                setShowMobileConversationList(false);
            }
        }
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia('(max-width: 767px)');
        const syncLayout = (matches: boolean) => {
            setIsMobileLayout(matches);
            setShowMobileConversationList(matches);
        };

        syncLayout(mediaQuery.matches);

        const handleChange = (event: MediaQueryListEvent) => {
            syncLayout(event.matches);
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const handleVisibilityChange = () => {
            setPageVisibilityVersion((version) => version + 1);
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

        const handleServiceWorkerMessage = (event: MessageEvent) => {
            const payload = event.data;
            if (!payload || payload.type !== 'chat-notification-click') return;

            const rawConversation = String(payload.conversationId || '').trim();
            if (!rawConversation) return;

            if (rawConversation.startsWith('group-')) {
                setActiveContactId(rawConversation);
            } else {
                const parsed = Number.parseInt(rawConversation, 10);
                if (Number.isInteger(parsed)) {
                    setActiveContactId(parsed);
                }
            }

            if (isMobileLayout) {
                setShowMobileConversationList(false);
            }
        };

        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
        return () => navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    }, [isMobileLayout]);

    useEffect(() => {
        if (!user?.id) {
            setUnreadCounts({});
            onUnreadTotalChange?.(0);
            syncAppIconBadge(0).catch(() => undefined);
            if (typeof document !== 'undefined') {
                document.title = defaultDocumentTitleRef.current;
            }
            return;
        }

        const saved = localStorage.getItem(`chatUnreadCounts:${user.id}`);
        const parsed = saved ? JSON.parse(saved) : {};
        const normalized = Object.entries(parsed).reduce<Record<string, number>>((acc, [conversationId, count]) => {
            const numeric = typeof count === 'number' ? Math.floor(count) : 0;
            acc[conversationId] = numeric > 0 ? numeric : 0;
            return acc;
        }, {});
        setUnreadCounts(normalized);
    }, [user?.id, onUnreadTotalChange]);

    useEffect(() => {
        if (!socket || !activeContactId || !user?.id) return;

        const roomId = getConversationRoomId(activeContactId, user.id);
        if (!roomId) return;

        socket.emit('join_chat_room', { roomId });

        return () => {
            socket.emit('leave_chat_room', { roomId });
        };
    }, [activeContactId, socket, user?.id]);

    useEffect(() => {
        if (!user?.id) return;

        localStorage.setItem(`chatUnreadCounts:${user.id}`, JSON.stringify(unreadCounts));
        const totalUnread = Object.entries(unreadCounts).reduce((sum, [conversationId, count]) => {
            const numeric = typeof count === 'number' ? count : 0;
            if (numeric <= 0) return sum;
            if (mutedConversations.has(conversationId.toString())) return sum;
            return sum + 1;
        }, 0);
        onUnreadTotalChange?.(totalUnread);
        syncAppIconBadge(totalUnread).catch(() => undefined);

        if (typeof document !== 'undefined') {
            document.title = totalUnread > 0
                ? `(${totalUnread}) ${defaultDocumentTitleRef.current}`
                : defaultDocumentTitleRef.current;
        }
    }, [unreadCounts, mutedConversations, onUnreadTotalChange, user?.id]);

    const toggleMute = () => {
        setMutedConversations(prev => {
            const next = new Set(prev);
            const idStr = activeContactId.toString();
            if (next.has(idStr)) {
                next.delete(idStr);
            } else {
                next.add(idStr);
                setUnreadCounts((prevUnread) => ({ ...prevUnread, [idStr]: 0 }));
            }
            localStorage.setItem('mutedConversations', JSON.stringify(Array.from(next)));
            return next;
        });
    };


    // Initiate a call to the active contact
    const initiateCall = (callType: 'audio' | 'video') => {
        if (!user || !socket || !activeContactId) return;

        if (typeof activeContactId !== 'number') {
            setToast({ message: 'Calls are only available in direct messages or Team Chat', type: 'info' });
            return;
        }

        const activeUser = conversations.find(c => c.id === activeContactId);
        if (!activeUser) return;

        setOutgoingCall({
            targetUserId: activeContactId as number,
            targetUsername: activeUser.username,
            targetProfilePicture: activeUser.profile_picture,
            callType
        });
    };

    const handleCallConfirmed = (categoryIds: number[], userIds: number[]) => {
        if (!user || !socket || !pendingCallType) return;

        socket.emit('start_team_call', {
            callerId: user.id,
            callerName: user.username,
            callerProfilePicture: user.profile_picture,
            callType: pendingCallType,
            targetCategoryIds: categoryIds,
            targetUserIds: userIds
        });

        // We set outgoingCall with a special target id 'team' to trigger the modal locally
        setOutgoingCall({
            targetUserId: 0, // Using 0 as a placeholder for group
            targetUsername: 'Team Chat',
            targetProfilePicture: null,
            callType: pendingCallType
        });

        setIsInviteModalOpen(false);
        setPendingCallType(null);
    };

    // Voice Recording Functions
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setIsRecording(true);
            setIsRecordingFinished(false);
            setRecordingTime(0);

            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);
        } catch (err) {
            console.error('Failed to start recording:', err);
            setToast({ message: 'Failed to access microphone', type: 'info' });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsRecordingFinished(true);
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
            }
        }
    };

    const discardRecording = () => {
        audioChunksRef.current = [];
        setRecordingTime(0);
        setIsRecording(false);
        setIsRecordingFinished(false);
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
        }
    };

    const sendVoiceMessage = async () => {
        // Wait a bit for the last chunk to be added
        await new Promise(resolve => setTimeout(resolve, 100));

        if (audioChunksRef.current.length === 0) return;

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, `voice_${Date.now()}.webm`);

        try {
            const uploadRes = await api.post('/chat/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            const messageData: Record<string, unknown> = {
                userId: user?.id,
                recipientId: activeContactId === 'team' || getGroupIdFromConversationId(activeContactId) ? null : activeContactId,
                groupId: getGroupIdFromConversationId(activeContactId) ?? undefined,
                content: '🎤 Voice message',
                attachment_url: uploadRes.data.url,
                attachment_type: 'audio'
            };

            socket?.emit('send_message', messageData);
            setRecordingTime(0);
            setIsRecordingFinished(false);
        } catch (err) {
            console.error('Failed to send voice message:', err);
            setToast({ message: 'Failed to send voice message', type: 'info' });
        }
    };

    const formatRecordingTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const activeContactIdRef = useRef(activeContactId);
    useEffect(() => {
        activeContactIdRef.current = activeContactId;
    }, [activeContactId]);

    const fetchConversations = useCallback(async () => {
        try {
            const res = await api.get('/chat/conversations');
            const groups = res.data.groups || [];
            const directs = res.data.direct;
            const updatedConversations = [...groups, ...directs];
            setConversations(updatedConversations);
            
            const currentActive = activeContactIdRef.current;
            if (!currentActive && updatedConversations.length > 0) {
                setActiveContactId(updatedConversations[0].id);
            } else if (
                currentActive &&
                updatedConversations.length > 0 &&
                !updatedConversations.some((conversation) => conversation.id.toString() === currentActive.toString())
            ) {
                setActiveContactId(updatedConversations[0].id);
            }
        } catch (err) {
            console.error("Failed to fetch conversations", err);
        }
    }, []);

    const loadHistoryPage = useCallback(async ({
        conversationId,
        cursor = null,
        mode = 'replace'
    }: {
        conversationId: number | string;
        cursor?: HistoryCursor | null;
        mode?: 'replace' | 'prepend';
    }) => {
        if (!conversationId) return;

        const requestId = ++historyRequestIdRef.current;
        const isPrepend = mode === 'prepend';

        if (isPrepend) {
            setIsOlderHistoryLoading(true);
        } else {
            setIsHistoryLoading(true);
        }

        try {
            const groupId = getGroupIdFromConversationId(conversationId);
            const params: Record<string, string | number> = {
                limit: HISTORY_PAGE_SIZE
            };

            if (groupId) {
                params.groupId = groupId;
            } else {
                params.contactId = conversationId;
            }

            if (cursor) {
                params.beforeCreatedAt = cursor.beforeCreatedAt;
                params.beforeId = cursor.beforeId;
            }

            const res = await api.get<ChatHistoryResponse | Message[]>('/chat/history', { params });

            if (requestId !== historyRequestIdRef.current) return;

            const payload = Array.isArray(res.data)
                ? { messages: res.data, hasMore: false, nextCursor: null }
                : res.data;

            setMessages((prev) => (isPrepend ? mergeMessages(payload.messages, prev) : mergeMessages(payload.messages)));
            setHasMoreHistory(Boolean(payload.hasMore));
            setHistoryCursor(payload.nextCursor ?? null);

            if (!isPrepend) {
                setUnreadCounts(prev => ({ ...prev, [conversationId]: 0 }));

                const now = new Date().toISOString();
                setLastReadTimestamps(prev => {
                    const updated = { ...prev, [conversationId]: now };
                    localStorage.setItem('lastReadTimestamps', JSON.stringify(updated));
                    return updated;
                });
            }
        } catch (err) {
            if (requestId !== historyRequestIdRef.current) return;
            console.error(err);
        } finally {
            if (requestId === historyRequestIdRef.current) {
                if (isPrepend) {
                    setIsOlderHistoryLoading(false);
                } else {
                    setIsHistoryLoading(false);
                }
            }
        }
    }, []);

    const loadOlderMessages = useCallback(async () => {
        if (!activeContactId || !hasMoreHistory || !historyCursor || isOlderHistoryLoading) return;

        const viewport = getMessageViewport();
        if (viewport) {
            pendingPrependScrollRef.current = {
                scrollTop: viewport.scrollTop,
                scrollHeight: viewport.scrollHeight
            };
        }

        await loadHistoryPage({
            conversationId: activeContactId,
            cursor: historyCursor,
            mode: 'prepend'
        });
    }, [activeContactId, getMessageViewport, hasMoreHistory, historyCursor, isOlderHistoryLoading, loadHistoryPage]);

    const loadAllHistoryForSearch = useCallback(async (conversationId: number | string) => {
        const getPage = async (cursor: HistoryCursor | null) => {
            const groupId = getGroupIdFromConversationId(conversationId);
            const params: Record<string, string | number> = {
                limit: 100
            };

            if (groupId) {
                params.groupId = groupId;
            } else {
                params.contactId = conversationId;
            }

            if (cursor) {
                params.beforeCreatedAt = cursor.beforeCreatedAt;
                params.beforeId = cursor.beforeId;
            }

            const res = await api.get<ChatHistoryResponse | Message[]>('/chat/history', { params });
            return Array.isArray(res.data)
                ? { messages: res.data, hasMore: false, nextCursor: null }
                : res.data;
        };

        let cursor: HistoryCursor | null = null;
        let hasMore = true;
        let allMessages: Message[] = [];

        while (hasMore) {
            const page = await getPage(cursor);
            allMessages = mergeMessages(allMessages, page.messages);
            hasMore = Boolean(page.hasMore);
            cursor = page.nextCursor ?? null;
        }

        return allMessages;
    }, []);

    const closeConversationSearch = useCallback(() => {
        setIsConversationSearchOpen(false);
        setConversationSearchQuery('');
        setSearchMessages(null);
        setIsSearchLoadingAll(false);
        searchRequestIdRef.current += 1;

        if (!activeContactId) return;

        historyRequestIdRef.current += 1;
        setMessages([]);
        setHasMoreHistory(false);
        setHistoryCursor(null);
        setViewportMetrics({ scrollTop: 0, height: 0 });
        pendingPrependScrollRef.current = null;
        clearMeasuredRows();
        shouldStickToBottomRef.current = true;

        void loadHistoryPage({
            conversationId: activeContactId,
            mode: 'replace'
        });
    }, [activeContactId, clearMeasuredRows, loadHistoryPage]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    useEffect(() => {
        const fetchCategories = async () => {
            if (user?.role !== 'admin') {
                setCategories([]);
                return;
            }
            try {
                const res = await api.get('/admin/categories');
                setCategories(res.data || []);
            } catch (err) {
                console.error('Failed to fetch categories', err);
                setCategories([]);
            }
        };
        fetchCategories();
    }, [user?.role]);

    useEffect(() => {
        historyRequestIdRef.current += 1;
        lastSeenEmitRef.current = '';
        setMessages([]);
        setHasMoreHistory(false);
        setHistoryCursor(null);
        setViewportMetrics({ scrollTop: 0, height: 0 });
        pendingPrependScrollRef.current = null;
        clearMeasuredRows();
        shouldStickToBottomRef.current = true;

        if (activeContactId) {
            void loadHistoryPage({
                conversationId: activeContactId,
                mode: 'replace'
            });
        }

        setIsConversationSearchOpen(false);
        setConversationSearchQuery('');
        setSearchMessages(null);
        setIsSearchLoadingAll(false);
        searchRequestIdRef.current += 1;
        setIsTyping(false);
        if (activeContactId) {
            clearTypingContext(activeContactId.toString());
        }
    }, [activeContactId, clearMeasuredRows, loadHistoryPage]);

    useEffect(() => {
        return () => {
            clearAllTyping();
        };
    }, []);

    useEffect(() => {
        if (!isConversationSearchOpen || !activeContactId) {
            setSearchMessages(null);
            setIsSearchLoadingAll(false);
            return;
        }

        const requestId = ++searchRequestIdRef.current;
        setIsSearchLoadingAll(true);
        setSearchMessages(null);

        (async () => {
            try {
                const allMessages = await loadAllHistoryForSearch(activeContactId);
                if (requestId !== searchRequestIdRef.current) return;
                setSearchMessages(allMessages);
            } catch (error) {
                if (requestId !== searchRequestIdRef.current) return;
                console.error('Failed to load full conversation for search', error);
                setSearchMessages(null);
            } finally {
                if (requestId === searchRequestIdRef.current) {
                    setIsSearchLoadingAll(false);
                }
            }
        })();
    }, [activeContactId, isConversationSearchOpen, loadAllHistoryForSearch]);

    // Socket Event Listeners
    useEffect(() => {
        if (!socket) return;

        const handleReceiveMessage = (message: Message) => {
            const isCustomGroupMessage = !!message.group_id;
            const conversationId = getConversationKeyFromMessage(message);

            const isRelevantForView =
                (isGroupConversationId(activeContactId) && getGroupIdFromConversationId(activeContactId) === message.group_id) ||
                (typeof activeContactId === 'number' && (
                    (message.user_id === activeContactId && message.recipient_id === user?.id) ||
                    (message.user_id === user?.id && message.recipient_id === activeContactId)
                ));
            const isActivelyViewingConversation = isVisible && !document.hidden && isRelevantForView;

            let isMention = false;
            let isMuted = false;

            if (message.user_id !== user?.id) {
                isMuted = mutedConversations.has(conversationId);
                const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const normalizedDept = String(user?.department || '').trim();
                const compactDept = normalizedDept.replace(/\s+/g, '');
                const dashDept = normalizedDept.replace(/\s+/g, '-');
                const underscoreDept = normalizedDept.replace(/\s+/g, '_');
                const mentionTargets = [user?.username, normalizedDept, compactDept, dashDept, underscoreDept, 'everyone']
                    .filter(Boolean)
                    .map((name) => escaped(String(name)));
                const mentionPattern = mentionTargets.length > 0
                    ? new RegExp(`@(?:${mentionTargets.join('|')})(?=\\s|$)`, 'i')
                    : /$^/;
                isMention = mentionPattern.test(message.content);

                const isBackground = document.hidden || !isVisible || !isRelevantForView;

                if (isBackground) {
                    if (!isMuted) {
                        setToast({
                            message: `New message from ${message.username}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`,
                            type: 'info'
                        });

                        playNotificationSound().catch(() => undefined);

                        if ('Notification' in window && Notification.permission === "granted") {
                            const notification = new Notification(
                                isMention ? `Mentioned by ${message.username}` : `New message from ${message.username}`,
                                {
                                    body: message.content?.trim() || 'Sent an attachment',
                                    tag: `chat-${conversationId}`,
                                }
                            );

                            notification.onclick = () => {
                                window.focus();
                                notification.close();
                            };
                        }
                    }
                }
            }

            if (isActivelyViewingConversation) {
                const mergeIncoming = (previousMessages: Message[]) => {
                    let base = previousMessages;
                    if (message.client_temp_id && message.user_id === user?.id) {
                        base = base.filter((item) => item.client_temp_id !== message.client_temp_id);
                    }
                    return mergeMessages(base, [message]);
                };

                setMessages((prev) => mergeIncoming(prev));
                setSearchMessages((prev) => (prev ? mergeIncoming(prev) : prev));

                if (
                    typeof activeContactId === 'number' &&
                    message.user_id === activeContactId &&
                    message.recipient_id === user?.id
                ) {
                    socket.emit('mark_seen', {
                        conversationId: activeContactId,
                        contactId: activeContactId
                    });
                }
            } else {
                if (message.user_id !== user?.id) {
                    if (!isMuted) {
                        const sourceKey = conversationId.toString();
                        setUnreadCounts(prev => ({
                            ...prev,
                            [sourceKey]: (prev[sourceKey] || 0) + 1
                        }));
                    }
                }
            }

            setConversations(prev => {
                return prev.map(conv => {
                    let shouldUpdate = false;

                    if (isCustomGroupMessage) {
                        if (conv.id === conversationId) shouldUpdate = true;
                    } else {
                        // Direct message: conversationId is the sender's ID string
                        // We check if the conversation is with the sender or the recipient (us)
                        if (conv.id.toString() === conversationId || 
                            (message.recipient_id && conv.id.toString() === message.recipient_id.toString())) {
                            shouldUpdate = true;
                        }
                    }

                    if (shouldUpdate) {
                        const preview = isCustomGroupMessage ? `${message.username}: ${message.content}` : message.content;
                        return {
                            ...conv,
                            lastMessage: preview,
                            lastMessageTime: message.created_at
                        };
                    }
                    return conv;
                });
            });
        };

        const handleStatusUpdate = () => {
            fetchConversations();
        };

        const handleMessageDeleted = (data: { id: number, type: 'me' | 'everyone' }) => {
            setMessages(prev => prev.filter(m => m.id !== data.id));
            setSearchMessages(prev => (prev ? prev.filter(m => m.id !== data.id) : prev));
        };

        const handleMessageUpdated = (data: { id: number, content: string, is_edited: boolean }) => {
            setMessages(prev => prev.map(m =>
                m.id === data.id
                    ? { ...m, content: data.content, is_edited: data.is_edited }
                    : m
            ));
            setSearchMessages(prev => (prev ? prev.map(m =>
                m.id === data.id
                    ? { ...m, content: data.content, is_edited: data.is_edited }
                    : m
            ) : prev));
        };

        const handleMessageReaction = (data: { id: number, reactions: Record<string, number[]> }) => {
            setMessages(prev => prev.map(m => m.id === data.id ? { ...m, reactions: data.reactions } : m));
            setSearchMessages(prev => (prev ? prev.map(m => m.id === data.id ? { ...m, reactions: data.reactions } : m) : prev));
        };

        const handleMessagePinned = (data: { id: number, is_pinned: boolean }) => {
            setMessages(prev => prev.map(m => m.id === data.id ? { ...m, is_pinned: data.is_pinned } : m));
            setSearchMessages(prev => (prev ? prev.map(m => m.id === data.id ? { ...m, is_pinned: data.is_pinned } : m) : prev));
        };

        const handleMessagesDelivered = (data: { messageIds: number[]; recipientId: number }) => {
            if (!Array.isArray(data?.messageIds) || data.messageIds.length === 0) return;
            const deliveredSet = new Set(data.messageIds.map((id) => Number.parseInt(String(id), 10)));
            const applyDelivered = (prev: Message[]) => prev.map((message) => {
                if (!deliveredSet.has(Number(message.id))) return message;
                if (message.status === 'seen') return message;
                return { ...message, status: 'delivered' };
            });
            setMessages((prev) => applyDelivered(prev));
            setSearchMessages((prev) => (prev ? applyDelivered(prev) : prev));
        };

        const handleMessagesSeen = (data: { messageIds: number[]; recipientId: number }) => {
            if (!Array.isArray(data?.messageIds) || data.messageIds.length === 0) return;
            const seenSet = new Set(data.messageIds.map((id) => Number.parseInt(String(id), 10)));
            const applySeen = (prev: Message[]) => prev.map((message) => (
                seenSet.has(Number(message.id))
                    ? { ...message, status: 'seen' }
                    : message
            ));
            setMessages((prev) => applySeen(prev));
            setSearchMessages((prev) => (prev ? applySeen(prev) : prev));
        };

        socket.on('receive_message', handleReceiveMessage);
        socket.on('status_update', handleStatusUpdate);
        socket.on('chat_group_created', handleStatusUpdate);
        socket.on('message_deleted', handleMessageDeleted);
        socket.on('message_updated', handleMessageUpdated);
        socket.on('message_reaction', handleMessageReaction);
        socket.on('message_pinned', handleMessagePinned);
        socket.on('messages_delivered', handleMessagesDelivered);
        socket.on('messages_seen', handleMessagesSeen);

        socket.on('typing', (data: { userId: number, recipientId?: number | string, groupId?: number }) => {
            if (data.userId === user?.id) return;
            const contextKey = getTypingContextKey(data);
            setTypingUser(contextKey, data.userId, true);
        });

        socket.on('stop_typing', (data: { userId: number, recipientId?: number | string, groupId?: number }) => {
            const contextKey = getTypingContextKey(data);
            setTypingUser(contextKey, data.userId, false);
        });

        return () => {
            socket.off('receive_message', handleReceiveMessage);
            socket.off('status_update', handleStatusUpdate);
            socket.off('chat_group_created', handleStatusUpdate);
            socket.off('message_deleted', handleMessageDeleted);
            socket.off('message_updated', handleMessageUpdated);
            socket.off('message_reaction', handleMessageReaction);
            socket.off('message_pinned', handleMessagePinned);
            socket.off('messages_delivered', handleMessagesDelivered);
            socket.off('messages_seen', handleMessagesSeen);
            socket.off('typing');
            socket.off('stop_typing');
        };
    }, [socket, user?.id, user?.department, user?.username, activeContactId, mutedConversations, isVisible, fetchConversations, playNotificationSound]);

    useEffect(() => {
        if (!socket || !user?.id) return;
        if (typeof activeContactId !== 'number') return;
        if (!isVisible || document.hidden) return;

        const unseenIncoming = messages.filter((message) => (
            message.user_id === activeContactId &&
            message.recipient_id === user.id &&
            message.status !== 'seen'
        ));

        if (unseenIncoming.length === 0) return;

        const newestUnseenId = unseenIncoming.reduce((maxId, message) => Math.max(maxId, message.id), 0);
        const marker = `${activeContactId}:${newestUnseenId}`;
        if (lastSeenEmitRef.current === marker) return;

        socket.emit('mark_seen', {
            conversationId: activeContactId,
            contactId: activeContactId
        });

        lastSeenEmitRef.current = marker;
    }, [activeContactId, isVisible, messages, pageVisibilityVersion, socket, user?.id]);

    useEffect(() => {
        if (!isVisible) return;

        const viewport = getMessageViewport();
        if (!viewport) return;

        const handleViewportChange = (allowOlderLoad: boolean) => {
            const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
            shouldStickToBottomRef.current = distanceFromBottom < 80;
            setViewportMetrics({
                scrollTop: viewport.scrollTop,
                height: viewport.clientHeight
            });

            if (
                allowOlderLoad &&
                viewport.scrollTop < 180 &&
                hasMoreHistory &&
                !isOlderHistoryLoading &&
                !isHistoryLoading &&
                !isConversationSearchOpen
            ) {
                void loadOlderMessages();
            }
        };

        // Initialize viewport metrics without triggering older-history pagination.
        handleViewportChange(false);

        const onViewportScroll = throttle(() => {
            handleViewportChange(true);
        }, 100);

        viewport.addEventListener('scroll', onViewportScroll, { passive: true });

        return () => {
            onViewportScroll.cancel();
            viewport.removeEventListener('scroll', onViewportScroll);
        };
    }, [activeContactId, getMessageViewport, hasMoreHistory, isConversationSearchOpen, isHistoryLoading, isOlderHistoryLoading, isVisible, loadOlderMessages]);

    useEffect(() => {
        if (!isVisible) return;
        const viewport = getMessageViewport();
        if (!viewport || typeof ResizeObserver === 'undefined') return;

        let animationFrame = 0;
        const keepBottomOnResize = () => {
            if (!shouldStickToBottomRef.current) return;
            cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(() => {
                viewport.scrollTop = viewport.scrollHeight;
                setViewportMetrics({
                    scrollTop: viewport.scrollTop,
                    height: viewport.clientHeight
                });
            });
        };

        const observer = new ResizeObserver(() => {
            keepBottomOnResize();
        });
        observer.observe(viewport);

        return () => {
            observer.disconnect();
            cancelAnimationFrame(animationFrame);
        };
    }, [activeContactId, getMessageViewport, isVisible]);

    useLayoutEffect(() => {
        if (!isVisible) return;

        const viewport = getMessageViewport();
        if (!viewport) return;

        if (pendingPrependScrollRef.current) {
            const { scrollTop, scrollHeight } = pendingPrependScrollRef.current;
            const addedHeight = viewport.scrollHeight - scrollHeight;
            viewport.scrollTop = scrollTop + addedHeight;
            pendingPrependScrollRef.current = null;
            setViewportMetrics({
                scrollTop: viewport.scrollTop,
                height: viewport.clientHeight
            });
            lastMessageCountRef.current = messages.length;
            return;
        }

        const conversationChanged = lastConversationRef.current !== activeContactId;
        const hasNewMessage = messages.length > lastMessageCountRef.current;
        const shouldForceToBottom = conversationChanged || (hasNewMessage && shouldStickToBottomRef.current);

        if (shouldForceToBottom) {
            viewport.scrollTop = viewport.scrollHeight;
        }

        lastConversationRef.current = activeContactId;
        lastMessageCountRef.current = messages.length;
        setViewportMetrics({
            scrollTop: viewport.scrollTop,
            height: viewport.clientHeight
        });
    }, [activeContactId, getMessageViewport, isVisible, messages]);

    const VideoAttachment = ({ url }: { url: string }) => {
        return (
            <div className="mt-2 rounded-lg overflow-hidden border border-200/50 shadow-sm bg-black group relative">
                <video
                    src={`${url}#t=0.1`}
                    controls
                    playsInline
                    muted
                    preload="metadata"
                    className="max-w-full max-h-[300px] w-full"
                />
            </div>
        );
    };

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSend = async () => {
        if ((!newMessage.trim() && selectedFiles.length === 0) || !user || !socket || isUploading) return;

        setIsUploading(true);
        let attachments: Record<string, unknown>[] = [];
        let mainAttachmentUrl = undefined;
        let mainAttachmentType = undefined;

        try {
            // Upload files if selected
            if (selectedFiles.length > 0) {
                const formData = new FormData();
                selectedFiles.forEach(({ file }) => {
                    formData.append('files', file);
                });

                const res = await api.post('/chat/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });

                // The server returns { files: [...], url, type }
                const uploadedFiles = res.data.files;
                attachments = uploadedFiles;

                // For legacy compatibility (and main display if needed)
                if (uploadedFiles.length > 0) {
                    mainAttachmentUrl = uploadedFiles[0].url;
                    mainAttachmentType = uploadedFiles[0].type;
                }
            }

            const groupId = getGroupIdFromConversationId(activeContactId);
            const isDirectConversation = typeof activeContactId === 'number' && !groupId;
            const clientTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const optimisticMessageId = optimisticMessageIdRef.current;
            optimisticMessageIdRef.current -= 1;

            const optimisticMessage: Message = {
                id: optimisticMessageId,
                user_id: user.id,
                recipient_id: isDirectConversation ? Number(activeContactId) : null,
                group_id: groupId ?? null,
                group_name: isGroupConversationId(activeContactId) ? activeUser?.username : undefined,
                username: user.username,
                role: user.role,
                content: newMessage.trim(),
                created_at: new Date().toISOString(),
                profile_picture: user.profile_picture,
                attachment_url: mainAttachmentUrl,
                attachment_type: mainAttachmentType,
                attachments,
                reply_to_id: replyingTo ? replyingTo.id : null,
                reply_content: replyingTo ? replyingTo.content : undefined,
                reply_username: replyingTo ? replyingTo.username : undefined,
                status: isDirectConversation ? 'sending' : undefined,
                client_temp_id: clientTempId
            };

            setMessages((prev) => mergeMessages(prev, [optimisticMessage]));
            setSearchMessages((prev) => (prev ? mergeMessages(prev, [optimisticMessage]) : prev));

            const messageData = {
                userId: user.id,
                content: newMessage.trim(),
                recipientId: activeContactId === 'team' || groupId ? null : activeContactId,
                groupId: groupId ?? undefined,
                username: user.username,
                attachment_url: mainAttachmentUrl,
                attachment_type: mainAttachmentType,
                attachments: attachments, // Send the array
                replyToId: replyingTo ? replyingTo.id : null,
                client_temp_id: clientTempId
            };

            socket.emit('send_message', messageData);
            shouldStickToBottomRef.current = true;

            // Reset state
            setNewMessage('');
            resizeComposer();
            setMentionSearch(null);
            setReplyingTo(null);
            setSelectedFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = '';

        } catch (error) {
            console.error('Error sending message:', error);
            setToast({ message: 'Failed to send message', type: 'info' });
        } finally {
            setIsUploading(false);
        }
    };



    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const selected = Array.from(e.target.files);
        const newFiles = await compressFileList(selected);

        // Check total size
        const currentTotalSize = selectedFiles.reduce((acc, curr) => acc + curr.file.size, 0);
        const newFilesSize = newFiles.reduce((acc, curr) => acc + curr.size, 0);

        if (currentTotalSize + newFilesSize > 70 * 1024 * 1024) {
            setToast({ message: 'Total file size must be less than 70MB', type: 'info' });
            return;
        }

        const newEntries = newFiles.map(file => ({
            file,
            preview: URL.createObjectURL(file)
        }));

        setSelectedFiles(prev => [...prev, ...newEntries]);
    };

    const removeFile = (index: number) => {
        setSelectedFiles(prev => {
            const newFiles = [...prev];
            URL.revokeObjectURL(newFiles[index].preview); // Cleanup
            newFiles.splice(index, 1);
            return newFiles;
        });
        if (selectedFiles.length <= 1 && fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const resizeComposer = useCallback((target?: HTMLTextAreaElement | null) => {
        const node = target || inputRef.current;
        if (!node) return;

        node.style.height = `${COMPOSER_MIN_HEIGHT_PX}px`;
        const nextHeight = Math.min(node.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
        node.style.height = `${Math.max(COMPOSER_MIN_HEIGHT_PX, nextHeight)}px`;
        node.style.overflowY = node.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? 'auto' : 'hidden';
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setNewMessage(value);
        resizeComposer(e.target);

        // Typing Indicator Logic
        if (socket && user) {
            if (!isTyping) {
                setIsTyping(true);
                const groupId = getGroupIdFromConversationId(activeContactId);
                socket.emit('typing', groupId
                    ? { groupId }
                    : { recipientId: activeContactId === 'team' ? 'team' : activeContactId });
            }

            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

            typingTimeoutRef.current = setTimeout(() => {
                setIsTyping(false);
                const groupId = getGroupIdFromConversationId(activeContactId);
                socket.emit('stop_typing', groupId
                    ? { groupId }
                    : { recipientId: activeContactId === 'team' ? 'team' : activeContactId });
            }, 3000);
        }

        const lastAt = value.lastIndexOf('@');
        const isMentionContext = activeContactId === 'team' || isGroupConversationId(activeContactId);
        if (lastAt !== -1 && isMentionContext) {
            const query = value.slice(lastAt + 1);
            if (!query.includes(' ')) {
                setMentionSearch(query);
                setMentionIndex(0);
                return;
            }
        }
        setMentionSearch(null);
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (mentionSearch !== null) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex(prev => (prev + 1) % mentionCandidates.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(prev => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
                return;
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault();
                if (mentionCandidates[mentionIndex]) {
                    insertMention(mentionCandidates[mentionIndex]);
                }
                return;
            }
            if (e.key === 'Escape') {
                setMentionSearch(null);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const insertMention = (candidate: { username: string }) => {
        if (!newMessage) return;
        const lastAt = newMessage.lastIndexOf('@');
        const newValue = newMessage.substring(0, lastAt) + `@${candidate.username} ` + newMessage.substring(newMessage.length);
        setNewMessage(newValue);
        setMentionSearch(null);
        setTimeout(() => {
            resizeComposer();
            inputRef.current?.focus();
        }, 0);
    };

    const mentionCandidates = mentionSearch !== null
        ? (() => {
            const search = mentionSearch.toLowerCase();
            const candidates = [{ username: 'everyone', id: 'all' }];

            candidates.push(...conversations
                .filter(c => c.type === 'direct' && c.username.toLowerCase().includes(search))
                .map((c) => ({ username: c.username, id: String(c.id), profile_picture: c.profile_picture })));

            const uniqueGroups = new Set<string>();

            if (user?.department && user.department.toLowerCase().includes(search)) {
                uniqueGroups.add(user.department);
            }

            conversations.forEach(c => {
                if (c.department && c.department.toLowerCase().includes(search)) {
                    uniqueGroups.add(c.department);
                }
            });

            categories.forEach(c => {
                if (c.name.toLowerCase().includes(search)) {
                    uniqueGroups.add(c.name);
                }
            });

            Array.from(uniqueGroups).sort().forEach(groupName => {
                candidates.push({ username: groupName, id: `group-${groupName}` });
            });

            return candidates;
        })()
        : [];

    const formatMessageTime = (dateStr?: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        if (isToday(date)) return format(date, 'h:mm a');
        if (isYesterday(date)) return 'Yesterday';
        return format(date, 'MMM d');
    };

    const filteredConversations = conversations
        .filter(c => {
            return c.username.toLowerCase().includes(debouncedSearchQuery.toLowerCase());
        })
        .sort((a, b) => {
            const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
            const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;

            if (timeB === timeA) {
                return 0;
            }
            return timeB - timeA;
        });

    const searchableMessages = isConversationSearchOpen ? (searchMessages ?? messages) : messages;

    const filteredMessages = searchableMessages.filter(msg =>
        msg.content.toLowerCase().includes(debouncedConversationSearchQuery.toLowerCase())
    );

    const activeUser = conversations.find(c => c.id.toString() === activeContactId.toString());
    const isCurrentMuted = activeContactId ? mutedConversations.has(activeContactId.toString()) : false;
    const conversationKey = activeContactId ? activeContactId.toString() : '';
    const lastReadForConversation = conversationKey ? lastReadTimestamps[conversationKey] : undefined;
    const isActiveGroupConversation = activeContactId === 'team' || isGroupConversationId(activeContactId);

    const parsedAttachments = useCallback((msg: Message) => {
        if (!msg.attachments) return [];
        if (typeof msg.attachments === 'string') {
            try {
                return JSON.parse(msg.attachments);
            } catch { return []; }
        }
        return msg.attachments;
    }, []);

    const estimateMessageRowHeight = useCallback((msg: Message) => {
        let height = 84;
        height += Math.min(180, Math.max(0, Math.ceil((msg.content?.length || 0) / 34) * 20));

        if (msg.reply_to_id) height += 56;
        if (!msg.user_id || msg.user_id !== user?.id) height += isActiveGroupConversation ? 22 : 0;
        if (msg.is_forwarded) height += 18;
        if (msg.is_pinned) height += 16;
        if (msg.is_edited) height += 14;

        const attachments = parsedAttachments(msg);
        if (attachments.length > 0) {
            height += attachments.length > 1 ? 220 : 190;
        } else if (msg.attachment_url) {
            height += 190;
        }

        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            height += 34;
        }

        return height;
    }, [isActiveGroupConversation, parsedAttachments, user?.id]);

    const virtualMessageRows = useMemo(() => {
        let top = 0;
        const rows: VirtualMessageRow[] = [];

        filteredMessages.forEach((msg, index) => {
            const currentDate = new Date(msg.created_at);
            const prevMessage = index > 0 ? filteredMessages[index - 1] : null;
            const prevDate = prevMessage ? new Date(prevMessage.created_at) : null;
            const currentDateKey = format(currentDate, 'yyyy-MM-dd');
            const prevDateKey = prevDate ? format(prevDate, 'yyyy-MM-dd') : null;
            const showDateSeparator = index === 0 || currentDateKey !== prevDateKey;

            if (showDateSeparator) {
                const dateLabel = isToday(currentDate)
                    ? 'Today'
                    : isYesterday(currentDate)
                        ? 'Yesterday'
                        : format(currentDate, 'MMMM d, yyyy');
                const dateKey = `date-${currentDateKey}`;
                const dateHeight = measuredRowHeightsRef.current[dateKey] || DEFAULT_DATE_ROW_HEIGHT;

                rows.push({
                    key: dateKey,
                    type: 'date',
                    top,
                    height: dateHeight,
                    dateLabel
                });
                top += dateHeight;
            }

            const rowKey = `message-${msg.id}`;
            rows.push({
                key: rowKey,
                type: 'message',
                top,
                height: measuredRowHeightsRef.current[rowKey] || estimateMessageRowHeight(msg),
                message: msg,
                index
            });
            top += measuredRowHeightsRef.current[rowKey] || estimateMessageRowHeight(msg);
        });

        void virtualLayoutVersion;
        return {
            rows,
            totalHeight: top
        };
    }, [estimateMessageRowHeight, filteredMessages, virtualLayoutVersion]);

    const visibleVirtualRows = useMemo(() => {
        const startBoundary = Math.max(0, viewportMetrics.scrollTop - HISTORY_OVERSCAN_PX);
        const endBoundary = viewportMetrics.scrollTop + viewportMetrics.height + HISTORY_OVERSCAN_PX;
        const rows = virtualMessageRows.rows;

        let startIndex = 0;
        while (startIndex < rows.length && rows[startIndex].top + rows[startIndex].height < startBoundary) {
            startIndex += 1;
        }

        let endIndex = startIndex;
        while (endIndex < rows.length && rows[endIndex].top < endBoundary) {
            endIndex += 1;
        }

        return rows.slice(startIndex, endIndex);
    }, [viewportMetrics.height, viewportMetrics.scrollTop, virtualMessageRows.rows]);

    useLayoutEffect(() => {
        if (!isVisible) return;
        if (!shouldStickToBottomRef.current) return;
        if (pendingPrependScrollRef.current) return;

        const viewport = getMessageViewport();
        if (!viewport) return;

        viewport.scrollTop = viewport.scrollHeight;
        setViewportMetrics({
            scrollTop: viewport.scrollTop,
            height: viewport.clientHeight
        });
    }, [getMessageViewport, isVisible, virtualMessageRows.totalHeight]);

    const renderAttachment = (msg: Message) => {
        // Multi-attachment support
        if (msg.attachments && msg.attachments.length > 0) {
            return (
                <div className={`mt-2 grid gap-2 ${parsedAttachments(msg).length > 1 ? 'grid-cols-2' : 'grid-cols-1'} max-w-[300px]`}>
                    {parsedAttachments(msg).map((rawFile: unknown, index: number) => {
                        const file = rawFile as { url?: string; type?: string; name?: string; size?: number };
                        const fullUrl = getAssetUrl(file?.url);
                        const isImage = String(file?.type || '').startsWith('image/');
                        const isVideo = String(file?.type || '').startsWith('video/');

                        if (isImage) {
                            return (
                                <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-200 cursor-zoom-in shadow-sm hover:shadow-md transition"
                                    onClick={(e) => { e.stopPropagation(); setSelectedMedia({ url: fullUrl, type: 'image' }); }}>
                                    <img src={fullUrl} alt={file?.name || 'Image'} loading="lazy" decoding="async" width={320} height={320} className="w-full h-full object-cover" />
                                </div>
                            );
                        }

                        if (isVideo) {
                            return (
                                <div key={index} className="relative rounded-lg overflow-hidden shadow-sm hover:shadow-md transition"
                                    onClick={(e) => e.stopPropagation()}>
                                    <VideoAttachment url={fullUrl} />
                                </div>
                            );
                        }

                        // Non-image/video file
                        return (
                            <a key={index} href={fullUrl} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex flex-col items-center justify-center p-3 rounded-lg bg-50 border border-200 hover:bg-indigo-50 hover:border-indigo-200 transition-colors aspect-square group">
                                <Paperclip size={24} className="text-400 group-hover:text-indigo-500 mb-1 transition-colors" />
                                <span className="text-[10px] text-600 font-medium truncate w-full text-center px-1">{file?.name || 'Attachment'}</span>
                                <span className="text-[9px] text-400">{((file?.size || 0) / 1024).toFixed(0)} KB</span>
                            </a>
                        );
                    })}
                </div>
            );
        }

        if (!msg.attachment_url) return null;

        const fullUrl = getAssetUrl(msg.attachment_url);
        const isImage = msg.attachment_type?.startsWith('image/');
        const isVideo = msg.attachment_type?.startsWith('video/');
        const isAudio = msg.attachment_type === 'audio' || msg.attachment_type?.startsWith('audio/');

        if (isImage) {
            return (
                <div
                    className="mt-2 rounded-lg overflow-hidden cursor-zoom-in border border-200/50 shadow-sm hover:shadow-md transition-shadow"
                    onClick={() => setSelectedMedia({ url: fullUrl, type: 'image' })}
                >
                    <img
                        src={getAssetUrl(msg.attachment_url)}
                        alt="Attachment"
                        className="max-w-full max-h-[300px] object-contain bg-50"
                    />
                </div>
            );
        }

        if (isVideo) {
            return (
                <VideoAttachment url={fullUrl} />
            );
        }

        if (isAudio) {
            return (
                <div className="mt-2 p-3 rounded-2xl bg-50/50 border border-200">
                    <audio controls className="h-8 max-w-full">
                        <source src={fullUrl} type={msg.attachment_type === 'audio' ? 'audio/webm' : msg.attachment_type} />
                        Your browser does not support the audio element.
                    </audio>
                </div>
            );
        }

        if (msg.attachment_type === 'call') {
            const isVideo = msg.content.toLowerCase().includes('video');
            const isMissed = msg.content.toLowerCase().includes('missed');

            return (
                <div className={`mt-2 flex items-center gap-3 p-3 rounded-2xl border transition duration-200 ${isMissed ? 'bg-red-50/50 border-red-100/50' : 'bg-50 border-200/50'}`}>
                    <div className={`p-2 rounded-xl ${isMissed ? 'bg-red-100 text-red-600' : 'bg-200 text-600'}`}>
                        {isVideo ? (
                            isMissed ? <VideoOff size={18} /> : <Video size={18} />
                        ) : (
                            isMissed ? <PhoneOff size={18} /> : <Phone size={18} />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className={`text-sm font-bold ${isMissed ? 'text-red-700' : 'text-700'}`}>
                            {msg.content}
                        </div>
                        {!isMissed && msg.attachment_url && (
                            <div className="text-[10px] text-500 font-medium flex items-center gap-1">
                                <Clock size={10} />
                                Duration: {msg.attachment_url}
                            </div>
                        )}
                        {isMissed && (
                            <div className="text-[10px] text-red-500 font-medium">No answer</div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <a
                href={fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 mt-2 p-3 rounded-xl bg-50 border border-200 text-indigo-600 hover:bg-indigo-50 transition-colors group"
            >
                <Paperclip size={16} className="group-hover:rotate-12 transition-transform" />
                <span className="text-xs font-medium truncate max-w-[200px]">
                    {msg.attachment_url.split('/').pop()}
                </span>
            </a>
        );
    };

    const renderMessageContent = (msg: Message, isSender: boolean) => {
        const content = msg.content;

        // Helper to parse content
        const renderText = () => {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const parts: (string | React.ReactNode)[] = [];
            let lastIndex = 0;
            let match;

            while ((match = urlRegex.exec(content)) !== null) {
                if (match.index > lastIndex) {
                    parts.push(content.slice(lastIndex, match.index));
                }
                parts.push(match[0]);
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < content.length) {
                parts.push(content.slice(lastIndex));
            }

            return parts.map((part, i) => {
                if (typeof part === 'string' && part.match(urlRegex)) {
                    return (
                        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={`break-all font-medium hover:underline ${isSender ? 'text-indigo-100' : 'text-indigo-600'}`}>
                            {part}
                        </a>
                    );
                }

                if (typeof part === 'string' && part.startsWith('@')) {
                    if (isSender) {
                        return <span key={i} className="text-white font-bold">{part}</span>;
                    }
                    const mentionText = part.slice(1);
                    const lower = mentionText.toLowerCase();
                    const isMe = lower === user?.username?.toLowerCase() || lower === 'everyone' || lower === user?.department?.toLowerCase();
                    return (
                        <span key={i} className={isMe ? "bg-indigo-500/20 text-indigo-700 font-semibold px-1.5 py-0.5 rounded" : "text-blue-600 font-medium"}>
                            {part}
                        </span>
                    );
                }
                return part;
            });
        };

        return (
            <div className="flex flex-col min-w-0">
                {msg.reply_to_id && (
                    <div
                        className={`text-xs mb-1.5 p-2 rounded-lg border-l-4 select-none cursor-pointer hover:opacity-90 transition
                            ${isSender
                                ? 'bg-indigo-700/30 border-indigo-300 text-indigo-100'
                                : 'bg-100 border-indigo-500 text-600'
                            }`}
                        onClick={(e) => {
                            e.stopPropagation();
                            // Optional: Scroll to message logic could go here
                        }}
                    >
                        <div className={`font-bold mb-0.5 text-[11px] ${isSender ? 'text-indigo-200' : 'text-indigo-600'}`}>
                            {msg.reply_username || 'Unknown'}
                        </div>
                        <div className={`truncate opacity-90 max-w-[200px] ${isSender ? 'text-white/80' : 'text-500'}`}>
                            {msg.reply_content || 'Attachment'}
                        </div>
                    </div>
                )}
                <span className="wrap-break-word whitespace-pre-wrap text-[13px] leading-6 sm:text-sm">{renderText()}</span>
            </div>
        );
    };

    const renderMessageRow = (msg: Message) => {
        const isMe = msg.user_id === user?.id;
        const isUnread = !isMe && lastReadForConversation && new Date(msg.created_at) > new Date(lastReadForConversation);
        const isDirectConversation = typeof activeContactId === 'number' && !isGroupConversationId(activeContactId);

        const renderOutgoingStatus = () => {
            if (!isMe) return null;
            if (!isDirectConversation) return null;
            if (msg.group_id) return null;
            if (!msg.recipient_id) return null;

            const statusValue = String(msg.status || 'sent');
            const toneClass = isMe ? 'text-white/80' : 'text-500';

            if (statusValue === 'sending') {
                return (
                    <span className={`inline-flex items-center gap-1 ${toneClass}`} title="Sending">
                        <span className="h-2.5 w-2.5 rounded-full border border-current border-t-transparent animate-spin" />
                    </span>
                );
            }

            if (statusValue === 'seen') {
                return (
                    <span className="inline-flex items-center gap-0.5 text-cyan-300 font-semibold" title="Seen">
                        <CheckCheck size={11} />
                    </span>
                );
            }

            if (statusValue === 'delivered') {
                return (
                    <span className={`inline-flex items-center gap-0.5 ${toneClass}`} title="Delivered">
                        <CheckCheck size={11} />
                    </span>
                );
            }

            return (
                <span className={`inline-flex items-center gap-0.5 ${toneClass}`} title="Sent">
                    <Check size={11} />
                </span>
            );
        };

        return (
            <div
                className={`flex items-end gap-2 ${isMe && !selectionMode ? 'justify-end' : 'justify-start'}`}
                onClick={() => selectionMode && toggleMessageSelection(msg.id)}
            >
                {selectionMode && (
                    <div className="mr-3 self-center transition duration-200 shrink-0">
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center cursor-pointer transition ${selectedMessageIds.has(msg.id) ? 'bg-indigo-600 border-indigo-600' : 'border-300 bg-white hover:border-indigo-400'}`}>
                            {selectedMessageIds.has(msg.id) && <Check size={12} className="text-white" />}
                        </div>
                    </div>
                )}
                {!isMe && (
                    <Avatar className="mb-3 h-7 w-7 shrink-0 border border-200 shadow-sm sm:mb-4 sm:h-8 sm:w-8">
                        {msg.profile_picture && (
                            <AvatarImage
                                src={getAssetUrl(msg.profile_picture)}
                                alt={msg.username}
                                className="object-cover"
                            />
                        )}
                        <AvatarFallback className="text-white text-[10px] font-bold bg-linear-to-br from-slate-400 to-slate-500">
                            {msg.username.charAt(0).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                )}
                <div className={`min-w-0 flex-1 flex flex-col group ${isMe ? 'items-end' : 'items-start'}`}>
                    {!isMe && isActiveGroupConversation && (
                        <span className="ml-2 mb-1 flex items-center gap-1 text-[10px] font-bold text-600 sm:ml-3 sm:mb-1.5 sm:text-[11px]">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                            {msg.username}
                        </span>
                    )}
                    <ContextMenu.Root>
                        <ContextMenu.Trigger asChild>
                            <div
                                className={`relative w-fit max-w-full px-3 py-2.5 text-[13px] shadow-md text-wrap wrap-break-word transition duration-300 hover:shadow-lg sm:max-w-xl sm:px-4 sm:py-3 sm:text-sm
                                ${isMe
                                        ? 'bg-linear-to-r from-indigo-600 to-purple-600 text-white rounded-2xl rounded-tr-md'
                                        : isUnread
                                            ? 'bg-linear-to-r from-indigo-50 to-purple-50 text-800 rounded-2xl rounded-tl-md border-2 border-indigo-200'
                                            : 'bg-white text-800 rounded-2xl rounded-tl-md border border-200'
                                    }`}
                            >
                                {isUnread && (
                                    <span className="absolute -top-2 -right-2 bg-linear-to-r from-indigo-600 to-purple-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-lg">
                                        NEW
                                    </span>
                                )}

                                {msg.is_forwarded && (
                                    <div className={`flex items-center gap-1 mb-1 opacity-80 italic text-[10px] ${isMe ? 'text-white/80' : 'text-600'}`}>
                                        <ForwardIcon size={11} className={isMe ? 'text-white/70' : 'text-500'} />
                                        <span>Forwarded</span>
                                    </div>
                                )}

                                {editingMessageId === msg.id ? (
                                    <div className="flex flex-col gap-2 min-w-[200px]">
                                        <Input
                                            value={editContent}
                                            onChange={(e) => setEditContent(e.target.value)}
                                            className={`h-8 border-none focus-visible:ring-1 ${isMe ? 'bg-white/30 text-inherit placeholder:text-white/70 focus-visible:ring-white/50' : 'bg-100 text-800 focus-visible:ring-indigo-500/30'}`}
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msg.id); }
                                                if (e.key === 'Escape') cancelEditing();
                                            }}
                                        />
                                        <div className="flex justify-end gap-2">
                                            <span className="text-[10px] opacity-70 cursor-pointer hover:opacity-100 font-medium" onClick={(e) => { e.stopPropagation(); cancelEditing(); }}>Cancel</span>
                                            <span className="text-[10px] font-bold opacity-90 cursor-pointer hover:opacity-100 bg-white/30 px-2 rounded" onClick={(e) => { e.stopPropagation(); saveEdit(msg.id); }}>Save</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="leading-relaxed">
                                        {renderMessageContent(msg, isMe)}
                                        {renderAttachment(msg)}
                                        {msg.is_edited && <span className="text-[9px] opacity-60 ml-1">(edited)</span>}

                                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {Object.entries(msg.reactions).map(([emoji, userIds]) => (
                                                    <div
                                                        key={emoji}
                                                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] shadow-sm transform transition cursor-pointer hover:scale-105 ${userIds.includes(user?.id ?? -1) ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-white text-600 border border-200'}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleAddReaction(msg.id, emoji);
                                                        }}
                                                    >
                                                        <span>{emoji}</span>
                                                        <span className="font-bold">{userIds.length}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {msg.is_pinned && (
                                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm border border-yellow-200 flex items-center gap-1">
                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1-2.5V7a8 8 0 0 0-16 0v5.74a2 2 0 0 0-1 2.5V17z"></path></svg>
                                        Pinned
                                    </div>
                                )}

                                <div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${isMe ? 'text-white/70' : 'text-400'}`}>
                                    <span>{format(new Date(msg.created_at), 'h:mm a')}</span>
                                    {renderOutgoingStatus()}
                                </div>
                            </div>
                        </ContextMenu.Trigger>
                        <ContextMenu.Portal>
                            <ContextMenu.Content className="min-w-[220px] bg-[#232323] rounded-2xl shadow-2xl border border-white/10 p-2 z-500 animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-white/10">
                                    {['ðŸ‘', 'â¤ï¸', 'ðŸ˜‚', 'ðŸ˜®', 'ðŸ˜¢', 'ðŸ™'].map((emoji) => (
                                        <button
                                            key={emoji}
                                            className={`w-8 h-8 flex items-center justify-center text-lg hover:bg-white/10 rounded-full transition-colors cursor-pointer ${msg.reactions?.[emoji]?.includes(user?.id ?? -1) ? 'bg-white/20' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleAddReaction(msg.id, emoji);
                                            }}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                    <button
                                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-400 hover:text-white transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id);
                                        }}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    </button>
                                </div>

                                {reactionPickerMsgId === msg.id && (
                                    <div className="absolute left-full top-0 ml-2 z-600 [&_*]:scrollbar-none [&_*::-webkit-scrollbar]:hidden" onClick={(e) => e.stopPropagation()}>
                                        <Suspense fallback={<div className="h-[350px] w-[300px] rounded-xl bg-[#232323] border border-white/10" />}>
                                            <EmojiPicker
                                                onEmojiClick={(emojiData: EmojiClickData) => {
                                                    handleAddReaction(msg.id, emojiData.emoji);
                                                    setReactionPickerMsgId(null);
                                                }}
                                                theme={"dark" as React.ComponentProps<typeof EmojiPicker>['theme']}
                                                width={300}
                                                height={350}
                                            />
                                        </Suspense>
                                    </div>
                                )}

                                <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-300 hover:bg-white/10 hover:text-white transition-colors" onSelect={() => startReplying(msg)}>
                                    <div className='flex items-center justify-center w-5'><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-400 group-hover:text-white"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg></div>
                                    Reply
                                </ContextMenu.Item>

                                <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-300 hover:bg-white/10 hover:text-white transition-colors" onSelect={() => {
                                    navigator.clipboard.writeText(msg.content);
                                    setToast({ message: 'Copied to clipboard', type: 'success' });
                                }}>
                                    <div className='flex items-center justify-center w-5'><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-400 group-hover:text-white"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></div>
                                    Copy
                                </ContextMenu.Item>

                                <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-300 hover:bg-white/10 hover:text-white transition-colors" onSelect={() => handleForwardMessage(msg)}>
                                    <div className='flex items-center justify-center w-5'><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-400 group-hover:text-white"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg></div>
                                    Forward
                                </ContextMenu.Item>

                                <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-300 hover:bg-white/10 hover:text-white transition-colors" onSelect={() => handleTogglePin(msg.id)}>
                                    <div className='flex items-center justify-center w-5'><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-400 group-hover:text-white"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1-2.5V7a8 8 0 0 0-16 0v5.74a2 2 0 0 0-1 2.5V17z"></path></svg></div>
                                    {msg.is_pinned ? 'Unpin' : 'Pin'}
                                </ContextMenu.Item>

                                <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-red-400 hover:bg-white/10 hover:text-red-300 transition-colors" onSelect={() => handleSelectMode(msg.id)}>
                                    <div className='flex items-center justify-center w-5'><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-400 group-hover:text-red-400"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></div>
                                    Select
                                </ContextMenu.Item>

                                <div className="h-px bg-white/10 my-1"></div>

                                {isMe && (
                                    <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-300 hover:bg-white/10 hover:text-white transition-colors" onSelect={() => startEditing(msg)}>
                                        <div className='flex items-center justify-center w-5'><Edit2 size={14} className="text-400 group-hover:text-white" /></div>
                                        Edit
                                    </ContextMenu.Item>
                                )}

                                <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-400 transition-colors" onSelect={() => handleDeleteMessage(msg.id, 'me')}>
                                    <div className='flex items-center justify-center w-5'><Trash2 size={14} className="text-red-400" /></div>
                                    Delete for Me
                                </ContextMenu.Item>

                                {(isMe || user?.role === 'admin') && (
                                    <ContextMenu.Item className="group flex items-center gap-3 px-3 py-2 text-sm font-medium outline-none cursor-pointer rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-400 transition-colors" onSelect={() => handleDeleteMessage(msg.id, 'everyone')}>
                                        <div className='flex items-center justify-center w-5'><Trash2 size={14} className="text-red-400 opacity-70" /></div>
                                        Delete for Everyone
                                    </ContextMenu.Item>
                                )}
                            </ContextMenu.Content>
                        </ContextMenu.Portal>
                    </ContextMenu.Root>
                </div>
            </div>
        );
    };

    const isShowingConversationList = isMobileLayout && (showMobileConversationList || !activeContactId);

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-linear-to-br from-slate-50 to-slate-100 shadow-2xl md:flex-row">
            {/* Toast Notification */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
                <div className={cn(
                    "min-h-0 border-r border-200 bg-white flex-col md:flex md:w-[340px]",
                    isShowingConversationList ? "flex w-full" : "hidden"
                )} ref={sidebarRef}>
                <div className="shrink-0 space-y-4 border-b border-200/50 bg-slate-50 p-5">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-xl text-900 tracking-tight">Messages</h3>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-100 transition duration-200">
                                    <MoreVertical size={18} className="text-600" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem className="cursor-pointer flex items-center gap-2" onClick={() => setIsCreateGroupOpen(true)}>
                                    <Plus size={14} />
                                    Create Group
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-400 transition-colors group-focus-within:text-indigo-500" />
                        <Input
                            placeholder="Search conversations..."
                            className="pl-10 bg-50 border-200 h-10 rounded-xl focus:ring-2 focus:ring-indigo-500/20 transition duration-200"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="p-2 space-y-1">
                        {filteredConversations.map((conv, idx) => {
                            const isMuted = mutedConversations.has(conv.id.toString());
                            return (
                                <div
                                    key={conv.id}
                                    onMouseDown={() => startLongPress(conv.id)}
                                    onMouseUp={cancelLongPress}
                                    onMouseLeave={cancelLongPress}
                                    onTouchStart={() => startLongPress(conv.id)}
                                    onTouchEnd={cancelLongPress}
                                    onClick={() => handleConversationClick(conv.id)}
                                    style={{ animationDelay: `${idx * 30}ms` }}
                                    className={`flex gap-3 p-3 rounded-xl cursor-pointer transition duration-300 group relative animate-in fade-in slide-in-from-left-3
                                        ${activeContactId === conv.id
                                            ? 'bg-linear-to-r from-indigo-50 to-purple-50 shadow-md border border-indigo-100 scale-[1.02]'
                                            : 'hover:bg-50 hover:scale-[1.01]'}
                                        ${isLongPressing === conv.id ? 'scale-95 bg-100 opacity-80' : ''}
                                    `}
                                >
                                    {/* Avatar with animation */}
                                    <div className="relative shrink-0 flex items-center gap-3">
                                        {isConversationSelectionMode && (
                                            <div
                                                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition duration-200 ${selectedConversationIds.has(conv.id)
                                                    ? 'bg-indigo-600 border-indigo-600'
                                                    : 'border-300 hover:border-indigo-400'
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleConversationSelection(conv.id);
                                                }}
                                            >
                                                {selectedConversationIds.has(conv.id) && (
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                    </svg>
                                                )}
                                            </div>
                                        )}
                                        <div className="relative">
                                            <Avatar className={`h-11 w-11 shrink-0 aspect-square border-2 shadow-sm transition duration-300 ${activeContactId === conv.id ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-white'}`}>
                                                {conv.id === 'team' || conv.type === 'group' ? (
                                                    <AvatarFallback className="bg-linear-to-br from-indigo-500 to-purple-600 text-white shrink-0">
                                                        <UsersIcon size={20} />
                                                    </AvatarFallback>
                                                ) : (
                                                    <>
                                                        {conv.profile_picture && (
                                                            <AvatarImage
                                                                src={getAssetUrl(conv.profile_picture)}
                                                                alt={conv.username}
                                                                className="object-cover w-full h-full"
                                                            />
                                                        )}
                                                        <AvatarFallback className={`text-white font-bold text-base transition duration-300 shrink-0 ${activeContactId === conv.id
                                                            ? 'bg-linear-to-br from-indigo-500 to-purple-600'
                                                            : 'bg-linear-to-br from-slate-400 to-slate-500'
                                                            }`}>
                                                            {conv.username.charAt(0).toUpperCase()}
                                                        </AvatarFallback>
                                                    </>
                                                )}
                                            </Avatar>

                                            {conv.type === 'direct' && (
                                                <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-white rounded-full transition duration-300 ${conv.status === 'active' ? 'bg-green-500 animate-pulse' :
                                                    conv.status === 'break' ? 'bg-yellow-500' :
                                                        'bg-400'
                                                    }`} />
                                            )}
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        <div className="flex justify-between items-baseline mb-1">
                                            <div className="flex items-center gap-2 truncate">
                                                <span className={`font-semibold truncate transition-colors duration-200 ${activeContactId === conv.id ? 'text-900' : 'text-700'
                                                    } ${(unreadCounts[conv.id] || 0) > 0 ? 'font-bold' : ''}`}>
                                                    {conv.username}
                                                </span>
                                                {isMuted && <BellOff size={12} className="text-400" />}
                                            </div>
                                            {conv.lastMessageTime && (
                                                <span className={`text-[11px] shrink-0 transition-colors duration-200 ${(unreadCounts[conv.id] || 0) > 0 ? 'text-indigo-600 font-bold' : 'text-400'
                                                    }`}>
                                                    {formatMessageTime(conv.lastMessageTime)}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex justify-between items-center">
                                            <ConversationTypingPreview
                                                conversationId={conv.id.toString()}
                                                conversations={conversations}
                                                getAssetUrl={getAssetUrl}
                                                isGroup={conv.type === 'group' || conv.id === 'team'}
                                                fallbackText={conv.lastMessage || (conv.type === 'group' ? `${conv.memberCount || 0} members` : 'Direct message')}
                                                unreadCount={unreadCounts[conv.id] || 0}
                                            />

                                            {(unreadCounts[conv.id] || 0) > 0 && (
                                                <span className="bg-linear-to-r from-indigo-600 to-purple-600 text-white text-[10px] font-bold px-2 py-1 rounded-full min-w-[20px] text-center shadow-md animate-in zoom-in">
                                                    {(unreadCounts[conv.id] || 0) > 9 ? '9+' : (unreadCounts[conv.id] || 0)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>

            {/* Chat Area */}
            <div className={cn(
                "relative flex-1 min-h-0 flex-col overflow-hidden bg-linear-to-br from-slate-50 via-white to-indigo-50/30",
                isShowingConversationList ? "hidden md:flex" : "flex"
            )}>
                {/* Animated Background Pattern */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                    style={{
                        backgroundImage: `radial-gradient(circle at 25px 25px, rgba(99, 102, 241, 0.2) 2%, transparent 0%), 
                                         radial-gradient(circle at 75px 75px, rgba(168, 85, 247, 0.2) 2%, transparent 0%)`,
                        backgroundSize: '100px 100px'
                    }}>
                </div>

                {/* Header */}
                <div className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-200 bg-white px-3 shadow-sm sm:h-20 sm:px-6">
                    <div className="flex min-w-0 items-center gap-2.5 sm:gap-4">
                        {isMobileLayout && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowMobileConversationList(true)}
                                className="h-8 w-8 shrink-0 rounded-full hover:bg-100 sm:h-9 sm:w-9"
                            >
                                <ArrowLeft size={16} />
                            </Button>
                        )}
                        <Avatar className="h-10 w-10 border-2 border-white shadow-lg ring-2 ring-indigo-100 sm:h-12 sm:w-12">
                            {activeUser ? (
                                activeUser.id === 'team' || activeUser.type === 'group' ? (
                                    <AvatarFallback className="bg-linear-to-br from-indigo-500 to-purple-600 text-white">
                                        <UsersIcon size={22} />
                                    </AvatarFallback>
                                ) : (
                                    <>
                                        {activeUser.profile_picture && (
                                            <AvatarImage
                                                src={getAssetUrl(activeUser.profile_picture)}
                                                alt={activeUser.username}
                                                className="object-cover"
                                            />
                                        )}
                                        <AvatarFallback className="bg-linear-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white sm:text-lg">
                                            {activeUser.username.charAt(0).toUpperCase()}
                                        </AvatarFallback>
                                    </>
                                )
                            ) : null}
                        </Avatar>
                        <div className="min-w-0">
                            <h3 className="flex items-center gap-1.5 truncate text-sm font-bold text-900 sm:gap-2 sm:text-lg">
                                {activeUser ? activeUser.username : "Loading..."}
                                {isCurrentMuted && <BellOff size={16} className="text-400" />}
                            </h3>
                            {activeUser && activeUser.type === 'direct' && (
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-500 sm:gap-1.5 sm:text-xs">
                                    <span className={`w-2 h-2 rounded-full ${activeUser.status === 'active' ? 'bg-green-500 animate-pulse' :
                                        activeUser.status === 'break' ? 'bg-yellow-500' :
                                            'bg-400'
                                        }`}></span>
                                    {activeUser.status === 'active' ? 'Active now' : activeUser.status === 'break' ? 'On break' : 'Offline'}
                                </p>
                            )}
                            {activeUser && activeUser.type === 'group' && (
                                <p 
                                    className="mt-0.5 cursor-pointer text-[11px] text-500 transition-colors hover:text-indigo-600 hover:underline sm:text-xs"
                                    onClick={handleFetchGroupMembers}
                                >
                                    {activeUser.memberCount || 0} members
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                        {/* Call Buttons - Only show for DMs */}
                        {typeof activeContactId === 'number' && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => initiateCall('audio')}
                                    className="h-9 w-9 rounded-full hover:bg-green-50 hover:text-green-600 transition duration-200"
                                    title="Audio Call"
                                >
                                    <Phone size={18} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => initiateCall('video')}
                                    className="h-9 w-9 rounded-full hover:bg-blue-50 hover:text-blue-600 transition duration-200"
                                    title="Video Call"
                                >
                                    <Video size={18} />
                                </Button>
                            </>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full hover:bg-indigo-50 hover:text-indigo-600 transition duration-200">
                                    <MoreVertical size={18} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={toggleMute} className="gap-2 cursor-pointer">
                                    {isCurrentMuted ? <Bell size={16} /> : <BellOff size={16} />}
                                    {isCurrentMuted ? 'Unmute Notifications' : 'Mute Notifications'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => setIsConversationSearchOpen(true)}
                                    className="gap-2 cursor-pointer"
                                >
                                    <Search size={16} />
                                    Search in Conversation
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {/* Conversation Search Bar */}
                {isConversationSearchOpen && (
                    <div className="flex shrink-0 items-center gap-3 border-b border-200 bg-white px-4 py-3 animate-in slide-in-from-top-2 sm:px-6">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-400" />
                            <Input
                                value={conversationSearchQuery}
                                onChange={(e) => setConversationSearchQuery(e.target.value)}
                                placeholder="Search in this conversation..."
                                className="pl-10 h-10 bg-50 border-200 focus-visible:ring-indigo-500/20"
                                autoFocus
                            />
                        </div>
                        <div className="text-xs text-500 font-medium whitespace-nowrap">
                            {isSearchLoadingAll
                                ? 'Loading full history...'
                                : `${filteredMessages.length} ${filteredMessages.length === 1 ? 'result' : 'results'}`}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-400 hover:bg-100"
                            onClick={closeConversationSearch}
                        >
                            <span className="text-lg leading-none">x</span>
                        </Button>
                    </div>
                )}

                {/* Pinned Message Header */}
                {messages.find(m => m.is_pinned) && (
                    <div className="z-20 flex shrink-0 items-center justify-between border-b border-indigo-100 bg-indigo-50 px-4 py-3 shadow-sm animate-in slide-in-from-top-2 sm:px-6">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className="bg-indigo-100 p-1.5 rounded-lg shrink-0">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-600"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1-2.5V7a8 8 0 0 0-16 0v5.74a2 2 0 0 0-1 2.5V17z"></path></svg>
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[10px] grid font-bold text-indigo-600 uppercase tracking-wider">Pinned Message</span>
                                <span className="text-xs text-700 truncate font-medium max-w-md">
                                    {messages.find(m => m.is_pinned)?.content || (messages.find(m => m.is_pinned)?.attachment_url ? 'Attachment' : '')}
                                </span>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-[10px] h-6 px-2 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 font-bold"
                            onClick={() => {
                                const pinned = messages.find(m => m.is_pinned);
                                if (pinned) handleTogglePin(pinned.id);
                            }}
                        >
                            Unpin
                        </Button>
                    </div>
                )}

                {/* Messages */}
                <ScrollArea ref={messageScrollAreaRef} className="z-10 min-h-0 flex-1 p-4 sm:p-6">
                    <div className="space-y-4 max-w-4xl mx-auto">
                        {filteredMessages.length === 0 && debouncedConversationSearchQuery && (
                            <div className="flex flex-col items-center justify-center py-20 text-400">
                                <Search size={48} className="mb-4 opacity-20" />
                                <p className="text-lg font-medium">No messages found matching "{debouncedConversationSearchQuery}"</p>
                                <p className="text-sm">Try a different keyword or clear the search.</p>
                            </div>
                        )}
                        {isConversationSearchOpen && isSearchLoadingAll && (
                            <div className="flex items-center justify-center">
                                <span className="text-[11px] font-medium text-400">Indexing full conversation for search...</span>
                            </div>
                        )}
                        {!isConversationSearchOpen && hasMoreHistory && (
                            <div className="flex items-center justify-center pt-1">
                                <span className="text-[11px] font-medium text-400">
                                    {isOlderHistoryLoading ? 'Loading older messages...' : 'Scroll up to load older messages'}
                                </span>
                            </div>
                        )}
                        {isHistoryLoading && filteredMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-400">
                                <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"></div>
                                <p className="text-sm font-medium">Loading messages...</p>
                            </div>
                        ) : (
                            <div className="relative" style={{ height: virtualMessageRows.totalHeight }}>
                                {visibleVirtualRows.map((row) => (
                                    <div
                                        key={row.key}
                                        ref={measureVirtualRow(row.key)}
                                        className="absolute left-0 right-0"
                                        style={{ top: row.top }}
                                    >
                                        {row.type === 'date' ? (
                                            <div className="flex items-center justify-center py-2">
                                                <span className="rounded-full border border-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-600 shadow-sm">
                                                    {row.dateLabel}
                                                </span>
                                            </div>
                                        ) : (
                                            renderMessageRow(row.message)
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Legacy rendering block removed */}

                        <MessageTypingIndicator
                            conversationId={activeContactId ? activeContactId.toString() : ''}
                            conversations={conversations}
                            getAssetUrl={getAssetUrl}
                            isGroup={isActiveGroupConversation}
                        />

                        <div ref={scrollRef} />
                    </div >
                </ScrollArea >

                {
                    selectionMode ? (
                        <div className="relative z-10 flex shrink-0 items-center justify-between border-t border-white/10 bg-[#1a1a1a] p-4 text-white" >
                            <div className="flex items-center gap-4">
                                <button onClick={() => { setSelectionMode(false); setSelectedMessageIds(new Set()); }} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                                <span className="font-medium">{selectedMessageIds.size} selected</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={handleBulkCopy} className="text-400 hover:text-white hover:bg-white/10 rounded-full h-10 w-10">
                                    <Copy size={20} />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={handleBulkDelete} className="text-400 hover:text-red-400 hover:bg-white/10 rounded-full h-10 w-10">
                                    <Trash2 size={20} />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={handleBulkForward} className="text-400 hover:text-white hover:bg-white/10 rounded-full h-10 w-10">
                                    <ForwardIcon size={20} />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        /* Input Area */
                        <div className="relative z-10 shrink-0 border-t border-200 bg-white p-3 sm:p-5">
                            {/* Mention Popup */}
                            {mentionSearch !== null && (activeContactId === 'team' || isGroupConversationId(activeContactId)) && (
                                <div className="absolute bottom-full left-6 mb-3 w-72 bg-white border border-200 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                                    <div className="p-3 bg-linear-to-r from-indigo-50 to-purple-50 border-b border-200 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                                        <span className="text-xs font-bold text-700 uppercase tracking-wider">Mention Someone</span>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto p-2">
                                        {mentionCandidates.map((c, i) => (
                                            <div
                                                key={String(c.id)}
                                                className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer text-sm font-medium transition duration-200 ${i === mentionIndex
                                                    ? 'bg-linear-to-r from-indigo-50 to-purple-50 text-indigo-700 scale-[1.02]'
                                                    : 'hover:bg-50 text-700'
                                                    }`}
                                                onClick={() => insertMention(c)}
                                            >
                                                <Avatar className="w-8 h-8 border border-200 shadow-sm">
                                                    {c.username !== 'everyone' && !String(c.id).startsWith('group-') && (c as { profile_picture?: string }).profile_picture && (
                                                        <AvatarImage
                                                            src={getAssetUrl((c as { profile_picture?: string }).profile_picture)}
                                                            alt={c.username}
                                                            className="object-cover"
                                                        />
                                                    )}
                                                    <AvatarFallback className={`text-[10px] font-bold ${i === mentionIndex
                                                        ? 'bg-linear-to-br from-indigo-500 to-purple-600 text-white'
                                                        : 'bg-100 text-600'
                                                        }`}>
                                                        {(c.username === 'everyone' || String(c.id).startsWith('group-')) ? '@' : c.username.charAt(0).toUpperCase()}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <span>{c.username}</span>
                                            </div>
                                        ))}
                                        {mentionCandidates.length === 0 && (
                                            <div className="p-4 text-xs text-400 text-center">No matching users or groups</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Emoji Picker */}
                            {showEmojiPicker && (
                                <div className="absolute bottom-full left-6 mb-3 z-50">
                                    <div className="shadow-2xl rounded-2xl overflow-hidden border border-200 animate-in fade-in slide-in-from-bottom-4">
                                        <Suspense fallback={<div className="h-[400px] w-[300px] bg-white" />}>
                                            <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
                                        </Suspense>
                                    </div>
                                </div>
                            )}

                            {/* File Preview */}
                            {selectedFiles.length > 0 && (
                                <div className="mb-2 p-2 bg-50/90 backdrop-blur rounded-xl border border-200 border-l-4 border-l-green-500 shadow-sm animate-in slide-in-from-bottom-2">
                                    <div className="flex gap-2 overflow-x-auto pb-1 pt-3 px-2 scrollbar-thin scrollbar-thumb-slate-300 items-start">
                                        {selectedFiles.map((fileData, index) => (
                                            <div key={index} className="relative shrink-0 group">
                                                <div className="h-16 w-16 rounded-lg overflow-hidden bg-white border border-200 shadow-sm">
                                                    {fileData.file.type.startsWith('image/') ? (
                                                        <img src={fileData.preview} alt="Preview" loading="lazy" decoding="async" width={80} height={80} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="h-full w-full flex flex-col items-center justify-center p-1">
                                                            <Paperclip size={16} className="text-400 mb-1" />
                                                            <span className="text-[8px] text-500 truncate w-full text-center">{fileData.file.name.slice(-6)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => removeFile(index)}
                                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-transform hover:scale-110 z-10 border-2 border-white"
                                                    title="Remove file"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                        <div className="flex flex-col justify-center px-2 text-xs text-500">
                                            <span className="font-bold">{selectedFiles.length} files</span>
                                            <span>{(selectedFiles.reduce((acc, curr) => acc + curr.file.size, 0) / 1024 / 1024).toFixed(2)} MB</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {replyingTo && (
                                <div className="mb-2 flex items-center justify-between bg-50/90 backdrop-blur p-2 rounded-lg border border-200 border-l-4 border-l-indigo-500 shadow-sm animate-in slide-in-from-bottom-2">
                                    <div className="flex flex-col text-xs overflow-hidden mr-2">
                                        <span className="font-bold text-indigo-600">Replying to {replyingTo.username}</span>
                                        <span className="truncate text-500 max-w-[300px]">{replyingTo.content || (replyingTo.attachment_url ? 'Attachment' : 'Message')}</span>
                                    </div>
                                    <button onClick={cancelReply} className="p-1 hover:bg-200 rounded-full transition-colors">
                                        <X size={14} />
                                    </button>
                                </div>
                            )}

                            <div className="flex items-end gap-1 rounded-2xl border border-200 bg-white p-1.5 shadow-lg transition duration-300 hover:shadow-xl focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-500/20 sm:gap-3 sm:p-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={`h-8 w-8 shrink-0 rounded-full transition duration-200 sm:h-9 sm:w-9 ${showEmojiPicker ? 'bg-indigo-50 text-indigo-600' : 'text-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                >
                                    <Smile size={18} />
                                </Button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    multiple
                                    onChange={handleFileSelect}
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 rounded-full text-400 transition duration-200 hover:bg-indigo-50 hover:text-indigo-600 sm:h-9 sm:w-9"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Paperclip size={18} />
                                </Button>
                                <Textarea
                                    ref={inputRef}
                                    value={newMessage}
                                    onChange={handleInputChange}
                                    onKeyDown={handleKeyPress}
                                    placeholder={isMobileLayout ? "Message..." : `Message ${activeUser?.username || "..."}...`}
                                    rows={1}
                                    className="h-10 min-h-0 min-w-0 max-h-[140px] flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-1.5 py-2 text-[13px] leading-5 text-700 placeholder:text-400 focus-visible:ring-0 sm:px-2 sm:text-sm"
                                    disabled={isRecording}
                                />

                                {/* Voice Recording UI */}
                                {isRecording ? (
                                    <div className="flex items-center gap-1.5 pr-1 sm:gap-2">
                                        <span className="hidden items-center gap-1 text-sm font-medium text-red-500 animate-pulse sm:flex">
                                            <div className="w-2 h-2 bg-red-500 rounded-full" />
                                            {formatRecordingTime(recordingTime)}
                                        </span>
                                        <Button
                                            onClick={stopRecording}
                                            size="icon"
                                            className="h-8 w-8 shrink-0 rounded-full bg-red-500 shadow-md transition duration-300 hover:scale-105 hover:bg-red-600 active:scale-95 sm:h-9 sm:w-9"
                                            title="Stop Recording"
                                        >
                                            <StopCircle size={18} />
                                        </Button>
                                    </div>
                                ) : isRecordingFinished ? (
                                    <div className="flex items-center gap-1.5 pr-1 sm:gap-2">
                                        <span className="hidden rounded-lg bg-100 px-2 py-1 text-xs font-medium text-400 sm:inline-flex">
                                            Recording: {formatRecordingTime(recordingTime)}
                                        </span>
                                        <Button
                                            onClick={discardRecording}
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full text-400 transition duration-200 hover:bg-red-50 hover:text-red-500 sm:h-9 sm:w-9"
                                            title="Delete Recording"
                                        >
                                            <Trash2 size={18} />
                                        </Button>
                                        <Button
                                            onClick={sendVoiceMessage}
                                            size="icon"
                                            className="h-8 w-8 shrink-0 rounded-full bg-indigo-600 shadow-md transition duration-300 hover:scale-105 hover:bg-indigo-700 active:scale-95 sm:h-9 sm:w-9"
                                            title="Send Voice Message"
                                        >
                                            <Send size={18} className="ml-0.5" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <Button
                                            onClick={startRecording}
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full text-400 transition duration-200 hover:bg-red-50 hover:text-red-500 sm:h-9 sm:w-9"
                                            title="Record Voice Message"
                                        >
                                            <Mic size={18} />
                                        </Button>
                                        <Button
                                            onClick={handleSend}
                                            size="icon"
                                            disabled={(!newMessage.trim() && selectedFiles.length === 0) || isUploading}
                                            className="h-9 w-9 shrink-0 rounded-xl bg-linear-to-r from-indigo-600 to-purple-600 shadow-md transition duration-300 hover:scale-105 hover:from-indigo-700 hover:to-purple-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10"
                                        >
                                            {isUploading ? (
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            ) : (
                                                <Send size={18} className="ml-0.5" />
                                            )}
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
            </div >
            <Dialog open={isCreateGroupOpen} onOpenChange={setIsCreateGroupOpen}>
                <DialogContent className="sm:max-w-[520px] bg-white border-200">
                    <DialogHeader>
                        <DialogTitle>Create Group</DialogTitle>
                        <DialogDescription>
                            Create a private chat group and choose the members who should join it.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-700">Group Name</label>
                            <Input
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                placeholder="Design Team"
                                className="bg-white"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-700">Members</label>
                                <span className="text-xs text-500">{selectedGroupMemberIds.size} selected</span>
                            </div>
                            <div className="max-h-[260px] overflow-y-auto rounded-2xl border border-200 bg-50 p-2 space-y-1">
                                {directContacts.map((contact) => (
                                    <button
                                        key={contact.id}
                                        type="button"
                                        onClick={() => toggleGroupMember(contact.id as number)}
                                        className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${selectedGroupMemberIds.has(contact.id as number) ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-white border border-transparent'}`}
                                    >
                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${selectedGroupMemberIds.has(contact.id as number) ? 'bg-indigo-600 border-indigo-600' : 'border-300 bg-white'}`}>
                                            {selectedGroupMemberIds.has(contact.id as number) && <Check size={12} className="text-white" />}
                                        </div>
                                        <Avatar className="h-10 w-10 border border-white shadow-sm">
                                            {contact.profile_picture && (
                                                <AvatarImage
                                                    src={getAssetUrl(contact.profile_picture)}
                                                    alt={contact.username}
                                                    className="object-cover"
                                                />
                                            )}
                                            <AvatarFallback className="bg-linear-to-br from-slate-400 to-slate-500 text-white font-bold">
                                                {contact.username.charAt(0).toUpperCase()}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <div className="font-medium text-900 truncate">{contact.username}</div>
                                            <div className="text-xs text-500 truncate">{contact.department || 'Member'}</div>
                                        </div>
                                    </button>
                                ))}
                                {directContacts.length === 0 && (
                                    <div className="px-3 py-6 text-center text-sm text-500">
                                        No members available.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsCreateGroupOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleCreateGroup}
                                disabled={isCreatingGroup}
                                className="bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                            >
                                {isCreatingGroup ? 'Creating...' : 'Create Group'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Forward Dialog */}
            {
                isForwardDialogOpen && (
                    <div className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="w-full max-w-[400px] bg-[#1a1a1a] rounded-[24px] shadow-2xl overflow-hidden text-white animate-in zoom-in-95 duration-200">
                            {/* Header */}
                            <div className="p-5 flex items-center gap-4 border-b border-white/5">
                                <button onClick={() => setIsForwardDialogOpen(false)} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                                <h3 className="text-xl font-semibold">Forward message to</h3>
                            </div>

                            {/* Search */}
                            <div className="p-4">
                                <div className="relative group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-500 transition-colors group-focus-within:text-green-500" />
                                    <Input
                                        placeholder="Search name or number"
                                        value={forwardSearchQuery}
                                        onChange={(e) => setForwardSearchQuery(e.target.value)}
                                        className="pl-12 bg-[#2a2a2a] border-none h-12 rounded-full text-white placeholder:text-500 focus-visible:ring-1 focus-visible:ring-green-500/50"
                                    />
                                </div>
                            </div>

                            {/* Recent Chats */}
                            <div className="px-2 pb-4">
                                <p className="px-4 py-2 text-xs font-bold text-green-500 uppercase tracking-widest opacity-80">Recent chats</p>
                                <ScrollArea className="h-[350px]">
                                    <div className="space-y-1">
                                        {filteredForwardContacts.map((contact) => (
                                            <div
                                                key={contact.id}
                                                onClick={() => toggleForwardTarget(contact.id)}
                                                className={`flex items-center gap-4 p-3 mx-2 rounded-2xl cursor-pointer transition duration-200 ${selectedForwardTargets.has(contact.id) ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                            >
                                                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition duration-200 ${selectedForwardTargets.has(contact.id) ? 'bg-green-500 border-green-500' : 'border-600'}`}>
                                                    {selectedForwardTargets.has(contact.id) && <Check size={14} className="text-white" />}
                                                </div>
                                                <Avatar className="h-12 w-12 border border-white/10">
                                                    {contact.id === 'team' || contact.type === 'group' ? (
                                                        <AvatarFallback className="bg-linear-to-br from-indigo-500 to-purple-600 text-white">
                                                            <UsersIcon size={20} />
                                                        </AvatarFallback>
                                                    ) : (
                                                        <>
                                                            {contact.profile_picture && (
                                                                <AvatarImage
                                                                    src={getAssetUrl(contact.profile_picture)}
                                                                    alt={contact.username}
                                                                    className="object-cover"
                                                                />
                                                            )}
                                                            <AvatarFallback className="bg-700 text-white font-bold">
                                                                {contact.username.charAt(0).toUpperCase()}
                                                            </AvatarFallback>
                                                        </>
                                                    )}
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold truncate">{contact.username} {contact.id === user?.id && '(You)'}</div>
                                                    <div className="text-xs text-400 truncate">{contact.department || (contact.id === user?.id ? 'Message yourself' : 'Hey there!')}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>

                            {/* Footer */}
                            {selectedForwardTargets.size > 0 && (
                                <div className="p-4 bg-[#1a1a1a] border-t border-white/5 flex justify-end animate-in fade-in slide-in-from-bottom-4">
                                    <Button
                                        onClick={handleSendForward}
                                        className="w-12 h-12 rounded-full bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/20 text-white p-0 flex items-center justify-center transition duration-300 transform hover:scale-110 active:scale-95"
                                    >
                                        <Send size={24} className="ml-1" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            { /* Media Lightbox */}
            {
                selectedMedia && (
                    <div
                        className="fixed inset-0 z-100 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300"
                        onClick={() => setSelectedMedia(null)}
                    >
                        <div className="relative max-w-5xl max-h-full transition-transform duration-300 scale-in shadow-2xl" onClick={e => e.stopPropagation()}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute -top-12 right-0 text-white hover:bg-white/10 rounded-full"
                                onClick={() => setSelectedMedia(null)}
                            >
                                <span className="text-2xl">×</span>
                            </Button>
                            {selectedMedia?.type === 'image' ? (
                                <img src={selectedMedia?.url} loading="lazy" decoding="async" width={1200} height={900} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" alt="Fullscreen preview" />
                            ) : (
                                <video src={selectedMedia?.url} controls autoPlay className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
                            )}
                        </div>
                    </div>
                )
            }

            {/* Call Modal removed - now handled globally in App.tsx */}
            <CallInviteModal
                isOpen={isInviteModalOpen}
                onClose={() => {
                    setIsInviteModalOpen(false);
                    setPendingCallType(null);
                }}
                onConfirm={handleCallConfirmed}
                title="Who should receive this call?"
                showUsers={false} // Only categories for initial call
                showCategories={true}
            />

            {/* Sidebar Selection Action Bar */}
            {isConversationSelectionMode && selectedConversationIds.size > 0 && (
                <div className="absolute bottom-6 left-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300" ref={selectionBarRef}>
                    <div className="bg-900/95 backdrop-blur-xl text-white px-5 py-4 rounded-2xl shadow-2xl flex flex-col gap-3 border border-white/10 ring-1 ring-black/5">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="text-sm font-bold flex items-center gap-2 text-white">
                                <div className="bg-indigo-500 w-2 h-2 rounded-full animate-pulse"></div>
                                {selectedConversationIds.size} Selected
                            </span>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-6 text-[10px] uppercase tracking-wider font-extrabold text-400 hover:text-white hover:bg-white/10 px-2"
                                onClick={() => setSelectedConversationIds(new Set())}
                            >
                                Clear
                            </Button>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleBulkMarkAsRead}
                                    className="h-10 w-10 rounded-xl hover:bg-indigo-500/20 hover:text-indigo-400 text-300 transition border border-white/5"
                                    title="Mark as Read"
                                >
                                    <Check size={18} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleBulkMute}
                                    className="h-10 w-10 rounded-xl hover:bg-yellow-500/20 hover:text-yellow-400 text-300 transition border border-white/5"
                                    title="Mute/Unmute"
                                >
                                    <BellOff size={18} />
                                </Button>
                            </div>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleBulkDeleteConversations}
                                className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 px-4 rounded-xl font-bold flex items-center gap-2 transition shadow-lg shadow-red-500/10"
                            >
                                <Trash2 size={16} />
                                <span>Clear History</span>
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Group Members Dialog */}
            <Dialog open={isGroupMembersOpen} onOpenChange={setIsGroupMembersOpen}>
                <DialogContent className="sm:max-w-[425px] overflow-hidden p-0 rounded-2xl border-none shadow-2xl bg-white/95 backdrop-blur-xl">
                    <DialogHeader className="p-6 bg-linear-to-r from-indigo-600/10 to-purple-600/10 border-b border-indigo-100">
                        <DialogTitle className="text-xl font-bold text-900 flex items-center gap-2">
                            <UsersIcon className="text-indigo-600" size={20} />
                            Group Members
                        </DialogTitle>
                        <DialogDescription className="text-500 font-medium italic">
                            {groupMembers.length} participants in this group
                        </DialogDescription>
                    </DialogHeader>
                    
                    <ScrollArea className="max-h-[60vh] p-4 text-900">
                        <div className="space-y-4">
                            {isLoadingMembers ? (
                                <div className="flex flex-col items-center justify-center py-10 space-y-3">
                                    <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-sm font-medium text-400">Loading members...</p>
                                </div>
                            ) : groupMembers.length === 0 ? (
                                <div className="text-center py-10 text-400 font-medium">
                                    No members found
                                </div>
                            ) : (
                                groupMembers.map((member) => (
                                    <div key={member.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-indigo-50/50 transition duration-200 group border border-transparent hover:border-indigo-100">
                                        <div className="relative">
                                            <Avatar className="h-12 w-12 border-2 border-white shadow-sm ring-2 ring-transparent group-hover:ring-indigo-100 transition">
                                                {member.profile_picture ? (
                                                    <AvatarImage 
                                                        src={getAssetUrl(member.profile_picture)} 
                                                        className="object-cover" 
                                                    />
                                                ) : (
                                                    <AvatarFallback className="bg-linear-to-br from-indigo-500/20 to-purple-600/20 text-indigo-600 font-bold border border-indigo-100">
                                                        {member.username.charAt(0).toUpperCase()}
                                                    </AvatarFallback>
                                                )}
                                            </Avatar>
                                            <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-white rounded-full ${
                                                member.status === "active" ? "bg-green-500" : 
                                                member.status === "break" ? "bg-yellow-500" : "bg-400"
                                            }`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-bold text-800 truncate group-hover:text-indigo-700 transition-colors">
                                                    {member.username} {member.id === user?.id && "(You)"}
                                                </p>
                                                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-100 text-500 border border-200">
                                                    {member.department || 'Member'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="text-xs text-500 truncate italic">{member.department || "General"}</span>
                                                <span className="w-1 h-1 rounded-full bg-300"></span>
                                                <span className={`text-[10px] font-bold ${member.status === "active" ? "text-green-600" : "text-400"}`}>
                                                    {member.status === "active" ? "Available" : member.status === "break" ? "Away" : "Offline"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                    <div className="p-4 bg-50/50 border-t border-indigo-100 flex justify-end">
                        <Button 
                            variant="outline" 
                            onClick={() => setIsGroupMembersOpen(false)}
                            className="rounded-xl border-200 hover:bg-white hover:text-indigo-600 transition font-bold"
                        >
                            Close
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
