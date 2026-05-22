/**
 * Standalone 1:1 WebRTC signaling handler.
 *
 * Key rule:
 * - Calls are routed ONLY by `activeUsers` map (employeeId -> socketId).
 * - No DB writes, no auth flow changes, no schema changes.
 */
const activeUsers = new Map(); // { employeeId: socketId }

const normalizeEmployeeId = (value) => String(value || '').trim();

const registerEmployeeSocket = (socket, employeeId) => {
    const normalized = normalizeEmployeeId(employeeId);
    if (!normalized) return null;

    activeUsers.set(normalized, socket.id);
    socket.data.employeeId = normalized;
    return normalized;
};

const removeSocketFromActiveUsers = (socket) => {
    const employeeId = normalizeEmployeeId(socket.data?.employeeId);
    if (!employeeId) return;

    // Prevent stale cleanup from removing a newer socket registration.
    if (activeUsers.get(employeeId) === socket.id) {
        activeUsers.delete(employeeId);
    }
};

const emitToEmployee = (io, targetEmployeeId, eventName, payload) => {
    const normalizedTarget = normalizeEmployeeId(targetEmployeeId);
    const targetSocketId = activeUsers.get(normalizedTarget);
    if (!targetSocketId) return false;
    io.to(targetSocketId).emit(eventName, payload);
    return true;
};

const setupOneToOneCallHandler = ({ io, socket }) => {
    // Explicit registration for calling module.
    socket.on('register-employee', (employeeId) => {
        registerEmployeeSocket(socket, employeeId);
    });

    // Optional compatibility with existing app's join_user event.
    socket.on('join_user', (employeeId) => {
        registerEmployeeSocket(socket, employeeId);
    });

    // Offer: caller -> callee
    socket.on('call-user', ({ toEmployeeId, fromEmployeeId, callerName, callType, offer }) => {
        const senderId = socket.data.employeeId || normalizeEmployeeId(fromEmployeeId);
        const normalizedTarget = normalizeEmployeeId(toEmployeeId);

        if (!senderId || !normalizedTarget || !offer) {
            socket.emit('call-failed', { reason: 'INVALID_CALL_PAYLOAD' });
            return;
        }

        // Enforce current socket ownership for sender mapping.
        if (activeUsers.get(senderId) !== socket.id) {
            registerEmployeeSocket(socket, senderId);
        }

        const delivered = emitToEmployee(io, normalizedTarget, 'incoming-call', {
            fromEmployeeId: senderId,
            callerName: callerName || 'Unknown',
            callType: callType === 'audio' ? 'audio' : 'video',
            offer
        });

        if (!delivered) {
            socket.emit('call-failed', { reason: 'USER_OFFLINE', toEmployeeId: normalizedTarget });
        }
    });

    // Answer: callee -> caller
    socket.on('make-answer', ({ toEmployeeId, fromEmployeeId, answer }) => {
        const senderId = socket.data.employeeId || normalizeEmployeeId(fromEmployeeId);
        const normalizedTarget = normalizeEmployeeId(toEmployeeId);

        if (!senderId || !normalizedTarget || !answer) return;

        emitToEmployee(io, normalizedTarget, 'answer-made', {
            fromEmployeeId: senderId,
            answer
        });
    });

    // ICE candidates: both directions
    socket.on('ice-candidate', ({ toEmployeeId, fromEmployeeId, candidate }) => {
        const senderId = socket.data.employeeId || normalizeEmployeeId(fromEmployeeId);
        const normalizedTarget = normalizeEmployeeId(toEmployeeId);

        if (!senderId || !normalizedTarget || !candidate) return;

        emitToEmployee(io, normalizedTarget, 'ice-candidate', {
            fromEmployeeId: senderId,
            candidate
        });
    });

    // Optional end event to close remote side promptly.
    socket.on('end-call', ({ toEmployeeId, fromEmployeeId }) => {
        const senderId = socket.data.employeeId || normalizeEmployeeId(fromEmployeeId);
        const normalizedTarget = normalizeEmployeeId(toEmployeeId);
        if (!senderId || !normalizedTarget) return;

        emitToEmployee(io, normalizedTarget, 'call-ended', {
            fromEmployeeId: senderId
        });
    });

    socket.on('disconnect', () => {
        removeSocketFromActiveUsers(socket);
    });
};

module.exports = {
    setupOneToOneCallHandler,
    activeUsers
};
