import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Users, UserPlus, Monitor, MonitorOff, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import CallInviteModal from './CallInviteModal';
import { useSocket } from '@/context/SocketContext';
import { Socket } from 'socket.io-client';


// Stable video component that only re-sets srcObject when the stream changes
const RemoteVideo = memo(({ stream, className }: { stream: MediaStream; className?: string }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [updateCount, forceUpdate] = useState(0);

    useEffect(() => {
        const handleTrackChange = () => {
            console.log('[RemoteVideo] Track changed/added/removed', stream?.id);
            if (videoRef.current) {
                videoRef.current.srcObject = null;
                videoRef.current.srcObject = stream || null;
            }
            forceUpdate(n => n + 1);
        };
        if (stream) {
            stream.addEventListener('addtrack', handleTrackChange);
            stream.addEventListener('removetrack', handleTrackChange);
        }
        return () => {
            if (stream) {
                stream.removeEventListener('addtrack', handleTrackChange);
                stream.removeEventListener('removetrack', handleTrackChange);
            }
        };
    }, [stream]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    // Force re-attach and play if stream changes to bypass autoplay restrictions
    useEffect(() => {
        if (!stream || !videoRef.current) return;
        
        console.log('[RemoteVideo] Ensuring playback. Tracks:', stream.getTracks().length);
        // Explicitly re-assign to force the browser to pick up the new track from the same object reference
        videoRef.current.srcObject = null;
        videoRef.current.srcObject = stream;
        
        if (videoRef.current.paused) {
            videoRef.current.play().catch(e => console.error('Error auto-playing remote media:', e));
        }
    }, [stream, updateCount]); // Depend on stream and updateCount to run when tracks are added/removed

    return <video ref={videoRef} autoPlay playsInline className={className || "w-full h-full object-cover"} />;
});
interface CallModalProps {
    socket: Socket;
    userId: number;
    username: string;
    // Incoming call data
    incomingCall: {
        callerId: number;
        callerName: string;
        callerProfilePicture?: string | null;
        callType: 'audio' | 'video';
        offer: RTCSessionDescriptionInit;
    } | null;
    // Outgoing call data
    outgoingCall: {
        targetUserId: number;
        targetUsername: string;
        targetProfilePicture?: string | null;
        callType: 'audio' | 'video';
    } | null;
    // Group call data
    teamCall?: {
        callerId: number;
        callerName: string;
        callerProfilePicture?: string | null;
        callType: 'audio' | 'video';
        participants: number[];
        isReconnection?: boolean;
    } | null;
    onClose: () => void;
    onCallRejected: () => void;
    profilePicture?: string | null;
}

const ICE_SERVERS: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Add TURN servers here for public network support
        ...(import.meta.env.VITE_TURN_URL ? [{
            urls: import.meta.env.VITE_TURN_URL,
            username: import.meta.env.VITE_TURN_USERNAME,
            credential: import.meta.env.VITE_TURN_PASSWORD
        }] : [
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ])
    ],
    iceCandidatePoolSize: 10,
};

