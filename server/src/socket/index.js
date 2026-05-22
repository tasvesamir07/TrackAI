const jwt = require('jsonwebtoken');
const { encrypt, decrypt } = require('../utils/security');
const db = require('../db');
const timeService = require('../utils/timeService');
const { sendChatPushToUsers } = require('../utils/webPushService');
const { setupOneToOneCallHandler } = require('./oneToOneCallHandler');
const ROLE_VISIBILITY = {
    admin: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    moderator: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    employee: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    COMPANY_ADMIN: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    SUPERADMIN: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN']
};

const canViewUserRole = (viewerRole, targetRole) => {
    const allowed = ROLE_VISIBILITY[viewerRole] || [];
    return allowed.includes(targetRole);
};

const getDepartmentAlias = (department) => {
    const normalized = String(department || '').trim();
    return normalized || 'Admin';
};

const shouldMaskAdminIdentity = () => false;

const getVisibleNameForViewer = ({ viewerId, viewerRole, targetId, targetRole, targetUsername, targetDepartment }) => {
    if (shouldMaskAdminIdentity(viewerId, viewerRole, targetId, targetRole)) {
        return getDepartmentAlias(targetDepartment);
    }
    return targetUsername;
};

const getVisibleRoleLabelForViewer = ({ viewerId, viewerRole, targetId, targetRole, targetDepartment }) => {
    if (shouldMaskAdminIdentity(viewerId, viewerRole, targetId, targetRole)) {
        const normalized = String(targetDepartment || '').trim();
        return normalized || 'Department';
    }
    return targetRole;
};

const applyMessageVisibilityForViewer = (message, viewer) => {
    const masked = { ...message };
    masked.username = getVisibleNameForViewer({
        viewerId: viewer.id,
        viewerRole: viewer.role,
        targetId: message.user_id,
        targetRole: message.role,
        targetUsername: message.username,
        targetDepartment: message.department
    });
    masked.role = getVisibleRoleLabelForViewer({
        viewerId: viewer.id,
        viewerRole: viewer.role,
        targetId: message.user_id,
        targetRole: message.role,
        targetDepartment: message.department
    });

    if (message.reply_username) {
        masked.reply_username = getVisibleNameForViewer({
            viewerId: viewer.id,
            viewerRole: viewer.role,
            targetId: message.reply_user_id,
            targetRole: message.reply_role,
            targetUsername: message.reply_username,
            targetDepartment: message.reply_department
        });
    }

    return masked;
};

const getGroupRoomId = (groupId) => `chat:group:${groupId}`;
const getTeamRoomId = (companyId = 'global') => `chat:team:${companyId}`;
const getDmRoomId = (a, b) => {
    const x = Number.parseInt(String(a), 10);
    const y = Number.parseInt(String(b), 10);
    const [minId, maxId] = [x, y].sort((left, right) => left - right);
    return `chat:dm:${minId}:${maxId}`;
};

/**
 * Setup Socket.IO for the application
 */
const setupSocket = (server, app, allowedOrigins) => {
    const io = require('socket.io')(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            credentials: true
        }
    });

    app.set('io', io);

    attachSocketHandlers(io, app);

    return io;
};

