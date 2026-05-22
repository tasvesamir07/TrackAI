/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { registerPushSubscription } from '@/lib/pushNotifications';

interface OutgoingCall {
    targetUserId: number;
    targetUsername: string;
    targetProfilePicture?: string | null;
    callType: 'audio' | 'video';
}

interface TeamCallInvitation {
    callerId: number;
    callerName: string;
    callerProfilePicture?: string | null;
    callType: 'audio' | 'video';
    participants: number[];
    isReconnection?: boolean;
}

interface SocketContextType {
    socket: Socket | null;
    outgoingCall: OutgoingCall | null;
    setOutgoingCall: React.Dispatch<React.SetStateAction<OutgoingCall | null>>;
    teamCall: TeamCallInvitation | null;
    setTeamCall: React.Dispatch<React.SetStateAction<TeamCallInvitation | null>>;
    bufferedCandidates: React.MutableRefObject<{ [senderId: number]: RTCIceCandidateInit[] }>;
    consumeBufferedCandidates: (senderId: number) => RTCIceCandidateInit[];
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
    const context = useContext(SocketContext);
    if (!context) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [socket, setSocket] = useState<Socket | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const [outgoingCall, setOutgoingCall] = useState<OutgoingCall | null>(null);
    const [teamCall, setTeamCall] = useState<TeamCallInvitation | null>(null);
    const bufferedCandidates = useRef<{ [senderId: number]: RTCIceCandidateInit[] }>({});

    const consumeBufferedCandidates = (senderId: number) => {
        const candidates = bufferedCandidates.current[senderId] || [];
        delete bufferedCandidates.current[senderId];
        return candidates;
    };

    useEffect(() => {
        if (!user) {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
             
            setSocket(null);
            return;
        }

        const configuredApiUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
        const socketOrigin = configuredApiUrl || (typeof window !== 'undefined' ? window.location.origin : '');
        const newSocket = io(socketOrigin, {
            withCredentials: true,
            path: '/socket.io',
            transports: ['websocket', 'polling'], // Faster connection
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });

        newSocket.on('connect', () => {
            console.log('Socket connected, joining user room:', user.id);
            newSocket.emit('join_user', user.id);
            // Check for active team call on reconnection
            newSocket.emit('check_active_team_call');
        });

        newSocket.on('team_call_started', (data: TeamCallInvitation) => {
            setTeamCall(data);
        });

        newSocket.on('team_call_ended', () => {
            setTeamCall(null);
            // Clear all buffers on team call end
            bufferedCandidates.current = {};
        });

        // Global ICE candidate buffering
        newSocket.on('ice_candidate', (data: { senderId: number, candidate: RTCIceCandidateInit }) => {
            // console.log('[SocketContext] Buffering ICE candidate from:', data.senderId);
            if (!bufferedCandidates.current[data.senderId]) {
                bufferedCandidates.current[data.senderId] = [];
            }
            bufferedCandidates.current[data.senderId].push(data.candidate);
        });

        newSocket.on('call_ended', () => {
            // Clear buffers on call end
            bufferedCandidates.current = {};
        });

        socketRef.current = newSocket;
         
        setSocket(newSocket);

        return () => {
            // Clean up listeners if needed, but usually socket disconnect handles it
            newSocket.off('team_call_started');
            newSocket.off('team_call_ended');
            newSocket.off('ice_candidate');
            newSocket.off('call_ended');
            newSocket.disconnect();
            if (socketRef.current === newSocket) {
                socketRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return;
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;

        let cancelled = false;

        const syncSubscription = async () => {
            try {
                await registerPushSubscription();
            } catch (error) {
                if (!cancelled) {
                    console.warn('[Push] Failed to register push subscription', error);
                }
            }
        };

        if (Notification.permission === 'granted') {
            void syncSubscription();
            return () => {
                cancelled = true;
            };
        }

        if (Notification.permission === 'denied') {
            return () => {
                cancelled = true;
            };
        }

        const requestPermissionAndSubscribe = async () => {
            window.removeEventListener('click', requestPermissionAndSubscribe);
            window.removeEventListener('touchstart', requestPermissionAndSubscribe);

            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    await syncSubscription();
                }
            } catch (error) {
                if (!cancelled) {
                    console.warn('[Push] Notification permission request failed', error);
                }
            }
        };

        window.addEventListener('click', requestPermissionAndSubscribe, { once: true });
        window.addEventListener('touchstart', requestPermissionAndSubscribe, { once: true });

        return () => {
            cancelled = true;
            window.removeEventListener('click', requestPermissionAndSubscribe);
            window.removeEventListener('touchstart', requestPermissionAndSubscribe);
        };
    }, [user?.id]);

    return (
        <SocketContext.Provider value={{
            socket,
            outgoingCall,
            setOutgoingCall,
            teamCall,
            setTeamCall,
            bufferedCandidates,
            consumeBufferedCandidates
        }}>
            {children}
        </SocketContext.Provider>
    );
};