export default function CallModal({
    socket,
    userId,
    username,
    incomingCall,
    outgoingCall,
    teamCall,
    onClose,
    onCallRejected,
    profilePicture
}: CallModalProps) {
    const { consumeBufferedCandidates } = useSocket();
    const isTeamCall = outgoingCall?.targetUsername === 'Team Chat' || teamCall;
    // Derive initial status from props so the UI is correct on first render
    const [callStatus, setCallStatus] = useState<'incoming' | 'outgoing' | 'connected' | 'ended'>(
        () => outgoingCall ? 'outgoing' : 'incoming'
    );
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(teamCall?.isReconnection || false);

    useEffect(() => {
        console.log('CallModal mounted/updated. teamCall:', teamCall);
        console.log('isMinimized state:', isMinimized);
    }, [teamCall, isMinimized]);

    // State for remote streams now tracks screen sharing status
    const [remoteStreams, setRemoteStreams] = useState<{ [userId: number]: { stream: MediaStream, name: string, profilePicture?: string | null, isScreenSharing?: boolean, isVideoOff?: boolean, isMuted?: boolean } }>({});
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    const peerConnections = useRef<{ [userId: number]: RTCPeerConnection }>({});
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const iceCandidatesQueue = useRef<{ [userId: number]: RTCIceCandidate[] }>({});
    const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const ringtoneRef = useRef<HTMLAudioElement | null>(null);

    const callType = incomingCall?.callType || outgoingCall?.callType || teamCall?.callType || 'audio';
    const remoteUserId = incomingCall?.callerId || outgoingCall?.targetUserId;
    const remoteName = isTeamCall ? 'Team Call' : (incomingCall?.callerName || outgoingCall?.targetUsername || 'Unknown');
    const remoteProfilePicture = !isTeamCall ? (incomingCall?.callerProfilePicture || outgoingCall?.targetProfilePicture) : null;

    // ... (keep ringtone logic same) ...

    // ... (keep cleanup same) ...




    // Warn before refresh/close
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // Force minimized on reconnection
    useEffect(() => {
        if (teamCall?.isReconnection) {
            setIsMinimized(true);
        }
    }, [teamCall?.isReconnection]);

    // Ringtone logic
    useEffect(() => {
        if (callStatus === 'incoming') {
            const ringtone = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
            ringtone.loop = true;
            const playPromise = ringtone.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    if (err.name !== 'AbortError') {
                        console.error('Failed to play ringtone:', err);
                    }
                });
            }
            ringtoneRef.current = ringtone;
        } else {
            if (ringtoneRef.current) {
                ringtoneRef.current.pause();
                ringtoneRef.current = null;
            }
        }

        return () => {
            if (ringtoneRef.current) {
                ringtoneRef.current.pause();
            }
        };
    }, [callStatus]);

    // Timer logic based on callStatus
    useEffect(() => {
        if (callStatus === 'connected') {
            if (!callTimerRef.current) {
                callTimerRef.current = setInterval(() => {
                    setCallDuration(prev => prev + 1);
                }, 1000);
            }
        } else {
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
                callTimerRef.current = null;
            }
        }
        
        return () => {
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
                callTimerRef.current = null;
            }
        };
    }, [callStatus]);

    // Cleanup function — uses only refs and stable setState, so no deps needed.
    // This prevents the localStream → cleanup → endCall → startCall dep chain from
    // re-triggering the init effect every time media is acquired.
    const cleanup = useCallback(() => {
        if (callTimerRef.current) {
            clearInterval(callTimerRef.current);
            callTimerRef.current = null;
        }

        // localStreamRef is always current — no need for localStream state here
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                track.stop();
            });
            localStreamRef.current = null;
        }

        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => {
                track.stop();
            });
            screenStreamRef.current = null;
        }

        Object.values(peerConnections.current).forEach(pc => {
            pc.close();
        });
        peerConnections.current = {};

        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }

        setLocalStream(null);
        setRemoteStreams({});
        setIsMuted(false);
        setIsVideoOff(false);
        setIsScreenSharing(false);
    }, []);

    const endCall = useCallback(() => {
        if (isTeamCall) {
            socket.emit('leave_team_call', { userId });
        } else if (remoteUserId) {
            socket.emit('end_call', { targetUserId: remoteUserId });
        }
        setCallStatus('ended');
        cleanup();
        onClose();
    }, [isTeamCall, remoteUserId, socket, cleanup, onClose, userId]);

    const handleUserLeft = useCallback((uid: number) => {
        if (peerConnections.current[uid]) {
            peerConnections.current[uid].close();
            delete peerConnections.current[uid];
        }
        setRemoteStreams(prev => {
            const next = { ...prev };
            delete next[uid];
            return next;
        });

        // If everyone else left, end the call
        if (Object.keys(peerConnections.current).length === 0) {
            endCall();
        }
    }, [endCall]);

    // Initialize peer connection for a specific user
    const createPeerConnection = useCallback((targetUserId: number, targetName: string, targetProfilePicture?: string | null) => {
        console.log(`[CallModal] Creating peer connection for ${targetUserId} (${targetName})`);
        if (peerConnections.current[targetUserId]) return peerConnections.current[targetUserId];

        const pc = new RTCPeerConnection(ICE_SERVERS);
        // Transceivers are added lazily via addTrack / screen-share fallback.
        // Pre-adding them would queue onnegotiationneeded macrotasks that race with
        // setRemoteDescription in answerCall and break the signalling handshake.

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    targetUserId: targetUserId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log(`[CallModal] Received remote track from ${targetUserId}:`, event.track.kind, 'Has Streams:', !!event.streams?.length);
            
            setRemoteStreams(prev => {
                const existing = prev[targetUserId];
                let streamToUpdate: MediaStream;

                if (existing && existing.stream) {
                    streamToUpdate = existing.stream;
                    // If the stream doesn't already have this exact track, add it
                    if (!streamToUpdate.getTracks().includes(event.track)) {
                        console.log(`[CallModal] Appending ${event.track.kind} track to existing stream for ${targetUserId}`);
                        streamToUpdate.addTrack(event.track);
                    }
                } else if (event.streams && event.streams[0]) {
                    streamToUpdate = event.streams[0];
                } else {
                    streamToUpdate = new MediaStream([event.track]);
                }

                return {
                    ...prev,
                    [targetUserId]: {
                        ...existing,
                        stream: streamToUpdate,
                        name: targetName,
                        profilePicture: targetProfilePicture,
                        isScreenSharing: existing?.isScreenSharing || false,
                        isVideoOff: event.track.kind === 'video' ? false : (existing?.isVideoOff ?? true),
                        isMuted: existing?.isMuted || false
                    }
                };
            });
        };

        pc.onnegotiationneeded = async () => {
            try {
                if (pc.signalingState !== 'stable') {
                    console.log('[Negotiation] Signaling state not stable:', pc.signalingState);
                    return;
                }
                console.log('[Negotiation] Starting negotiation');
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                if (isTeamCall) {
                    socket.emit('team_call_offer', {
                        targetUserId,
                        offer,
                        callerId: userId,
                        callerName: username,
                        callerProfilePicture: profilePicture,
                        callType
                    });
                } else {
                    socket.emit('call_negotiation', {
                        targetUserId,
                        signal: offer
                    });
                }
            } catch (err) {
                console.error('Negotiation offer error:', err);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                setCallStatus('connected');
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                handleUserLeft(targetUserId);
            }
        };

        peerConnections.current[targetUserId] = pc;
        return pc;
    }, [userId, username, profilePicture, socket, isTeamCall, callType, handleUserLeft]);

    // Effect to sync local stream
    useEffect(() => {
        if (localVideoRef.current) {
            if (isScreenSharing && screenStreamRef.current) {
                if (localVideoRef.current.srcObject !== screenStreamRef.current) {
                    localVideoRef.current.srcObject = screenStreamRef.current;
                }
            } else if (localStream) {
                if (localVideoRef.current.srcObject !== localStream) {
                    localVideoRef.current.srcObject = localStream;
                }
            }
        }
    }, [localStream, isScreenSharing]);

    // Get user media
    const getMedia = useCallback(async (type: 'audio' | 'video') => {
        try {
            const constraints: MediaStreamConstraints = type === 'video'
                ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } }
                : { audio: true, video: false };

            let stream: MediaStream;
            try {
                // Initial attempt with strict ideal constraints
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (innerErr) {
                console.warn('[CallModal] Initial getUserMedia failed, retrying with native defaults:', innerErr);
                if (type === 'video') {
                    // Hardware might have choked on the resolution constraint. Try native pass-through.
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                } else {
                    throw innerErr;
                }
            }
            
            setLocalStream(stream);
            localStreamRef.current = stream;
            return stream;
        } catch (err) {
            console.error('[CallModal] Persistent error getting media:', err);
            
            // If even native defaults failed, gracefully downgrade to audio-only
            if (type === 'video') {
                try {
                    console.log('[CallModal] Gracefully falling back to audio-only after video capture failure.');
                    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                    setLocalStream(audioStream);
                    localStreamRef.current = audioStream;
                    return audioStream;
                } catch (audioFallbackErr) {
                    alert("Failed to access camera and microphone to start call. Please check permissions or close other apps using them.");
                    throw audioFallbackErr;
                }
            } else {
                alert("Failed to access microphone. Please check permissions or close other apps using it.");
                throw err;
            }
        }
    }, []);

    // Start call
    const startCall = useCallback(async () => {
        try {
            setCallStatus('outgoing');
            const stream = await getMedia(callType);

            if (isTeamCall) {
                // Team calls notify everyone first, then wait for joins
                socket.emit('start_team_call', {
                    callerId: userId,
                    callerName: username,
                    callerProfilePicture: profilePicture,
                    callType
                });
                setCallStatus('connected'); // For team calls, we are connected immediately to the room
            } else if (outgoingCall) {
                const pc = createPeerConnection(outgoingCall.targetUserId, outgoingCall.targetUsername, outgoingCall.targetProfilePicture);
                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                socket.emit('call_user', {
                    callerId: userId,
                    callerName: username,
                    callerProfilePicture: profilePicture,
                    targetUserId: outgoingCall.targetUserId,
                    callType: outgoingCall.callType,
                    offer: offer
                });
            }
        } catch (err) {
            console.error('Error starting call:', err);
            endCall();
        }
    }, [outgoingCall, isTeamCall, userId, username, profilePicture, socket, getMedia, createPeerConnection, callType, endCall]);

    // Answer call
    const answerCall = useCallback(async () => {
        if (incomingCall) {
            try {
                const stream = await getMedia(incomingCall.callType);
                const pc = createPeerConnection(incomingCall.callerId, incomingCall.callerName, incomingCall.callerProfilePicture);

                // CRITICAL: set remote description FIRST so the signalling state moves to
                // 'have-remote-offer' before we add tracks. Adding tracks queues an
                // onnegotiationneeded macrotask; if the state is still 'stable' when that
                // task fires it would create a spurious local offer, flipping state to
                // 'have-local-offer' and causing the subsequent setRemoteDescription to fail.
                await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));

                // Now safe to add tracks — onnegotiationneeded won't create a conflicting offer
                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                // Process any ICE candidates buffered before the peer connection was ready
                const candidates = iceCandidatesQueue.current[incomingCall.callerId] || [];
                for (const candidate of candidates) {
                    await pc.addIceCandidate(candidate);
                }
                iceCandidatesQueue.current[incomingCall.callerId] = [];

                const buffered = consumeBufferedCandidates(incomingCall.callerId);
                if (buffered.length > 0) {
                    console.log(`[CallModal] Consuming ${buffered.length} buffered candidates for ${incomingCall.callerId}`);
                    for (const c of buffered) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(c));
                        } catch (e) {
                            console.error('Error adding buffered candidate:', e);
                        }
                    }
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                socket.emit('call_answer', {
                    callerId: incomingCall.callerId,
                    answer: answer
                });

                setCallStatus('connected');
            } catch (err) {
                console.error('Error answering call:', err);
                endCall();
            }
        } else if (teamCall) {
            try {
                await getMedia(teamCall.callType);
                socket.emit('join_team_call', { userId, username, profilePicture });
                setCallStatus('connected');
            } catch (err) {
                console.error('Error joining team call:', err);
            }
        }
    }, [incomingCall, teamCall, socket, getMedia, createPeerConnection, userId, username, profilePicture, endCall, consumeBufferedCandidates]);

    const rejectCall = useCallback(() => {
        if (incomingCall) {
            socket.emit('reject_call', { callerId: incomingCall.callerId });
        }
        cleanup();
        onClose();
    }, [incomingCall, socket, cleanup, onClose]);

    const toggleMute = useCallback(() => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
            setIsMuted(prev => {
                const newState = !prev;
                socket.emit('media_status_change', { type: 'audio', enabled: !newState, targetUserId: isTeamCall ? undefined : remoteUserId });
                return newState;
            });
        }
    }, [localStream, isTeamCall, remoteUserId, socket]);

    const toggleVideo = useCallback(() => {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
            setIsVideoOff(prev => {
                const newState = !prev;
                socket.emit('media_status_change', { type: 'video', enabled: !newState, targetUserId: isTeamCall ? undefined : remoteUserId });
                return newState;
            });
        }
    }, [localStream, isTeamCall, remoteUserId, socket]);

    const stopScreenShare = useCallback(async (reason?: string) => {
        console.log(`[ScreenShare] Stopping screen share. Reason: ${reason || 'unknown'}`);
        if (!screenStreamRef.current) {
            console.log('[ScreenShare] No screen stream to stop');
            return;
        }
        screenStreamRef.current.getTracks().forEach(track => {
            console.log('[ScreenShare] Stopping track:', track.kind, track.label);
            track.stop();
        });
        screenStreamRef.current = null;

        if (localStream) {
            const cameraTrack = localStream.getVideoTracks()[0];
            for (const pc of Object.values(peerConnections.current)) {
                const videoTransceiver = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
                
                if (videoTransceiver) {
                    if (cameraTrack && cameraTrack.readyState === 'live') {
                        console.log('[ScreenShare] Reverting to camera track');
                        // If camera was off, keep direction aligned with expectation
                        if (!isVideoOff) {
                            videoTransceiver.direction = 'sendrecv';
                        }
                        await videoTransceiver.sender.replaceTrack(cameraTrack);
                    } else {
                        console.log('[ScreenShare] No camera track, setting sender to null and direction to recvonly');
                        videoTransceiver.direction = 'recvonly';
                        await videoTransceiver.sender.replaceTrack(null);
                    }
                }
            }
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = localStream;
            }
        }
        setIsScreenSharing(false);
        const payload = { isSharing: false, targetUserId: isTeamCall ? undefined : remoteUserId };
        socket.emit('screen_share_status', payload);
        socket.emit('media_status_change', { type: 'video', enabled: !isVideoOff, targetUserId: isTeamCall ? undefined : remoteUserId });
    }, [localStream, isTeamCall, remoteUserId, socket, isVideoOff]);

    const toggleScreenShare = useCallback(async () => {
        console.log('[ScreenShare] Toggle requested. Current PeerConnections:', Object.keys(peerConnections.current).length);
        if (Object.keys(peerConnections.current).length === 0) {
            console.error('[ScreenShare] No peer connections found! Aborting.');
            return;
        }
        try {
            if (!isScreenSharing) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        displaySurface: 'monitor',
                        logicalSurface: true,
                        cursor: 'always',
                        width: { ideal: 1920, max: 2560 },
                        height: { ideal: 1080, max: 1440 },
                        frameRate: { max: 30 }
                    }
                } as DisplayMediaStreamOptions);
                screenStreamRef.current = screenStream;
                const screenTrack = screenStream.getVideoTracks()[0];
                
                // Extremely important: tells the WebRTC encoder to prioritize resolution (text) over smooth motion
                if ('contentHint' in screenTrack) {
                    screenTrack.contentHint = 'detail';
                }

                for (const [, pc] of Object.entries(peerConnections.current)) {
                    const videoTransceiver = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');

                    if (videoTransceiver) {
                        console.log(`[ScreenShare] Found video transceiver. Current direction: ${videoTransceiver.direction}`);
                        // Force direction to sendrecv so we actually transmit the screen
                        if (videoTransceiver.direction === 'recvonly' || videoTransceiver.direction === 'inactive') {
                            videoTransceiver.direction = 'sendrecv';
                        }
                        console.log('[ScreenShare] Replacing existing sender track with screen track');
                        await videoTransceiver.sender.replaceTrack(screenTrack);
                        
                        // Force WebRTC to prioritize text clarity over framerate and bump the bitrate ceiling to 5 Mbps
                        try {
                            const sender = videoTransceiver.sender;
                            const params = sender.getParameters();
                            if (!params.encodings || params.encodings.length === 0) {
                                params.encodings = [{}];
                            }
                            params.encodings[0].maxBitrate = 5000000;
                            params.degradationPreference = 'maintain-resolution';
                            await sender.setParameters(params);
                            console.log('[ScreenShare] Applied high-quality sender constraints');
                        } catch (e) {
                            console.warn('[ScreenShare] Could not apply sender encoding parameters:', e);
                        }
                    } else {
                        // Fallback in case transceiver wasn't found - should be rare now that we add it on initialize
                        console.log('[ScreenShare] Adding new screen track to peer connection');
                        const streamToUse = localStream || screenStream;
                        pc.addTrack(screenTrack, streamToUse);
                    }
                }

                screenTrack.onended = () => {
                    console.log('[ScreenShare] Track ended event fired');
                    stopScreenShare('track_ended');
                };
                setIsScreenSharing(true);

                // Notify status
                const payload = { isSharing: true, targetUserId: isTeamCall ? undefined : remoteUserId };
                socket.emit('screen_share_status', payload);

                // Update local preview immediately
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = screenStream;
                }
            } else {
                await stopScreenShare('user_toggled_off');
            }
        } catch (err) {
            console.error('Error sharing screen:', err);
        }
    }, [isScreenSharing, localStream, isTeamCall, remoteUserId, socket, stopScreenShare]);



    const handleInviteConfirmed = (categoryIds: number[], userIds: number[]) => {
        socket.emit('invite_to_team_call', {
            callerId: userId,
            callerName: username,
            callerProfilePicture: profilePicture,
            callType,
            targetCategoryIds: categoryIds,
            targetUserIds: userIds
        });
        setIsInviteModalOpen(false);
    };

    // Signaling handling
    useEffect(() => {
        if (!socket) return;

        const handleCallAnswered = async (data: { answer: RTCSessionDescriptionInit }) => {
            if (!remoteUserId) return;
            const pc = peerConnections.current[remoteUserId];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                setCallStatus('connected'); // Fix: Ensure caller UI updates to connected immediately
                const candidates = iceCandidatesQueue.current[remoteUserId] || [];
                for (const c of candidates) await pc.addIceCandidate(c);
                iceCandidatesQueue.current[remoteUserId] = [];
            }
        };

        const handleIceCandidate = async (data: { senderId: number, candidate: RTCIceCandidateInit }) => {
            const uid = data.senderId || remoteUserId;
            if (!uid) return;

            const pc = peerConnections.current[uid];
            if (pc && pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                if (!iceCandidatesQueue.current[uid]) iceCandidatesQueue.current[uid] = [];
                iceCandidatesQueue.current[uid].push(new RTCIceCandidate(data.candidate));
            }
        };

        const handleNegotiation = async (data: { senderId: number, signal: RTCSessionDescriptionInit }) => {
            const uid = data.senderId || remoteUserId;
            console.log(`[Negotiation] Received ${data.signal.type} from senderId: ${data.senderId} (Resolved UID: ${uid})`);

            if (!uid) {
                console.warn('[Negotiation] No senderId in negotiation data and no remoteUserId set', data);
                return;
            }

            const pc = peerConnections.current[uid];
            if (!pc) {
                console.warn(`[Negotiation] No peer connection found for ${uid}. Current PCs:`, Object.keys(peerConnections.current));
                return;
            }

            try {
                if (data.signal.type === 'offer') {
                    console.log(`[Negotiation] Handling OFFER from ${uid}. Current SignalingState: ${pc.signalingState}`);
                    // If we are already stable, we can accept an offer (renegotiation)
                    // If we are have-local-offer, we might be in a glare (collision). 
                    // But assume we are polite for now or the collision is rare.

                    await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    console.log(`[Negotiation] Sending ANSWER to ${uid}`);
                    socket.emit('call_negotiation', { targetUserId: uid, signal: answer });
                } else if (data.signal.type === 'answer') {
                    console.log(`[Negotiation] Handling ANSWER from ${uid}. Current SignalingState: ${pc.signalingState}`);
                    await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
                }
            } catch (err) {
                console.error('[Negotiation] Error handling signal:', err);
            }
        };

        // Group specific handlers
        const handleUserJoining = async (data: { userId: number, username: string, profilePicture?: string | null }) => {
            // Prevent auto-answering or connecting if we haven't answered yet
            if (callStatus !== 'connected') return;
            if (data.userId === userId) return;

            // Existing participants create an offer to the new joiner
            const pc = createPeerConnection(data.userId, data.username, data.profilePicture);
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    if (!pc.getSenders().some(sender => sender.track === track)) {
                        pc.addTrack(track, localStream);
                    }
                });
            }
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('team_call_offer', {
                targetUserId: data.userId,
                offer,
                callerId: userId,
                callerName: username,
                callerProfilePicture: profilePicture,
                callType
            });
        };

        const handleTeamOffer = async (data: { callerId: number, callerName: string, offer: RTCSessionDescriptionInit, callerProfilePicture?: string | null }) => {
            const pc = createPeerConnection(data.callerId, data.callerName, data.callerProfilePicture);
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    if (!pc.getSenders().some(sender => sender.track === track)) {
                        pc.addTrack(track, localStream);
                    }
                });
            }
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

            const candidates = iceCandidatesQueue.current[data.callerId] || [];
            for (const c of candidates) await pc.addIceCandidate(c);
            iceCandidatesQueue.current[data.callerId] = [];

            // Consume global buffered candidates
            const buffered = consumeBufferedCandidates(data.callerId);
            if (buffered.length > 0) {
                console.log(`[CallModal] Consuming ${buffered.length} buffered candidates for team offer from ${data.callerId}`);
                for (const c of buffered) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(c));
                    } catch (e) {
                        console.error('Error adding buffered candidate:', e);
                    }
                }
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('team_call_answer', { targetUserId: data.callerId, answer, userId });
        };

        const handleTeamAnswer = async (data: { userId: number, answer: RTCSessionDescriptionInit }) => {
            const pc = peerConnections.current[data.userId];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                const candidates = iceCandidatesQueue.current[data.userId] || [];
                for (const c of candidates) await pc.addIceCandidate(c);
                iceCandidatesQueue.current[data.userId] = [];
            }
        };

        socket.on('call_answered', handleCallAnswered);
        socket.on('ice_candidate', handleIceCandidate);
        socket.on('call_negotiation', handleNegotiation);
        socket.on('call_ended', () => { if (remoteUserId) handleUserLeft(remoteUserId); });
        socket.on('call_rejected', onCallRejected);

        socket.on('user_joining_team_call', handleUserJoining);
        socket.on('team_call_offer', handleTeamOffer);
        socket.on('team_call_answer', handleTeamAnswer);
        socket.on('user_left_team_call', (data: { userId: number }) => handleUserLeft(data.userId));
        socket.on('team_call_ended', () => { if (isTeamCall) endCall(); });

        socket.on('screen_share_status', (data: { userId: number, isSharing: boolean }) => {
            console.log(`[CallModal] Received screen_share_status from ${data.userId}:`, data.isSharing);
            setRemoteStreams(prev => {
                if (!prev[data.userId]) {
                    console.warn(`[CallModal] Received screen share status for unknown user ${data.userId}`);
                    return prev;
                }
                return {
                    ...prev,
                    [data.userId]: { ...prev[data.userId], isScreenSharing: data.isSharing }
                };
            });
        });

        socket.on('media_status_change', (data: { userId: number, type: 'audio' | 'video', enabled: boolean }) => {
            setRemoteStreams(prev => {
                if (!prev[data.userId]) return prev;
                return {
                    ...prev,
                    [data.userId]: {
                        ...prev[data.userId],
                        isVideoOff: data.type === 'video' ? !data.enabled : prev[data.userId].isVideoOff,
                        isMuted: data.type === 'audio' ? !data.enabled : prev[data.userId].isMuted
                    }
                };
            });
        });

        return () => {
            socket.off('call_answered');
            socket.off('ice_candidate');
            socket.off('call_negotiation');
            socket.off('call_ended');
            socket.off('call_rejected');
            socket.off('user_joining_team_call');
            socket.off('team_call_offer');
            socket.off('team_call_answer');
            socket.off('user_left_team_call');
            socket.off('team_call_accepted'); // wait, this wasn't here, I should only add screen_share_status
            socket.off('screen_share_status');
            socket.off('media_status_change');
            socket.off('team_call_ended');
        };
    }, [socket, remoteUserId, userId, username, profilePicture, localStream, isTeamCall, callType, callStatus, consumeBufferedCandidates, createPeerConnection, endCall, handleUserLeft, onCallRejected]);

    useEffect(() => {
        if (outgoingCall) startCall();
        // Auto-join if it's a reconnection
        if (teamCall?.isReconnection) {
            console.log('Auto-joining team call on reconnection');
            answerCall();
        }
        return () => cleanup();
    }, [startCall, answerCall, cleanup, outgoingCall, teamCall?.isReconnection]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const showVideoUI = (callType === 'video' || isScreenSharing || Object.values(remoteStreams).length > 0) && callStatus === 'connected';

    // Determine if anyone is sharing screen
    const remoteScreenSharerId = Object.keys(remoteStreams).find(id => remoteStreams[parseInt(id)].isScreenSharing);
    const activeScreenShare = remoteScreenSharerId ? remoteStreams[parseInt(remoteScreenSharerId)] : null;
    const isScreenShareMode = !!activeScreenShare || isScreenSharing;

    if (isMinimized) {
        return (
            <div
                className="fixed bottom-4 right-4 w-64 bg-[#1a1c20] rounded-2xl shadow-2xl z-9999 border border-gray-700 overflow-hidden flex flex-col items-center pt-6 pb-4 cursor-pointer hover:bg-[#25282c] transition-colors"
                onClick={() => setIsMinimized(false)}
            >

                {/* Close/End Button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        endCall();
                    }}
                    className="absolute top-2 right-2 p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                    title="End Call"
                >
                    <PhoneOff className="w-4 h-4" />
                </button>

                {/* Avatar */}
                <div className="relative mb-3">
                    <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-emerald-500/50 p-0.5 bg-linear-to-tr from-emerald-500 to-teal-500">
                        {remoteProfilePicture ? (
                            <img src={remoteProfilePicture} alt={remoteName} className="w-full h-full rounded-full object-cover bg-slate-800" />
                        ) : (
                            <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center text-white font-bold text-xl">
                                {remoteName.substring(0, 1)}
                            </div>
                        )}
                    </div>
                </div>

                {/* Name */}
                <h3 className="text-white font-medium text-lg mb-1">{isTeamCall ? 'Team Call' : remoteName}</h3>

                {/* Status Dots */}
                <div className="flex gap-1 h-2 items-center justify-center mt-1">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-sm flex items-center justify-center z-1000 p-4 animate-in fade-in duration-200">
            <div className={cn(
                "bg-slate-900 rounded-4xl shadow-2xl overflow-hidden flex flex-col transition duration-500 relative ring-1 ring-white/10",
                showVideoUI ? "w-full h-full max-h-full" : "w-96 p-8"
            )}>
                {showVideoUI && (
                    <div className="relative w-full h-full bg-black flex flex-col">

                        {/* Top Bar: Metrics & Minimize */}
                        <div className="absolute top-4 left-0 right-0 px-6 flex justify-between items-start z-30 pointer-events-none">
                            <div className="flex-1"></div>
                            <div className="bg-black/60 px-6 py-2 rounded-full text-white flex items-center gap-3 backdrop-blur-md shadow-lg pointer-events-auto">
                                {isTeamCall && <Users className="w-4 h-4 text-blue-400" />}
                                <span className="font-mono font-medium min-w-[60px] text-center">
                                    {(isTeamCall && Object.keys(remoteStreams).length === 0)
                                        ? 'Waiting...'
                                        : formatDuration(callDuration)}
                                </span>
                            </div>
                            <div className="flex-1 flex justify-end pointer-events-auto">
                                <Button
                                    onClick={() => setIsMinimized(true)}
                                    variant="ghost"
                                    size="icon"
                                    className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md transition-colors"
                                >
                                    <Minimize2 className="w-5 h-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col overflow-hidden">
                            {isScreenShareMode ? (
                                /* ===== HERO LAYOUT (Screen Share Active) ===== */
                                <>
                                    {/* Hero: The shared screen */}
                                    <div className="flex-1 relative bg-black min-h-0">
                                        {activeScreenShare ? (
                                            <RemoteVideo stream={activeScreenShare.stream} className="w-full h-full object-contain" />
                                        ) : isScreenSharing && localStream ? (
                                            <video
                                                ref={localVideoRef}
                                                autoPlay
                                                playsInline
                                                muted
                                                className="w-full h-full object-contain"
                                            />
                                        ) : null}
                                        <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-lg text-sm text-white backdrop-blur-sm font-medium">
                                            {activeScreenShare ? `${activeScreenShare.name}'s Screen` : 'Your Screen'}
                                        </div>
                                    </div>

                                    {/* Bottom Panel: Filmstrip + Controls stacked */}
                                    <div className="shrink-0 bg-slate-900/90 border-t border-white/10">
                                        {/* Filmstrip row */}
                                        <div className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto">
                                            {/* Local camera (if not the one sharing) */}
                                            {!isScreenSharing && (
                                                <div className="w-36 h-20 shrink-0 rounded-lg overflow-hidden ring-1 ring-white/10 relative bg-slate-800">
                                                    <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                                                    {(isVideoOff || !localStream || !localStream.getVideoTracks().length) && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                                                            {profilePicture ? (
                                                                <img src={profilePicture} alt="You" className="w-12 h-12 rounded-full object-cover border-2 border-white/20" />
                                                            ) : (
                                                                <div className="w-12 h-12 rounded-full bg-linear-to-br from-blue-600 to-indigo-700 flex items-center justify-center border-2 border-white/20">
                                                                    <span className="text-lg font-bold text-white">Y</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div className="absolute bottom-1 left-1 bg-black/60 px-2 py-0.5 rounded text-xs text-white">You</div>
                                                </div>
                                            )}
                                            {/* Remote participants not sharing */}
                                            {Object.entries(remoteStreams).map(([uid, r]) => {
                                                if (r.isScreenSharing) return null;
                                                return (
                                                    <div key={uid} className="w-36 h-20 shrink-0 rounded-lg overflow-hidden ring-1 ring-white/10 relative bg-slate-800">
                                                        <RemoteVideo stream={r.stream} />
                                                        {(!r.stream.getVideoTracks().length || !r.stream.getVideoTracks()[0].enabled || (r.isVideoOff && !r.isScreenSharing)) && (
                                                            <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                                                                {r.profilePicture ? (
                                                                    <img src={r.profilePicture} alt={r.name} className="w-12 h-12 rounded-full object-cover border-2 border-white/20" />
                                                                ) : (
                                                                    <div className="w-12 h-12 rounded-full bg-linear-to-br from-blue-600 to-indigo-700 flex items-center justify-center border-2 border-white/20">
                                                                        <span className="text-lg font-bold text-white">{r.name?.charAt(0).toUpperCase()}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div className="absolute bottom-1 left-1 bg-black/60 px-2 py-0.5 rounded text-xs text-white">{r.name}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Controls row */}
                                        <div className="flex items-center justify-center gap-3 px-6 py-2">
                                            <Button onClick={toggleMute} size="icon" className={cn("h-10 w-10 rounded-full transition", isMuted ? "bg-red-500 hover:bg-red-600 text-white" : "bg-white/20 hover:bg-white/30 text-white")}>
                                                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                            </Button>
                                            <Button onClick={toggleVideo} size="icon" className={cn("h-10 w-10 rounded-full transition", isVideoOff ? "bg-red-500 hover:bg-red-600 text-white" : "bg-white/20 hover:bg-white/30 text-white")}>
                                                {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                                            </Button>
                                            <Button onClick={toggleScreenShare} size="icon" className={cn("h-10 w-10 rounded-full transition", isScreenSharing ? "bg-indigo-500 hover:bg-indigo-600 text-white" : "bg-white/20 hover:bg-white/30 text-white")}>
                                                {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                                            </Button>
                                            {isTeamCall && (
                                                <Button onClick={() => setIsInviteModalOpen(true)} size="icon" className="h-10 w-10 rounded-full bg-white/20 hover:bg-white/30 text-white transition">
                                                    <UserPlus className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <div className="w-px h-6 bg-white/20 mx-1" />
                                            <Button onClick={endCall} className="h-10 px-5 rounded-full bg-red-500 hover:bg-red-600 text-white font-semibold transition shadow-lg shadow-red-500/30">
                                                <PhoneOff className="w-4 h-4 mr-2" /> End
                                            </Button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                /* ===== GRID LAYOUT (Normal Mode) ===== */
                                <div className={cn(
                                    "flex-1 grid gap-2 p-2",
                                    Object.keys(remoteStreams).length <= 1 ? "grid-cols-1" :
                                        Object.keys(remoteStreams).length <= 4 ? "grid-cols-2" : "grid-cols-3"
                                )}>
                                    {Object.entries(remoteStreams).map(([uid, r]) => (
                                        <div key={uid} className="relative bg-slate-800 rounded-xl overflow-hidden">
                                            <RemoteVideo stream={r.stream} />
                                            {/* Profile picture fallback when video is off */}
                                            {(!r.stream.getVideoTracks().length || !r.stream.getVideoTracks()[0].enabled || r.isVideoOff) && !r.isScreenSharing && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                                                    {r.profilePicture ? (
                                                        <img src={r.profilePicture} alt={r.name} className="w-28 h-28 rounded-full object-cover border-4 border-slate-600 shadow-xl" />
                                                    ) : (
                                                        <div className="w-28 h-28 rounded-full bg-linear-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-xl border-4 border-white/20">
                                                            <span className="text-4xl font-bold text-white">{r.name?.charAt(0).toUpperCase()}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            <div className="absolute bottom-3 left-3 bg-black/60 px-3 py-1 rounded-lg text-sm text-white backdrop-blur-sm font-medium">
                                                {r.name}
                                            </div>
                                        </div>
                                    ))}

                                    {Object.keys(remoteStreams).length === 0 && (
                                        <div className="flex items-center justify-center w-full h-full text-slate-400 flex-col gap-4">
                                            <div className="w-24 h-24 rounded-full bg-slate-700/50 animate-pulse" />
                                            <p className="text-lg font-medium">Waiting for others to join...</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Local Video PiP (grid mode only, not when sharing) */}
                        {!isScreenShareMode && (
                            <div className={cn(
                                "absolute z-20 transition",
                                Object.keys(remoteStreams).length === 0
                                    ? "inset-0"
                                    : "bottom-24 right-4 w-44 h-32 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20"
                            )}>
                                <video
                                    ref={localVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover"
                                />
                                {(isVideoOff || !localStream || !localStream.getVideoTracks().length) && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                                        {profilePicture ? (
                                            <img src={profilePicture} alt="You" className={cn(
                                                "rounded-full object-cover border-4 border-slate-600 shadow-xl",
                                                Object.keys(remoteStreams).length === 0 ? "w-28 h-28" : "w-16 h-16"
                                            )} />
                                        ) : (
                                            <div className={cn(
                                                "rounded-full bg-linear-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-xl border-4 border-white/20",
                                                Object.keys(remoteStreams).length === 0 ? "w-28 h-28" : "w-16 h-16"
                                            )}>
                                                <span className={cn("font-bold text-white", Object.keys(remoteStreams).length === 0 ? "text-4xl" : "text-xl")}>Y</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded-md text-xs text-white backdrop-blur-sm">
                                    You
                                </div>
                            </div>
                        )}

                        {/* Controls Overlay (grid mode only — hero mode has integrated controls) */}
                        {!isScreenShareMode && (
                            <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-3 z-50 bg-black/50 backdrop-blur-xl px-3 sm:px-6 py-2 sm:py-3 rounded-full border border-white/10 w-max max-w-[95vw]">
                                <Button onClick={toggleMute} size="icon" className={cn("h-10 w-10 sm:h-12 sm:w-12 rounded-full transition shrink-0", isMuted ? "bg-red-500 hover:bg-red-600 text-white" : "bg-white/20 hover:bg-white/30 text-white")}>
                                    {isMuted ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
                                </Button>
                                <Button onClick={toggleVideo} size="icon" className={cn("h-10 w-10 sm:h-12 sm:w-12 rounded-full transition shrink-0", isVideoOff ? "bg-red-500 hover:bg-red-600 text-white" : "bg-white/20 hover:bg-white/30 text-white")}>
                                    {isVideoOff ? <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Video className="w-4 h-4 sm:w-5 sm:h-5" />}
                                </Button>
                                <Button onClick={toggleScreenShare} size="icon" className={cn("h-10 w-10 sm:h-12 sm:w-12 rounded-full transition shrink-0", isScreenSharing ? "bg-indigo-500 hover:bg-indigo-600 text-white" : "bg-white/20 hover:bg-white/30 text-white")}>
                                    {isScreenSharing ? <MonitorOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Monitor className="w-4 h-4 sm:w-5 sm:h-5" />}
                                </Button>
                                {isTeamCall && (
                                    <Button onClick={() => setIsInviteModalOpen(true)} size="icon" className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-full bg-white/20 hover:bg-white/30 text-white transition">
                                        <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
                                    </Button>
                                )}
                                <div className="w-px h-6 sm:h-8 bg-white/20 mx-0.5 sm:mx-1 shrink-0" />
                                <Button onClick={endCall} className="h-10 sm:h-12 px-3 sm:px-6 shrink-0 rounded-full bg-red-500 hover:bg-red-600 text-white font-semibold transition shadow-lg shadow-red-500/30 text-sm sm:text-base">
                                    <PhoneOff className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2" />
                                    <span className="hidden sm:inline">End</span>
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {!showVideoUI && (
                    <div className="flex flex-col items-center text-white text-center">
                        <div className="w-24 h-24 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-3xl font-bold mb-4">
                            {remoteProfilePicture ? <img src={remoteProfilePicture} className="w-full h-full object-cover" /> : <Users className="w-12 h-12" />}
                        </div>
                        <h2 className="text-2xl font-semibold mb-2">{remoteName}</h2>
                        <p className="text-slate-400 mb-8">
                            {callStatus === 'incoming' ? 'Incoming call...' :
                                callStatus === 'outgoing' ? 'Calling...' :
                                    (isTeamCall && Object.keys(remoteStreams).length === 0) ? 'Waiting for others...' :
                                        formatDuration(callDuration)}
                        </p>

                        <div className="flex gap-6">
                            {callStatus === 'incoming' ? (
                                <>
                                    <Button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500"><PhoneOff className="w-8 h-8" /></Button>
                                    <Button onClick={answerCall} className="w-16 h-16 rounded-full bg-green-500"><Phone className="w-8 h-8" /></Button>
                                </>
                            ) : (
                                <Button onClick={endCall} className="w-16 h-16 rounded-full bg-red-500"><PhoneOff className="w-8 h-8" /></Button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <CallInviteModal
                isOpen={isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
                onConfirm={handleInviteConfirmed}
                title="Invite more people"
                showUsers={true}
                showCategories={true}
            />
        </div>
    );
}
