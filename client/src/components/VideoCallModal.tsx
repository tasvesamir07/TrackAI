import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Socket } from 'socket.io-client';

type CallType = 'audio' | 'video';

interface EmployeePeer {
    employeeId: string | number;
    name: string;
}

interface IncomingCallPayload {
    fromEmployeeId: string;
    callerName: string;
    callType: CallType;
    offer: RTCSessionDescriptionInit;
}

interface VideoCallModalProps {
    socket: Socket | null;
    currentEmployeeId: string | number;
    currentEmployeeName: string;
    isOpen: boolean;
    targetEmployee?: EmployeePeer | null;
    callType?: CallType;
    onClose: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export default function VideoCallModal({
    socket,
    currentEmployeeId,
    currentEmployeeName,
    isOpen,
    targetEmployee = null,
    callType = 'video',
    onClose
}: VideoCallModalProps) {
    const [status, setStatus] = useState<'idle' | 'incoming' | 'outgoing' | 'connecting' | 'connected'>('idle');
    const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
    const [remotePeer, setRemotePeer] = useState<EmployeePeer | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [errorText, setErrorText] = useState('');

    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const startedOutgoingKeyRef = useRef<string | null>(null);

    const normalizedCurrentEmployeeId = useMemo(() => String(currentEmployeeId), [currentEmployeeId]);
    const shouldRender = isOpen || status !== 'idle' || Boolean(incomingCall);

    const applyVideoElements = useCallback(() => {
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
        }
    }, [localStream, remoteStream]);

    useEffect(() => {
        applyVideoElements();
    }, [applyVideoElements]);

    const stopMediaStream = (stream: MediaStream | null) => {
        if (!stream) return;
        stream.getTracks().forEach((track) => track.stop());
    };

    const cleanupCall = useCallback(() => {
        if (peerConnectionRef.current) {
            peerConnectionRef.current.ontrack = null;
            peerConnectionRef.current.onicecandidate = null;
            peerConnectionRef.current.onconnectionstatechange = null;
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
        }

        stopMediaStream(localStream);
        setLocalStream(null);
        setRemoteStream(null);
        pendingIceCandidatesRef.current = [];
        startedOutgoingKeyRef.current = null;
        setIncomingCall(null);
        setRemotePeer(null);
        setStatus('idle');
        setIsMicMuted(false);
        setIsCameraOff(false);
    }, [localStream]);

    const endCall = useCallback((notifyRemote = true) => {
        if (notifyRemote && socket && remotePeer?.employeeId) {
            socket.emit('end-call', {
                toEmployeeId: String(remotePeer.employeeId),
                fromEmployeeId: normalizedCurrentEmployeeId
            });
        }
        cleanupCall();
        onClose();
    }, [cleanupCall, normalizedCurrentEmployeeId, onClose, remotePeer, socket]);

    const flushPendingCandidates = useCallback(async () => {
        if (!peerConnectionRef.current || pendingIceCandidatesRef.current.length === 0) return;
        const queued = [...pendingIceCandidatesRef.current];
        pendingIceCandidatesRef.current = [];

        for (const candidate of queued) {
            try {
                await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error('Failed to apply queued ICE candidate:', err);
            }
        }
    }, []);