const attachSocketHandlers = (io, app) => {
    io.on('connection', (socket) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            socket.disconnect(true);
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            socket.userId = decoded.id;
            socket.userRole = decoded.role;
            socket.companyId = decoded.company_id || null;
        } catch (err) {
            socket.disconnect(true);
            return;
        }

        // Standalone 1:1 call signaling (WebRTC offer/answer/ICE).
        setupOneToOneCallHandler({ io, socket });

        // Join user specific room for DMs
        socket.on('join_user', async (userId) => {
            if (userId && userId === socket.userId) {
                socket.join(userId.toString());

                // Mark pending messages to this user as 'delivered'
                try {
                    const userMeta = await db.query(
                        'SELECT company_id FROM users WHERE id = $1 LIMIT 1',
                        [userId]
                    );
                    const companyId = userMeta.rows[0]?.company_id || 'global';
                    socket.companyId = companyId;
                    socket.join(getTeamRoomId(companyId));

                    const result = await db.query(
                        "UPDATE messages SET status = 'delivered' WHERE recipient_id = $1 AND status = 'sent' RETURNING id, user_id",
                        [userId]
                    );

                    // Notify senders that their messages are now delivered
                    if (result.rows.length > 0) {
                        const senders = [...new Set(result.rows.map(r => r.user_id))];
                        senders.forEach(senderId => {
                            const senderMessages = result.rows.filter(r => r.user_id === senderId).map(r => r.id);
                            io.to(senderId.toString()).emit('messages_delivered', {
                                messageIds: senderMessages,
                                recipientId: userId
                            });
                        });
                    }
                } catch (err) {
                    console.error('Error updating delivery status on join:', err);
                }
            }
        });

        socket.on('join_chat_room', (payload = {}) => {
            try {
                const roomId = String(payload.roomId || '').trim();
                if (!roomId) return;
                socket.join(roomId);
            } catch (err) {
                console.error('Failed to join chat room:', err);
            }
        });

        socket.on('leave_chat_room', (payload = {}) => {
            try {
                const roomId = String(payload.roomId || '').trim();
                if (!roomId) return;
                socket.leave(roomId);
            } catch (err) {
                console.error('Failed to leave chat room:', err);
            }
        });

        socket.on('send_message', async (data) => {
            try {
                const senderId = socket.userId;
                if (!senderId) return;

                if (data.groupId) {
                    const membershipRes = await db.query(
                        'SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2',
                        [data.groupId, senderId]
                    );

                    if (membershipRes.rows.length === 0) {
                        return;
                    }

                    const encryptedContent = encrypt(data.content);
                    const result = await db.query(
                        'INSERT INTO messages (user_id, group_id, content, attachment_url, attachment_type, attachments, reply_to_id, is_forwarded, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at',
                        [senderId, data.groupId, encryptedContent, data.attachment_url, data.attachment_type, JSON.stringify(data.attachments || []), data.replyToId || null, data.is_forwarded || false, timeService.getNow()]
                    );

                    const userRes = await db.query('SELECT username, role, status, profile_picture, department FROM users WHERE id = $1', [senderId]);
                    const sender = userRes.rows[0];
                    const groupRes = await db.query('SELECT name FROM chat_groups WHERE id = $1', [data.groupId]);
                    const groupName = groupRes.rows[0]?.name || 'Group';

                    let replyContext = {};
                    if (data.replyToId) {
                        const replyRes = await db.query(`
                            SELECT m.content, m.user_id, u.username, u.role, u.department
                            FROM messages m
                            JOIN users u ON m.user_id = u.id
                            WHERE m.id = $1`, [data.replyToId]);
                        if (replyRes.rows.length > 0) {
                            replyContext = {
                                reply_to_id: data.replyToId,
                                reply_content: decrypt(replyRes.rows[0].content),
                                reply_user_id: replyRes.rows[0].user_id,
                                reply_username: replyRes.rows[0].username,
                                reply_role: replyRes.rows[0].role,
                                reply_department: replyRes.rows[0].department
                            };
                        }
                    }

                    const newMessage = {
                        id: result.rows[0].id,
                        user_id: data.userId,
                        recipient_id: null,
                        group_id: data.groupId,
                        group_name: groupName,
                        username: sender.username,
                        role: sender.role,
                        department: sender.department,
                        content: data.content,
                        created_at: result.rows[0].created_at,
                        profile_picture: sender.profile_picture,
                        attachment_url: data.attachment_url,
                        attachment_type: data.attachment_type,
                        attachments: data.attachments || [],
                        is_forwarded: data.is_forwarded || false,
                        client_temp_id: data.client_temp_id || null,
                        ...replyContext
                    };

                    const memberRes = await db.query(
                        'SELECT user_id FROM chat_group_members WHERE group_id = $1',
                        [data.groupId]
                    );
                    const memberIds = memberRes.rows.map(({ user_id }) => user_id);
                    const memberRolesRes = await db.query(
                        'SELECT id, role FROM users WHERE id = ANY($1::int[])',
                        [memberIds]
                    );
                    const memberRoleMap = new Map(memberRolesRes.rows.map((row) => [Number(row.id), row.role]));
                    const senderRole = memberRoleMap.get(Number(senderId)) || sender.role || 'employee';
                    const senderPayload = applyMessageVisibilityForViewer(newMessage, { id: senderId, role: senderRole });
                    socket.emit('receive_message', senderPayload);

                    const groupRoomId = getGroupRoomId(data.groupId);
                    socket.join(groupRoomId);
                    socket.to(groupRoomId).emit('receive_message', senderPayload);

                    const groupRoomSockets = io.sockets.adapter.rooms.get(groupRoomId);
                    const hasJoinedGroupRoomListeners = Boolean(groupRoomSockets && groupRoomSockets.size > 1);

                    if (!hasJoinedGroupRoomListeners) {
                        memberIds.forEach((memberId) => {
                            if (Number(memberId) === Number(senderId)) return;
                            const viewerRole = memberRoleMap.get(Number(memberId)) || 'employee';
                            const payload = applyMessageVisibilityForViewer(newMessage, { id: memberId, role: viewerRole });
                            io.to(memberId.toString()).emit('receive_message', payload);
                        });
                    }

                    const offlineRecipientIds = memberIds
                        .filter((memberId) => Number(memberId) !== Number(senderId))
                        .filter((memberId) => {
                            const room = io.sockets.adapter.rooms.get(memberId.toString());
                            return !room || room.size === 0;
                        });

                    if (offlineRecipientIds.length > 0) {
                        sendChatPushToUsers({
                            recipientUserIds: offlineRecipientIds,
                            senderName: sender.username,
                            messageText: data.content,
                            conversationId: `group-${data.groupId}`,
                            groupName
                        }).catch((error) => {
                            console.error('[Socket] Failed to send group push notifications:', error?.message || error);
                        });
                    }
                } else if (data.recipientId) {
                    // Private Message
                    const senderRoleRes = await db.query('SELECT role FROM users WHERE id = $1', [senderId]);
                    const recipientRoleRes = await db.query('SELECT role FROM users WHERE id = $1', [data.recipientId]);
                    const senderRole = senderRoleRes.rows[0]?.role;
                    const recipientRole = recipientRoleRes.rows[0]?.role;
                    if (!senderRole || !recipientRole) {
                        return;
                    }
                    if (!canViewUserRole(senderRole, recipientRole)) {
                        return;
                    }

                    const encryptedContent = encrypt(data.content);
                    
                    // Check if recipient is online
                    const recipientRoom = io.sockets.adapter.rooms.get(data.recipientId.toString());
                    const initialStatus = (recipientRoom && recipientRoom.size > 0) ? 'delivered' : 'sent';

                    const result = await db.query(
                        'INSERT INTO messages (user_id, recipient_id, content, attachment_url, attachment_type, attachments, reply_to_id, is_forwarded, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, created_at',
                        [senderId, data.recipientId, encryptedContent, data.attachment_url, data.attachment_type, JSON.stringify(data.attachments || []), data.replyToId || null, data.is_forwarded || false, initialStatus, timeService.getNow()]
                    );

                    const userRes = await db.query('SELECT username, role, status, profile_picture, department FROM users WHERE id = $1', [senderId]);
                    const sender = userRes.rows[0];

                    let replyContext = {};
                    if (data.replyToId) {
                        const replyRes = await db.query(`
                            SELECT m.content, m.user_id, u.username, u.role, u.department
                            FROM messages m 
                            JOIN users u ON m.user_id = u.id 
                            WHERE m.id = $1`, [data.replyToId]);
                        if (replyRes.rows.length > 0) {
                            replyContext = {
                                reply_to_id: data.replyToId,
                                reply_content: decrypt(replyRes.rows[0].content),
                                reply_user_id: replyRes.rows[0].user_id,
                                reply_username: replyRes.rows[0].username,
                                reply_role: replyRes.rows[0].role,
                                reply_department: replyRes.rows[0].department
                            };
                        }
                    }

                    const newMessage = {
                        id: result.rows[0].id,
                        user_id: data.userId,
                        recipient_id: data.recipientId,
                        username: sender.username,
                        role: sender.role,
                        department: sender.department,
                        content: data.content,
                        created_at: result.rows[0].created_at,
                        profile_picture: sender.profile_picture,
                        attachment_url: data.attachment_url,
                        attachment_type: data.attachment_type,
                        attachments: data.attachments || [],
                        is_forwarded: data.is_forwarded || false,
                        status: initialStatus,
                        client_temp_id: data.client_temp_id || null,
                        ...replyContext
                    };

                    const toRecipientPayload = applyMessageVisibilityForViewer(newMessage, {
                        id: data.recipientId,
                        role: recipientRole
                    });
                    const toSenderPayload = applyMessageVisibilityForViewer(newMessage, {
                        id: senderId,
                        role: senderRole
                    });

                    io.to(data.recipientId.toString()).emit('receive_message', toRecipientPayload);
                    io.to(senderId.toString()).emit('receive_message', toSenderPayload);

                    const dmRoomId = getDmRoomId(senderId, data.recipientId);
                    socket.join(dmRoomId);
                    socket.to(dmRoomId).emit('receive_message', toRecipientPayload);

                    if (!recipientRoom || recipientRoom.size === 0) {
                        sendChatPushToUsers({
                            recipientUserIds: [data.recipientId],
                            senderName: sender.username,
                            messageText: data.content,
                            conversationId: senderId
                        }).catch((error) => {
                            console.error('[Socket] Failed to send direct push notification:', error?.message || error);
                        });
                    }
                } else {
                    // Public Message
                    const encryptedContent = encrypt(data.content);
                    const result = await db.query(
                        'INSERT INTO messages (user_id, content, attachment_url, attachment_type, attachments, reply_to_id, is_forwarded, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at',
                        [senderId, encryptedContent, data.attachment_url, data.attachment_type, JSON.stringify(data.attachments || []), data.replyToId || null, data.is_forwarded || false, timeService.getNow()]
                    );

                    const userRes = await db.query('SELECT username, role, status, profile_picture, department FROM users WHERE id = $1', [senderId]);
                    const sender = userRes.rows[0];

                    let replyContext = {};
                    if (data.replyToId) {
                        const replyRes = await db.query(`
                            SELECT m.content, m.user_id, u.username, u.role, u.department
                            FROM messages m 
                            JOIN users u ON m.user_id = u.id 
                            WHERE m.id = $1`, [data.replyToId]);
                        if (replyRes.rows.length > 0) {
                            replyContext = {
                                reply_to_id: data.replyToId,
                                reply_content: decrypt(replyRes.rows[0].content),
                                reply_user_id: replyRes.rows[0].user_id,
                                reply_username: replyRes.rows[0].username,
                                reply_role: replyRes.rows[0].role,
                                reply_department: replyRes.rows[0].department
                            };
                        }
                    }

                    const newMessage = {
                        id: result.rows[0].id,
                        user_id: data.userId,
                        recipient_id: null,
                        username: sender.username,
                        role: sender.role,
                        department: sender.department,
                        content: data.content,
                        created_at: result.rows[0].created_at,
                        profile_picture: sender.profile_picture,
                        attachment_url: data.attachment_url,
                        attachment_type: data.attachment_type,
                        attachments: data.attachments || [],
                        is_forwarded: data.is_forwarded || false,
                        client_temp_id: data.client_temp_id || null,
                        ...replyContext
                    };

                    const connectedUserIds = Array.from(io.sockets.adapter.rooms.keys())
                        .filter((roomId) => /^\d+$/.test(roomId))
                        .map((roomId) => Number.parseInt(roomId, 10))
                        .filter((id) => Number.isInteger(id));
                    const uniqueConnectedIds = Array.from(new Set(connectedUserIds));

                    if (uniqueConnectedIds.length > 0) {
                        const viewerRolesRes = await db.query(
                            'SELECT id, role FROM users WHERE id = ANY($1::int[])',
                            [uniqueConnectedIds]
                        );
                        const viewerRoleMap = new Map(viewerRolesRes.rows.map((row) => [Number(row.id), row.role]));

                        uniqueConnectedIds.forEach((viewerId) => {
                            const viewerRole = viewerRoleMap.get(Number(viewerId));
                            if (!viewerRole) return;
                            if (!canViewUserRole(viewerRole, sender.role) && Number(viewerId) !== Number(senderId)) return;
                            const payload = applyMessageVisibilityForViewer(newMessage, { id: viewerId, role: viewerRole });
                            io.to(viewerId.toString()).emit('receive_message', payload);
                        });
                    }
                }
            } catch (err) {
                console.error('Socket message error:', err);
            }
        });

        // Team Call Signaling
        let teamParticipants = app.get('team_participants') || new Set();

        socket.on('start_team_call', async (data) => {
            teamParticipants.add(socket.userId);
            app.set('team_participants', teamParticipants);

            const activeTeamCall = {
                callerId: socket.userId,
                callerName: data.callerName,
                callerProfilePicture: data.callerProfilePicture,
                callType: data.callType,
                startTime: Date.now()
            };
            app.set('active_team_call', activeTeamCall);

            const notificationData = {
                callerId: socket.userId,
                callerName: data.callerName,
                callerProfilePicture: data.callerProfilePicture,
                callType: data.callType,
                participants: Array.from(teamParticipants)
            };

            let usersToNotify = new Set();
            if (data.targetUserIds && Array.isArray(data.targetUserIds)) {
                data.targetUserIds.forEach(id => usersToNotify.add(parseInt(id)));
            }

            if (data.targetCategoryIds && data.targetCategoryIds.length > 0) {
                try {
                    const result = await db.query('SELECT DISTINCT user_id FROM user_categories WHERE category_id = ANY($1)', [data.targetCategoryIds]);
                    result.rows.forEach(r => usersToNotify.add(r.user_id));
                } catch (err) {
                    console.error('Error fetching target users for team call:', err);
                }
            }

            if (usersToNotify.size > 0) {
                usersToNotify.forEach(uid => {
                    if (uid !== socket.userId) {
                        io.to(uid.toString()).emit('team_call_started', notificationData);
                    }
                });
            } else if ((!data.targetCategoryIds || data.targetCategoryIds.length === 0) && (!data.targetUserIds || data.targetUserIds.length === 0)) {
                socket.broadcast.emit('team_call_started', notificationData);
            }
        });

        socket.on('check_active_team_call', () => {
            const activeTeamCall = app.get('active_team_call');
            if (activeTeamCall) {
                socket.emit('team_call_started', {
                    ...activeTeamCall,
                    participants: Array.from(teamParticipants),
                    isReconnection: true
                });
            }
        });

        socket.on('invite_to_team_call', async (data) => {
            const notificationData = {
                callerId: socket.userId,
                callerName: data.callerName,
                callerProfilePicture: data.callerProfilePicture,
                callType: data.callType,
                participants: Array.from(teamParticipants),
                isInvitation: true
            };

            let finalTargetUserIds = new Set(data.targetUserIds || []);
            if (data.targetCategoryIds && data.targetCategoryIds.length > 0) {
                try {
                    const result = await db.query('SELECT DISTINCT user_id FROM user_categories WHERE category_id = ANY($1)', [data.targetCategoryIds]);
                    result.rows.forEach(r => finalTargetUserIds.add(r.user_id));
                } catch (err) {
                    console.error('Error fetching target users for invitation:', err);
                }
            }

            finalTargetUserIds.forEach(uid => {
                if (uid !== socket.userId) {
                    io.to(uid.toString()).emit('team_call_started', notificationData);
                }
            });
        });

        socket.on('join_team_call', (data) => {
            socket.broadcast.emit('user_joining_team_call', {
                userId: socket.userId,
                username: data.username,
                profilePicture: data.profilePicture
            });

            teamParticipants.add(socket.userId);
            app.set('team_participants', teamParticipants);
        });

        socket.on('team_call_offer', (data) => {
            io.to(data.targetUserId.toString()).emit('team_call_offer', {
                callerId: data.callerId,
                callerName: data.callerName,
                callerProfilePicture: data.callerProfilePicture,
                callType: data.callType,
                offer: data.offer
            });
        });

        socket.on('team_call_answer', (data) => {
            io.to(data.targetUserId.toString()).emit('team_call_answer', { userId: socket.userId, answer: data.answer });
        });

        // Team call ICE relay (kept for existing team modal).
        socket.on('ice_candidate', (data) => {
            io.to(data.targetUserId.toString()).emit('ice_candidate', { senderId: socket.userId, candidate: data.candidate });
        });

        socket.on('leave_team_call', () => {
            teamParticipants.delete(socket.userId);
            app.set('team_participants', teamParticipants);
            socket.broadcast.emit('user_left_team_call', { userId: socket.userId });
            if (teamParticipants.size === 0) {
                app.set('active_team_call', null);
                io.emit('team_call_ended');
            }
        });

        socket.on('screen_share_status', (data) => {
            if (teamParticipants.has(socket.userId)) {
                teamParticipants.forEach(uid => {
                    if (uid !== socket.userId) {
                        io.to(uid.toString()).emit('screen_share_status', { userId: socket.userId, isSharing: data.isSharing });
                    }
                });
            }
            if (data.targetUserId) {
                io.to(data.targetUserId.toString()).emit('screen_share_status', { userId: socket.userId, isSharing: data.isSharing });
            }
        });

        socket.on('media_status_change', (data) => {
            const payload = { userId: socket.userId, type: data.type, enabled: data.enabled };
            if (teamParticipants.has(socket.userId)) {
                teamParticipants.forEach(uid => {
                    if (uid !== socket.userId) {
                        io.to(uid.toString()).emit('media_status_change', payload);
                    }
                });
            }
            if (data.targetUserId) {
                io.to(data.targetUserId.toString()).emit('media_status_change', payload);
            }
        });

        socket.on('typing', async (data) => {
            try {
                if (data.groupId) {
                    const groupRoomId = getGroupRoomId(data.groupId);
                    socket.join(groupRoomId);
                    socket.to(groupRoomId).emit('typing', { userId: socket.userId, groupId: data.groupId });
                    return;
                }

                if (data.recipientId && data.recipientId !== 'team') {
                    const dmRoomId = getDmRoomId(socket.userId, data.recipientId);
                    socket.join(dmRoomId);
                    socket.to(dmRoomId).emit('typing', { userId: socket.userId, recipientId: data.recipientId });
                    io.to(data.recipientId.toString()).emit('typing', { userId: socket.userId, recipientId: data.recipientId });
                } else {
                    const teamRoomId = getTeamRoomId(socket.companyId || 'global');
                    socket.to(teamRoomId).emit('typing', { userId: socket.userId, recipientId: 'team' });
                }
            } catch (err) {
                console.error('Typing event failed:', err);
            }
        });

        socket.on('stop_typing', async (data) => {
            try {
                if (data.groupId) {
                    const groupRoomId = getGroupRoomId(data.groupId);
                    socket.to(groupRoomId).emit('stop_typing', { userId: socket.userId, groupId: data.groupId });
                    return;
                }

                if (data.recipientId && data.recipientId !== 'team') {
                    const dmRoomId = getDmRoomId(socket.userId, data.recipientId);
                    socket.to(dmRoomId).emit('stop_typing', { userId: socket.userId, recipientId: data.recipientId });
                    io.to(data.recipientId.toString()).emit('stop_typing', { userId: socket.userId, recipientId: data.recipientId });
                } else {
                    const teamRoomId = getTeamRoomId(socket.companyId || 'global');
                    socket.to(teamRoomId).emit('stop_typing', { userId: socket.userId, recipientId: 'team' });
                }
            } catch (err) {
                console.error('Stop typing event failed:', err);
            }
        });

        socket.on('mark_seen', async (data) => {
            try {
                const { conversationId, contactId } = data;
                if (!socket.userId) return;

                // Update only relevant messages
                let result;
                if (contactId) {
                    result = await db.query(
                        "UPDATE messages SET status = 'seen' WHERE recipient_id = $1 AND user_id = $2 AND status != 'seen' RETURNING id, user_id",
                        [socket.userId, contactId]
                    );
                }

                if (result && result.rows.length > 0) {
                    const senderId = result.rows[0].user_id;
                    const messageIds = result.rows.map(r => r.id);
                    io.to(senderId.toString()).emit('messages_seen', {
                        messageIds,
                        recipientId: socket.userId
                    });
                }
            } catch (err) {
                console.error('Error marking messages as seen:', err);
            }
        });

        socket.on('disconnect', () => {
            if (teamParticipants.has(socket.userId)) {
                teamParticipants.delete(socket.userId);
                app.set('team_participants', teamParticipants);
                socket.broadcast.emit('user_left_team_call', { userId: socket.userId });
                if (teamParticipants.size === 0) {
                    setTimeout(() => {
                        const currentParticipants = app.get('team_participants');
                        if (!currentParticipants || currentParticipants.size === 0) {
                            app.set('active_team_call', null);
                            io.emit('team_call_ended');
                        }
                    }, 15000);
                }
            }
        });
    });

    return io;
};

module.exports = { setupSocket, attachSocketHandlers };
