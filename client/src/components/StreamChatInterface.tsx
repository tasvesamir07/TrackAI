import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { Phone, RefreshCcw, Video } from 'lucide-react';
import { StreamChat, type Channel as StreamChannel } from 'stream-chat';
import {
    Chat,
    Channel,
    ChannelHeader,
    MessageComposer,
    MessageList,
    Thread,
    Window,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/index.css';
import {
    CallControls,
    SpeakerLayout,
    StreamCall,
    StreamTheme,
    StreamVideo,
    StreamVideoClient,
    VideoPreview,
} from '@stream-io/video-react-sdk';
import { useCallStateHooks } from '@stream-io/video-react-bindings';
import '@stream-io/video-react-sdk/dist/css/styles.css';

interface StreamChatInterfaceProps {
    isVisible?: boolean;
    onUnreadTotalChange?: (count: number) => void;
}

interface StreamSessionResponse {
    apiKey: string;
    token: string;
    user: {
        id: string;
        name?: string;
        image?: string;
    };
}

interface Colleague {
    id: number;
    username: string;
    full_name?: string | null;
}

const getDisplayName = (colleague: Colleague) => colleague.full_name || colleague.username;
const streamCallIdFromChannelId = (channelId: string) => `call-${channelId}`.replace(/[^a-zA-Z0-9!_-]/g, '_');
const getUnreadCount = (client: StreamChat) => Number((client.user as Record<string, unknown> | undefined)?.total_unread_count || 0);

function StreamCallOverlay({
    client,
    callId,
    callType,
    onClose,
}: {
    client: StreamVideoClient;
    callId: string;
    callType: 'audio' | 'video';
    onClose: () => void;
}) {
    const call = useMemo(() => client.call('default', callId), [client, callId]);

    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                await call.join({ create: true });
                if (callType === 'video') {
                    await call.camera.enable();
                }
            } catch (error) {
                console.error('Failed to join Stream call:', error);
                if (isMounted) onClose();
            }
        })();

        return () => {
            isMounted = false;
            call.leave().catch(() => undefined);
        };
    }, [call, callType, onClose]);

    return (
        <div className="fixed inset-0 z-200 bg-slate-900/85 backdrop-blur-sm p-4">
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                    <h3 className="text-sm font-semibold text-white">Stream Call</h3>
                    <Button type="button" variant="outline" onClick={onClose} className="border-slate-600 text-slate-200 hover:bg-slate-800 hover:text-white">
                        Close
                    </Button>
                </div>
                <div className="min-h-0 flex-1">
                    <StreamCall call={call}>
                        <StreamTheme>
                            <StreamCallContent onClose={onClose} />
                        </StreamTheme>
                    </StreamCall>
                </div>
            </div>
        </div>
    );
}

function StreamCallContent({ onClose }: { onClose: () => void }) {
    const { useCameraState } = useCallStateHooks();
    const { camera, devices } = useCameraState({ optimisticUpdates: true });
    const canSwitchCamera = devices.length > 1;

    const handleSwitchCamera = useCallback(async () => {
        try {
            await camera.flip();
        } catch (error) {
            console.error('Failed to switch camera:', error);
        }
    }, [camera]);

    return (
        <div className="relative flex h-full flex-col">
            <SpeakerLayout />

            <div className="absolute bottom-24 right-4 h-28 w-44 overflow-hidden rounded-xl border border-slate-500 bg-slate-900/70 shadow-lg">
                <VideoPreview className="h-full w-full object-cover" mirror />
            </div>

            {canSwitchCamera && (
                <button
                    type="button"
                    onClick={handleSwitchCamera}
                    className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-500 bg-slate-900/80 text-white hover:bg-slate-800"
                    title="Switch camera"
                >
                    <RefreshCcw className="h-4 w-4" />
                </button>
            )}

            <CallControls onLeave={onClose} />
        </div>
    );
}