    const handleIncomingIce = useCallback(async (candidate: RTCIceCandidateInit) => {
        const pc = peerConnectionRef.current;
        if (!pc || !pc.remoteDescription) {
            pendingIceCandidatesRef.current.push(candidate);
            return;
        }

        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('Failed to add ICE candidate:', err);
        }
    }, []);

    const ensurePeerConnection = useCallback((targetEmployeeId: string) => {
        if (peerConnectionRef.current) return peerConnectionRef.current;

        const pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnectionRef.current = pc;

        // Signaling step #3: send local ICE candidates to the target employee only.
        pc.onicecandidate = (event) => {
            if (!event.candidate || !socket) return;
            socket.emit('ice-candidate', {
                toEmployeeId: targetEmployeeId,
                fromEmployeeId: normalizedCurrentEmployeeId,
                candidate: event.candidate.toJSON()
            });
        };

        pc.ontrack = (event) => {
            const [stream] = event.streams;
            if (stream) {
                setRemoteStream(stream);
                return;
            }
            setRemoteStream((prev) => {
                const merged = prev || new MediaStream();
                merged.addTrack(event.track);
                return merged;
            });
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                setStatus('connected');
            } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
                cleanupCall();
                onClose();
            }
        };

        return pc;
    }, [cleanupCall, normalizedCurrentEmployeeId, onClose, socket]);

    const getMedia = useCallback(async (kind: CallType) => {
        const constraints: MediaStreamConstraints = kind === 'audio'
            ? { audio: true, video: false }
            : { audio: true, video: true };
        return navigator.mediaDevices.getUserMedia(constraints);
    }, []);

    const startOutgoingCall = useCallback(async () => {
        if (!socket || !targetEmployee) return;

        const targetEmployeeId = String(targetEmployee.employeeId);
        const key = `${targetEmployeeId}:${callType}`;
        if (startedOutgoingKeyRef.current === key) return;
        startedOutgoingKeyRef.current = key;

        try {
            setErrorText('');
            setRemotePeer(targetEmployee);
            setStatus('outgoing');

            const stream = await getMedia(callType);
            setLocalStream(stream);

            const pc = ensurePeerConnection(targetEmployeeId);
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            // Signaling step #1: caller creates offer and sends it through Socket.io.
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit('call-user', {
                toEmployeeId: targetEmployeeId,
                fromEmployeeId: normalizedCurrentEmployeeId,
                callerName: currentEmployeeName,
                callType,
                offer
            });
        } catch (err) {
            console.error('Failed to start outgoing call:', err);
            setErrorText('Unable to start call. Check camera/microphone permission.');
            cleanupCall();
        }
    }, [callType, cleanupCall, currentEmployeeName, ensurePeerConnection, getMedia, normalizedCurrentEmployeeId, socket, targetEmployee]);

    const acceptIncomingCall = useCallback(async () => {
        if (!socket || !incomingCall) return;

        try {
            setErrorText('');
            setStatus('connecting');
            setRemotePeer({
                employeeId: incomingCall.fromEmployeeId,
                name: incomingCall.callerName
            });

            const stream = await getMedia(incomingCall.callType);
            setLocalStream(stream);

            const pc = ensurePeerConnection(String(incomingCall.fromEmployeeId));
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));

            await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));

            // Signaling step #2: callee creates answer and sends it back.
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('make-answer', {
                toEmployeeId: String(incomingCall.fromEmployeeId),
                fromEmployeeId: normalizedCurrentEmployeeId,
                answer
            });

            await flushPendingCandidates();
            setIncomingCall(null);
        } catch (err) {
            console.error('Failed to accept incoming call:', err);
            setErrorText('Unable to accept call.');
            cleanupCall();
        }
    }, [cleanupCall, ensurePeerConnection, flushPendingCandidates, getMedia, incomingCall, normalizedCurrentEmployeeId, socket]);

    const rejectIncomingCall = useCallback(() => {
        if (socket && incomingCall?.fromEmployeeId) {
            socket.emit('end-call', {
                toEmployeeId: String(incomingCall.fromEmployeeId),
                fromEmployeeId: normalizedCurrentEmployeeId
            });
        }
        cleanupCall();
        onClose();
    }, [cleanupCall, incomingCall, normalizedCurrentEmployeeId, onClose, socket]);

    const toggleMic = () => {
        if (!localStream) return;
        const nextMuted = !isMicMuted;
        localStream.getAudioTracks().forEach((track) => {
            track.enabled = !nextMuted;
        });
        setIsMicMuted(nextMuted);
    };

    const toggleCamera = () => {
        if (!localStream) return;
        const nextCameraOff = !isCameraOff;
        localStream.getVideoTracks().forEach((track) => {
            track.enabled = !nextCameraOff;
        });
        setIsCameraOff(nextCameraOff);
    };

    useEffect(() => {
        if (!socket) return;

        const register = () => {
            socket.emit('register-employee', normalizedCurrentEmployeeId);
        };

        register();
        socket.on('connect', register);
        return () => {
            socket.off('connect', register);
        };
    }, [normalizedCurrentEmployeeId, socket]);

    useEffect(() => {
        if (!socket) return;

        const onIncomingCall = (payload: IncomingCallPayload) => {
            setErrorText('');
            setIncomingCall(payload);
            setRemotePeer({
                employeeId: payload.fromEmployeeId,
                name: payload.callerName
            });
            setStatus('incoming');
        };

        const onAnswerMade = async (payload: { fromEmployeeId: string; answer: RTCSessionDescriptionInit }) => {
            const expected = String(remotePeer?.employeeId || '');
            if (!peerConnectionRef.current || !payload?.answer) return;
            if (expected && expected !== String(payload.fromEmployeeId)) return;
            try {
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
                await flushPendingCandidates();
                setStatus('connecting');
            } catch (err) {
                console.error('Failed to apply remote answer:', err);
            }
        };

        const onIceCandidate = (payload: { fromEmployeeId: string; candidate: RTCIceCandidateInit }) => {
            const expected = String(remotePeer?.employeeId || '');
            if (expected && expected !== String(payload.fromEmployeeId)) return;
            if (!payload?.candidate) return;
            void handleIncomingIce(payload.candidate);
        };

        const onCallEnded = () => {
            cleanupCall();
            onClose();
        };

        const onCallFailed = (payload: { reason?: string }) => {
            setErrorText(payload?.reason === 'USER_OFFLINE' ? 'User is offline.' : 'Call failed.');
            cleanupCall();
            onClose();
        };

        socket.on('incoming-call', onIncomingCall);
        socket.on('answer-made', onAnswerMade);
        socket.on('ice-candidate', onIceCandidate);
        socket.on('call-ended', onCallEnded);
        socket.on('call-failed', onCallFailed);

        return () => {
            socket.off('incoming-call', onIncomingCall);
            socket.off('answer-made', onAnswerMade);
            socket.off('ice-candidate', onIceCandidate);
            socket.off('call-ended', onCallEnded);
            socket.off('call-failed', onCallFailed);
        };
    }, [cleanupCall, flushPendingCandidates, handleIncomingIce, onClose, remotePeer, socket]);

    useEffect(() => {
        if (!socket || !isOpen || !targetEmployee) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void startOutgoingCall();
    }, [isOpen, socket, startOutgoingCall, targetEmployee]);

    useEffect(() => {
        return () => {
            cleanupCall();
        };
    }, [cleanupCall]);

    if (!shouldRender) return null;

    const remoteTitle = remotePeer?.name || 'Unknown employee';
    const showVideoPanels = (incomingCall?.callType || callType) === 'video' || status === 'connected';

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                <h3 style={styles.title}>1:1 {callType === 'audio' ? 'Audio' : 'Video'} Call</h3>
                <p style={styles.subtitle}>
                    {status === 'incoming' && `${remoteTitle} is calling...`}
                    {status === 'outgoing' && `Calling ${remoteTitle}...`}
                    {status === 'connecting' && 'Connecting...'}
                    {status === 'connected' && `Connected with ${remoteTitle}`}
                    {status === 'idle' && 'Ready'}
                </p>

                {errorText ? <p style={styles.error}>{errorText}</p> : null}

                {showVideoPanels ? (
                    <div style={styles.videoGrid}>
                        <video ref={remoteVideoRef} autoPlay playsInline style={styles.video} />
                        <video ref={localVideoRef} autoPlay playsInline muted style={styles.video} />
                    </div>
                ) : null}

                <div style={styles.controls}>
                    {status === 'incoming' ? (
                        <>
                            <button type="button" onClick={acceptIncomingCall} style={styles.successButton}>Accept</button>
                            <button type="button" onClick={rejectIncomingCall} style={styles.dangerButton}>Reject</button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={toggleMic} style={styles.secondaryButton}>
                                {isMicMuted ? 'Unmute' : 'Mute'}
                            </button>
                            {callType === 'video' ? (
                                <button type="button" onClick={toggleCamera} style={styles.secondaryButton}>
                                    {isCameraOff ? 'Camera On' : 'Camera Off'}
                                </button>
                            ) : null}
                            <button type="button" onClick={() => endCall(true)} style={styles.dangerButton}>End Call</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

const styles: Record<string, CSSProperties> = {
    overlay: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(17, 24, 39, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
    },
    modal: {
        width: 'min(920px, 95vw)',
        background: '#0f172a',
        borderRadius: 16,
        border: '1px solid rgba(148, 163, 184, 0.25)',
        padding: 20,
        color: '#f8fafc'
    },
    title: {
        margin: '0 0 6px',
        fontSize: 22,
        fontWeight: 700
    },
    subtitle: {
        margin: '0 0 12px',
        color: '#cbd5e1',
        fontSize: 14
    },
    error: {
        margin: '0 0 12px',
        color: '#fca5a5',
        fontSize: 13
    },
    videoGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 12,
        marginBottom: 14
    },
    video: {
        width: '100%',
        minHeight: 220,
        borderRadius: 12,
        background: '#020617',
        objectFit: 'cover'
    },
    controls: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10
    },
    successButton: {
        background: '#16a34a',
        color: '#ffffff',
        border: 'none',
        padding: '10px 16px',
        borderRadius: 10,
        cursor: 'pointer'
    },
    dangerButton: {
        background: '#dc2626',
        color: '#ffffff',
        border: 'none',
        padding: '10px 16px',
        borderRadius: 10,
        cursor: 'pointer'
    },
    secondaryButton: {
        background: '#334155',
        color: '#ffffff',
        border: 'none',
        padding: '10px 16px',
        borderRadius: 10,
        cursor: 'pointer'
    }
};