export default function StreamChatInterface({ isVisible = true, onUnreadTotalChange }: StreamChatInterfaceProps) {
    const { user } = useAuth();
    const [session, setSession] = useState<StreamSessionResponse | null>(null);
    const [chatClient, setChatClient] = useState<StreamChat | null>(null);
    const [videoClient, setVideoClient] = useState<StreamVideoClient | null>(null);
    const [activeChannel, setActiveChannel] = useState<StreamChannel | null>(null);
    const [colleagues, setColleagues] = useState<Colleague[]>([]);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [activeCall, setActiveCall] = useState<{ id: string; type: 'audio' | 'video' } | null>(null);
    const [initializing, setInitializing] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');

    const loadSession = useCallback(async () => {
        setInitializing(true);
        setErrorMessage('');
        try {
            const [sessionRes, colleaguesRes] = await Promise.all([
                api.get('/auth/stream/session'),
                api.get('/auth/colleagues'),
            ]);

            const sessionData = sessionRes.data as StreamSessionResponse;
            setSession(sessionData);
            setColleagues(Array.isArray(colleaguesRes.data) ? colleaguesRes.data : []);

            const nextChatClient = StreamChat.getInstance(sessionData.apiKey);
            await nextChatClient.connectUser(sessionData.user, sessionData.token);
            setChatClient(nextChatClient);

            const watchedChannels = await nextChatClient.queryChannels(
                { type: 'messaging', members: { $in: [sessionData.user.id] } },
                { last_message_at: -1 },
                { watch: true, state: true, presence: true, limit: 25 }
            );
            if (watchedChannels.length > 0) {
                setActiveChannel(watchedChannels[0]);
            }

            const nextVideoClient = new StreamVideoClient({
                apiKey: sessionData.apiKey,
                token: sessionData.token,
                user: sessionData.user,
            });
            setVideoClient(nextVideoClient);

            const unread = getUnreadCount(nextChatClient);
            onUnreadTotalChange?.(unread);

            const subscription = nextChatClient.on(() => {
                const count = getUnreadCount(nextChatClient);
                onUnreadTotalChange?.(count);
            });

            return () => {
                subscription.unsubscribe?.();
            };
        } catch (error: unknown) {
            console.error('Failed to initialize Stream clients:', error);
            setErrorMessage((error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to initialize Stream messaging.');
            setSession(null);
            setChatClient(null);
            setVideoClient(null);
            onUnreadTotalChange?.(0);
        } finally {
            setInitializing(false);
        }
        return () => undefined;
    }, [onUnreadTotalChange]);

    useEffect(() => {
        if (!isVisible) return;

        let disposeEvents: (() => void) | undefined;
        loadSession().then((cleanup) => {
            disposeEvents = cleanup;
        });

        return () => {
            disposeEvents?.();
        };
    }, [isVisible, loadSession]);

    useEffect(() => {
        return () => {
            if (chatClient) {
                chatClient.disconnectUser().catch(() => undefined);
            }
            if (videoClient) {
                videoClient.disconnectUser().catch(() => undefined);
            }
        };
    }, [chatClient, videoClient]);

    const filteredColleagues = useMemo(() => {
        const needle = debouncedSearch.trim().toLowerCase();
        return colleagues
            .filter((colleague) => Number(colleague.id) !== Number(user?.id))
            .filter((colleague) => {
                if (!needle) return true;
                return getDisplayName(colleague).toLowerCase().includes(needle) || String(colleague.username || '').toLowerCase().includes(needle);
            });
    }, [colleagues, debouncedSearch, user?.id]);

    const openDirectChannel = useCallback(async (targetAppUserId: number) => {
        if (!chatClient) return;
        try {
            const res = await api.post('/auth/stream/direct-channel', { targetUserId: targetAppUserId });
            const channelId = String(res.data?.channelId || '').trim();
            if (!channelId) return;

            const channel = chatClient.channel('messaging', channelId);
            await channel.watch();
            setActiveChannel(channel);
        } catch (error) {
            console.error('Failed to open direct channel:', error);
        }
    }, [chatClient]);

    const startCall = useCallback((type: 'audio' | 'video') => {
        if (!activeChannel) return;
        const channelId = String(activeChannel.id || '').trim();
        if (!channelId) return;
        const callId = `${type}-${streamCallIdFromChannelId(channelId)}`;
        setActiveCall({ id: callId, type });
    }, [activeChannel]);

    if (!isVisible) return null;
    if (initializing) {
        return <div className="h-full flex items-center justify-center text-slate-500 text-sm">Initializing Stream messaging...</div>;
    }
    if (errorMessage) {
        return <div className="h-full flex items-center justify-center text-red-600 text-sm">{errorMessage}</div>;
    }
    if (!session || !chatClient || !videoClient) {
        return <div className="h-full flex items-center justify-center text-slate-500 text-sm">Stream is not available.</div>;
    }

    return (
        <StreamVideo client={videoClient}>
            <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <aside className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search users..."
                        className="mb-3 h-10"
                    />
                    <div className="max-h-full overflow-y-auto space-y-1 pr-1">
                        {filteredColleagues.map((colleague) => (
                            <button
                                key={colleague.id}
                                type="button"
                                onClick={() => openDirectChannel(colleague.id)}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-white hover:shadow-sm"
                            >
                                <div className="font-semibold text-slate-900">{getDisplayName(colleague)}</div>
                                <div className="text-xs text-slate-500">@{colleague.username}</div>
                            </button>
                        ))}
                    </div>
                </aside>

                <div className="min-w-0 flex-1 min-h-0">
                    <Chat client={chatClient} theme="str-chat__theme-light">
                        {activeChannel ? (
                            <Channel channel={activeChannel}>
                                <Window>
                                    <div className="flex h-full min-h-0 flex-col">
                                        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-2">
                                            <ChannelHeader />
                                            <div className="flex items-center gap-2">
                                                <Button type="button" variant="outline" size="sm" onClick={() => startCall('audio')}>
                                                    <Phone className="h-4 w-4" />
                                                </Button>
                                                <Button type="button" variant="outline" size="sm" onClick={() => startCall('video')}>
                                                    <Video className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="min-h-0 flex-1">
                                            <MessageList />
                                        </div>
                                        <div className="shrink-0 border-t border-slate-200 bg-white">
                                            <MessageComposer />
                                        </div>
                                    </div>
                                </Window>
                                <Thread />
                            </Channel>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Select a user to start chatting.</div>
                        )}
                    </Chat>
                </div>
            </div>

            {activeCall && (
                <StreamCallOverlay
                    client={videoClient}
                    callId={activeCall.id}
                    callType={activeCall.type}
                    onClose={() => setActiveCall(null)}
                />
            )}
        </StreamVideo>
    );
}
