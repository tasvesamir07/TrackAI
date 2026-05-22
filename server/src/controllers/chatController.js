const db = require('../db');
const { decrypt, encrypt } = require('../utils/security');
const { isReservedSystemGroupName, ensureAllMembersGroup } = require('../utils/chatGroupService');
const { uploadIncomingFile } = require('../utils/storageService');
const ROLE_VISIBILITY = {
    admin: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    moderator: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    employee: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    COMPANY_ADMIN: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN'],
    SUPERADMIN: ['admin', 'moderator', 'employee', 'COMPANY_ADMIN', 'SUPERADMIN']
};
const ADMIN_LIKE_ROLES = new Set(['admin', 'COMPANY_ADMIN', 'SUPERADMIN']);

const resolveRequesterCompanyId = async (userId, companyIdFromToken, queryClient = db) => {
    if (companyIdFromToken) return companyIdFromToken;
    if (!userId) return null;

    const requesterRes = await queryClient.query(
        'SELECT company_id FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
        [userId]
    );
    return requesterRes.rows[0]?.company_id || null;
};

const canViewUserRole = (viewerRole, targetRole) => {
    const allowed = ROLE_VISIBILITY[viewerRole] || [];
    return allowed.includes(targetRole);
};

const getVisibleRolesForViewer = (viewerRole) => ROLE_VISIBILITY[viewerRole] || ['employee'];

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

const mapMessageRowForViewer = (msg, viewerId, viewerRole) => {
    const username = getVisibleNameForViewer({
        viewerId,
        viewerRole,
        targetId: msg.user_id,
        targetRole: msg.role,
        targetUsername: msg.username,
        targetDepartment: msg.department
    });
    const role = getVisibleRoleLabelForViewer({
        viewerId,
        viewerRole,
        targetId: msg.user_id,
        targetRole: msg.role,
        targetDepartment: msg.department
    });
    const replyUsername = msg.reply_username
        ? getVisibleNameForViewer({
            viewerId,
            viewerRole,
            targetId: msg.reply_user_id,
            targetRole: msg.reply_role,
            targetUsername: msg.reply_username,
            targetDepartment: msg.reply_department
        })
        : null;

    return {
        ...msg,
        username,
        role,
        reply_username: replyUsername,
        content: decrypt(msg.content),
        reply_content: msg.reply_content ? decrypt(msg.reply_content) : null
    };
};

const groupConversationId = (groupId) => `group-${groupId}`;

const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 100;

const parseHistoryLimit = (value) => {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_HISTORY_LIMIT;
    return Math.min(parsed, MAX_HISTORY_LIMIT);
};

const parseHistoryCursor = (beforeCreatedAt, beforeId) => {
    if (!beforeCreatedAt && !beforeId) return null;

    const parsedDate = new Date(String(beforeCreatedAt || ''));
    const parsedId = parseInt(beforeId, 10);

    if (Number.isNaN(parsedDate.getTime()) || !Number.isInteger(parsedId)) {
        return 'invalid';
    }

    return {
        createdAt: parsedDate.toISOString(),
        id: parsedId
    };
};

const isGroupMember = async (groupId, userId) => {
    const membershipRes = await db.query(
        'SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
    );
    return membershipRes.rows.length > 0;
};

const emitToGroupMembers = async (io, groupId, eventName, payload) => {
    const memberRes = await db.query(
        'SELECT user_id FROM chat_group_members WHERE group_id = $1',
        [groupId]
    );

    memberRes.rows.forEach(({ user_id }) => {
        io.to(user_id.toString()).emit(eventName, payload);
    });
};

const getMessages = async (req, res) => {
    try {
        const { contactId, groupId, limit: requestedLimit, beforeCreatedAt, beforeId } = req.query;
        const currentUserId = req.user.id;
        const currentUserRole = req.user.role;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const userIdInt = parseInt(currentUserId, 10);
        const limit = parseHistoryLimit(requestedLimit);
        const pageLimit = limit + 1;
        const cursor = parseHistoryCursor(beforeCreatedAt, beforeId);

        if (cursor === 'invalid') {
            return res.status(400).json({ error: 'Invalid history cursor' });
        }

        let query;
        let params;

        if (groupId) {
            const groupIdInt = parseInt(groupId, 10);
            if (!Number.isInteger(groupIdInt)) {
                return res.status(400).json({ error: 'Invalid groupId' });
            }

            const allowed = await isGroupMember(groupIdInt, userIdInt);
            if (!allowed) {
                return res.status(403).json({ error: 'Not authorized for this group' });
            }

            query = `
                SELECT * FROM (
                    SELECT
                        m.id, m.content, m.created_at, m.user_id, m.recipient_id, m.group_id,
                        g.name AS group_name,
                        m.attachment_url, m.attachment_type, m.attachments, m.is_edited, m.status,
                        m.reply_to_id, m.reactions, m.is_pinned, m.is_forwarded,
                        r.content AS reply_content,
                        r.user_id AS reply_user_id,
                        ru.username AS reply_username,
                        ru.role AS reply_role,
                        ru.department AS reply_department,
                        u.username, u.role, u.department, u.status AS user_status, u.profile_picture
                    FROM messages m
                    JOIN users u ON m.user_id = u.id
                    JOIN chat_groups g ON m.group_id = g.id
                    LEFT JOIN messages r ON m.reply_to_id = r.id
                    LEFT JOIN users ru ON r.user_id = ru.id
                    WHERE m.group_id = $1
                      AND NOT ($2 = ANY(m.deleted_for))
                      AND (
                        ($3::uuid IS NULL AND u.company_id IS NULL)
                        OR u.company_id = $3::uuid
                      )
                      ${cursor ? 'AND (m.created_at, m.id) < ($4::timestamptz, $5::int)' : ''}
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT $${cursor ? 6 : 4}
                ) history
                ORDER BY created_at ASC, id ASC
            `;
            params = cursor
                ? [groupIdInt, userIdInt, requesterCompanyId, cursor.createdAt, cursor.id, pageLimit]
                : [groupIdInt, userIdInt, requesterCompanyId, pageLimit];
        } else if (contactId) {
            const contactIdInt = parseInt(contactId, 10);
            if (!Number.isInteger(contactIdInt)) {
                return res.status(400).json({ error: 'Invalid contactId' });
            }

            if (!ADMIN_LIKE_ROLES.has(currentUserRole)) {
                const contactRes = await db.query(
                    `SELECT role
                     FROM users
                     WHERE id = $1
                       AND (
                            ($2::uuid IS NULL AND company_id IS NULL)
                            OR company_id = $2::uuid
                       )`,
                    [contactIdInt, requesterCompanyId]
                );
                if (contactRes.rows.length === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }

                if (!canViewUserRole(currentUserRole, contactRes.rows[0].role)) {
                    return res.status(403).json({ error: 'Not authorized for this conversation' });
                }
            }

            query = `
                SELECT * FROM (
                    SELECT
                        m.id, m.content, m.created_at, m.user_id, m.recipient_id, m.group_id,
                        m.attachment_url, m.attachment_type, m.attachments, m.is_edited, m.status,
                        m.reply_to_id, m.reactions, m.is_pinned, m.is_forwarded,
                        r.content AS reply_content,
                        r.user_id AS reply_user_id,
                        ru.username AS reply_username,
                        ru.role AS reply_role,
                        ru.department AS reply_department,
                        u.username, u.role, u.department, u.status AS user_status, u.profile_picture
                    FROM messages m
                    JOIN users u ON m.user_id = u.id
                    LEFT JOIN messages r ON m.reply_to_id = r.id
                    LEFT JOIN users ru ON r.user_id = ru.id
                    WHERE ((m.user_id = $1 AND m.recipient_id = $2)
                       OR (m.user_id = $2 AND m.recipient_id = $1))
                      AND m.group_id IS NULL
                      AND NOT ($1 = ANY(m.deleted_for))
                      AND (
                        ($3::uuid IS NULL AND u.company_id IS NULL)
                        OR u.company_id = $3::uuid
                      )
                      ${cursor ? 'AND (m.created_at, m.id) < ($4::timestamptz, $5::int)' : ''}
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT $${cursor ? 6 : 4}
                ) history
                ORDER BY created_at ASC, id ASC
            `;
            params = cursor
                ? [userIdInt, contactIdInt, requesterCompanyId, cursor.createdAt, cursor.id, pageLimit]
                : [userIdInt, contactIdInt, requesterCompanyId, pageLimit];
        } else {
            query = `
                SELECT * FROM (
                    SELECT
                        m.id, m.content, m.created_at, m.user_id, m.recipient_id, m.group_id,
                        m.attachment_url, m.attachment_type, m.attachments, m.is_edited, m.status,
                        m.reply_to_id, m.reactions, m.is_pinned, m.is_forwarded,
                        r.content AS reply_content,
                        r.user_id AS reply_user_id,
                        ru.username AS reply_username,
                        ru.role AS reply_role,
                        ru.department AS reply_department,
                        u.username, u.role, u.department, u.status AS user_status, u.profile_picture
                    FROM messages m
                    JOIN users u ON m.user_id = u.id
                    LEFT JOIN messages r ON m.reply_to_id = r.id
                    LEFT JOIN users ru ON r.user_id = ru.id
                    WHERE m.recipient_id IS NULL
                      AND m.group_id IS NULL
                      AND NOT ($1 = ANY(m.deleted_for))
                      AND (
                        ($2::uuid IS NULL AND u.company_id IS NULL)
                        OR u.company_id = $2::uuid
                      )
                      ${cursor ? 'AND (m.created_at, m.id) < ($3::timestamptz, $4::int)' : ''}
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT $${cursor ? 5 : 3}
                ) history
                ORDER BY created_at ASC, id ASC
            `;
            params = cursor
                ? [userIdInt, requesterCompanyId, cursor.createdAt, cursor.id, pageLimit]
                : [userIdInt, requesterCompanyId, pageLimit];
        }

        const result = await db.query(query, params);
        const visibleRows = result.rows.filter((row) => (
            row.user_id === userIdInt || canViewUserRole(currentUserRole, row.role)
        ));
        const hasMore = visibleRows.length > limit;
        const pageRows = hasMore ? visibleRows.slice(1) : visibleRows;
        const mappedMessages = pageRows.map((row) => mapMessageRowForViewer(row, userIdInt, currentUserRole));
        const nextCursor = hasMore && mappedMessages.length > 0
            ? {
                beforeCreatedAt: mappedMessages[0].created_at,
                beforeId: mappedMessages[0].id
            }
            : null;

        res.json({
            messages: mappedMessages,
            hasMore,
            nextCursor
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getConversations = async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const currentUserRole = req.user.role;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const visibleRoles = getVisibleRolesForViewer(currentUserRole);
        await ensureAllMembersGroup(db, requesterCompanyId);

        const usersRes = await db.query(
            `SELECT id, username, role, status, department, profile_picture
             FROM users
             WHERE id != $1
               AND role = ANY($2::text[])
               AND (
                    ($3::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $3::uuid
               )`,
            [currentUserId, visibleRoles, requesterCompanyId]
        );
        const colleagues = usersRes.rows;

        const lastDmQuery = `
            SELECT DISTINCT ON (
                CASE WHEN user_id = $1 THEN recipient_id ELSE user_id END
            )
            id, content, created_at, user_id, recipient_id,
            CASE WHEN user_id = $1 THEN recipient_id ELSE user_id END AS other_user_id
            FROM messages
            WHERE (user_id = $1 OR recipient_id = $1)
              AND recipient_id IS NOT NULL
              AND group_id IS NULL
            ORDER BY other_user_id, created_at DESC
        `;
        const lastDmsRes = await db.query(lastDmQuery, [currentUserId]);
        const lastDmsMap = {};
        lastDmsRes.rows.forEach((msg) => {
            lastDmsMap[msg.other_user_id] = msg;
        });

        const teamMsgQuery = `
            SELECT m.id, m.content, m.created_at, m.user_id, u.username, u.role, u.department
            FROM messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.recipient_id IS NULL
              AND m.group_id IS NULL
              AND (
                ($1::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $1::uuid
              )
            ORDER BY m.created_at DESC
            LIMIT 1
        `;
        const teamMsgRes = await db.query(teamMsgQuery, [requesterCompanyId]);
        const teamLastMsg = teamMsgRes.rows[0]
            ? (() => {
                const row = teamMsgRes.rows[0];
                return {
                    ...row,
                    username: getVisibleNameForViewer({
                        viewerId: currentUserId,
                        viewerRole: currentUserRole,
                        targetId: row.user_id,
                        targetRole: row.role,
                        targetUsername: row.username,
                        targetDepartment: row.department
                    }),
                    content: decrypt(row.content)
                };
            })()
            : null;

        const groupRes = await db.query(`
            SELECT
                g.id,
                g.name,
                g.created_at,
                g.created_by,
                COUNT(cgm.user_id) FILTER (
                    WHERE (
                        ($2::uuid IS NULL AND cu.company_id IS NULL)
                        OR cu.company_id = $2::uuid
                    )
                )::int AS member_count
            FROM chat_groups g
            JOIN chat_group_members gm ON gm.group_id = g.id
            LEFT JOIN chat_group_members cgm ON cgm.group_id = g.id
            LEFT JOIN users cu ON cu.id = cgm.user_id
            WHERE gm.user_id = $1
              AND (
                    ($2::uuid IS NULL AND g.company_id IS NULL)
                    OR g.company_id = $2::uuid
              )
            GROUP BY g.id, g.name, g.created_at, g.created_by
            ORDER BY g.created_at DESC
        `, [currentUserId, requesterCompanyId]);

        const groupIds = groupRes.rows.map((group) => group.id);
        const groupLastMessagesMap = {};

        if (groupIds.length > 0) {
            const groupMessagesRes = await db.query(`
                SELECT DISTINCT ON (m.group_id)
                    m.group_id,
                    m.content,
                    m.created_at,
                    m.user_id,
                    u.username,
                    u.role,
                    u.department
                FROM messages m
                JOIN users u ON u.id = m.user_id
                WHERE m.group_id = ANY($1)
                  AND (
                    ($2::uuid IS NULL AND u.company_id IS NULL)
                    OR u.company_id = $2::uuid
                  )
                ORDER BY m.group_id, m.created_at DESC
            `, [groupIds, requesterCompanyId]);

            groupMessagesRes.rows.forEach((msg) => {
                if (!canViewUserRole(currentUserRole, msg.role)) return;
                groupLastMessagesMap[msg.group_id] = {
                    ...msg,
                    username: getVisibleNameForViewer({
                        viewerId: currentUserId,
                        viewerRole: currentUserRole,
                        targetId: msg.user_id,
                        targetRole: msg.role,
                        targetUsername: msg.username,
                        targetDepartment: msg.department
                    }),
                    content: decrypt(msg.content)
                };
            });
        }

        const conversations = colleagues.map((u) => {
            const lastMsg = lastDmsMap[u.id];
            return {
                id: u.id,
                type: 'direct',
                username: getVisibleNameForViewer({
                    viewerId: currentUserId,
                    viewerRole: currentUserRole,
                    targetId: u.id,
                    targetRole: u.role,
                    targetUsername: u.username,
                    targetDepartment: u.department
                }),
                role: getVisibleRoleLabelForViewer({
                    viewerId: currentUserId,
                    viewerRole: currentUserRole,
                    targetId: u.id,
                    targetRole: u.role,
                    targetDepartment: u.department
                }),
                status: u.status,
                lastMessage: lastMsg ? decrypt(lastMsg.content) : null,
                lastMessageTime: lastMsg ? lastMsg.created_at : null,
                department: u.department,
                profile_picture: u.profile_picture
            };
        });

        const groups = groupRes.rows.map((group) => {
            const lastMsg = groupLastMessagesMap[group.id];
            return {
                id: groupConversationId(group.id),
                rawGroupId: group.id,
                type: 'group',
                username: group.name,
                role: 'Group',
                status: null,
                lastMessage: lastMsg ? `${lastMsg.username}: ${lastMsg.content}` : null,
                lastMessageTime: lastMsg ? lastMsg.created_at : null,
                memberCount: group.member_count
            };
        });

        res.json({ groups, direct: conversations });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const createGroup = async (req, res) => {
    const client = await db.getClient();

    try {
        const { name, memberIds } = req.body;
        const creatorId = req.user.id;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id, client);
        const groupName = String(name || '').trim();

        if (!groupName) {
            return res.status(400).json({ error: 'Group name is required' });
        }
        if (isReservedSystemGroupName(groupName)) {
            return res.status(400).json({ error: 'This group name is reserved by the system' });
        }

        if (!Array.isArray(memberIds) || memberIds.length === 0) {
            return res.status(400).json({ error: 'Select at least one member' });
        }

        const uniqueMemberIds = Array.from(
            new Set(
                memberIds
                    .map((id) => parseInt(id, 10))
                    .filter((id) => Number.isInteger(id) && id !== creatorId)
            )
        );

        if (uniqueMemberIds.length === 0) {
            return res.status(400).json({ error: 'Select at least one valid member' });
        }

        const selectedUsersRes = await db.query(
            `SELECT id, role
             FROM users
             WHERE id = ANY($1::int[])
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )`,
            [uniqueMemberIds, requesterCompanyId]
        );

        if (selectedUsersRes.rows.length !== uniqueMemberIds.length) {
            return res.status(400).json({ error: 'One or more selected members are invalid' });
        }

        if (!ADMIN_LIKE_ROLES.has(req.user.role)) {
            const blockedMember = selectedUsersRes.rows.find((row) => !canViewUserRole(req.user.role, row.role));
            if (blockedMember) {
                return res.status(403).json({ error: 'You cannot add higher-tier users to this group' });
            }
        }

        await client.query('BEGIN');

        const groupInsertRes = await client.query(
            'INSERT INTO chat_groups (name, created_by, company_id) VALUES ($1, $2, $3::uuid) RETURNING id, name, created_at',
            [groupName, creatorId, requesterCompanyId]
        );
        const group = groupInsertRes.rows[0];

        const finalMemberIds = [creatorId, ...uniqueMemberIds];
        for (const userId of finalMemberIds) {
            await client.query(
                'INSERT INTO chat_group_members (group_id, user_id) VALUES ($1, $2)',
                [group.id, userId]
            );
        }

        await client.query('COMMIT');

        const conversation = {
            id: groupConversationId(group.id),
            rawGroupId: group.id,
            type: 'group',
            username: group.name,
            role: 'Group',
            status: null,
            lastMessage: null,
            lastMessageTime: null,
            memberCount: finalMemberIds.length
        };

        const io = req.app.get('io');
        finalMemberIds.forEach((userId) => {
            io.to(userId.toString()).emit('chat_group_created', conversation);
        });

        res.status(201).json({ group: conversation });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to create group' });
    } finally {
        client.release();
    }
};

const uploadAttachment = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const uploadedFile = await uploadIncomingFile(req.file, { folder: 'chat' });
        res.json({ url: uploadedFile.url, type: uploadedFile.type });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const deleteMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;
        const userId = req.user.id;
        const io = req.app.get('io');

        const msgRes = await db.query(
            'SELECT user_id, recipient_id, group_id, attachment_url FROM messages WHERE id = $1',
            [id]
        );
        if (msgRes.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const msg = msgRes.rows[0];

        if (type === 'everyone') {
            if (msg.user_id !== userId && !ADMIN_LIKE_ROLES.has(req.user.role)) {
                return res.status(403).json({ error: 'Not authorized' });
            }
        } else {
            let isParticipant =
                msg.user_id === userId ||
                msg.recipient_id === userId ||
                (msg.recipient_id === null && msg.group_id === null);

            if (msg.group_id) {
                isParticipant = await isGroupMember(msg.group_id, userId);
            }

            if (!isParticipant && !ADMIN_LIKE_ROLES.has(req.user.role)) {
                return res.status(403).json({ error: 'Not authorized' });
            }
        }

        if (type === 'everyone') {
            if (msg.attachment_url) {
                const { deleteFile } = require('../utils/fileUtils');
                deleteFile(msg.attachment_url);
            }
            await db.query('DELETE FROM messages WHERE id = $1', [id]);

            const eventData = { id: parseInt(id, 10), type: 'everyone' };
            if (msg.group_id) {
                await emitToGroupMembers(io, msg.group_id, 'message_deleted', eventData);
            } else if (msg.recipient_id) {
                io.to(msg.user_id.toString()).emit('message_deleted', eventData);
                io.to(msg.recipient_id.toString()).emit('message_deleted', eventData);
            } else {
                io.emit('message_deleted', eventData);
            }
        } else {
            await db.query(
                'UPDATE messages SET deleted_for = array_append(deleted_for, $1) WHERE id = $2 AND NOT ($1 = ANY(deleted_for))',
                [userId, id]
            );

            io.to(userId.toString()).emit('message_deleted', { id: parseInt(id, 10), type: 'me' });
        }

        res.json({ success: true, id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const editMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const userId = req.user.id;
        const io = req.app.get('io');

        const msgRes = await db.query(
            'SELECT user_id, recipient_id, group_id FROM messages WHERE id = $1',
            [id]
        );
        if (msgRes.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const msg = msgRes.rows[0];
        if (msg.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const encryptedContent = encrypt(content);
        await db.query(
            'UPDATE messages SET content = $1, is_edited = TRUE, updated_at = NOW() WHERE id = $2',
            [encryptedContent, id]
        );

        const eventData = { id: parseInt(id, 10), content, is_edited: true };
        if (msg.group_id) {
            await emitToGroupMembers(io, msg.group_id, 'message_updated', eventData);
        } else if (msg.recipient_id) {
            io.to(msg.user_id.toString()).emit('message_updated', eventData);
            io.to(msg.recipient_id.toString()).emit('message_updated', eventData);
        } else {
            io.emit('message_updated', eventData);
        }

        res.json({ success: true, id, content });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const addReaction = async (req, res) => {
    try {
        const { id } = req.params;
        const { emoji } = req.body;
        const userId = req.user.id;
        const io = req.app.get('io');

        const msgRes = await db.query('SELECT * FROM messages WHERE id = $1', [id]);
        if (msgRes.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }
        const msg = msgRes.rows[0];

        let reactions = msg.reactions || {};
        const userIdNum = parseInt(userId, 10);
        const originalReactions = msg.reactions || {};
        const wasInThisEmoji = originalReactions[emoji]?.some((u) => parseInt(u, 10) === userIdNum);

        for (const existingEmoji of Object.keys(reactions)) {
            reactions[existingEmoji] = reactions[existingEmoji].filter((u) => parseInt(u, 10) !== userIdNum);
            if (reactions[existingEmoji].length === 0) {
                delete reactions[existingEmoji];
            }
        }

        if (!wasInThisEmoji) {
            if (!reactions[emoji]) reactions[emoji] = [];
            reactions[emoji].push(userIdNum);
        }

        await db.query('UPDATE messages SET reactions = $1 WHERE id = $2', [JSON.stringify(reactions), id]);

        const eventData = { id: parseInt(id, 10), reactions };
        if (msg.group_id) {
            await emitToGroupMembers(io, msg.group_id, 'message_reaction', eventData);
        } else if (msg.recipient_id) {
            io.to(msg.user_id.toString()).emit('message_reaction', eventData);
            io.to(msg.recipient_id.toString()).emit('message_reaction', eventData);
        } else {
            io.emit('message_reaction', eventData);
        }

        res.json({ success: true, reactions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const togglePin = async (req, res) => {
    try {
        const { id } = req.params;
        const io = req.app.get('io');

        const msgRes = await db.query(
            'SELECT is_pinned, user_id, recipient_id, group_id FROM messages WHERE id = $1',
            [id]
        );
        if (msgRes.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const msg = msgRes.rows[0];
        const newPinnedState = !msg.is_pinned;
        await db.query('UPDATE messages SET is_pinned = $1 WHERE id = $2', [newPinnedState, id]);

        const eventData = { id: parseInt(id, 10), is_pinned: newPinnedState };
        if (msg.group_id) {
            await emitToGroupMembers(io, msg.group_id, 'message_pinned', eventData);
        } else if (msg.recipient_id) {
            io.to(msg.user_id.toString()).emit('message_pinned', eventData);
            io.to(msg.recipient_id.toString()).emit('message_pinned', eventData);
        } else {
            io.emit('message_pinned', eventData);
        }

        res.json({ success: true, is_pinned: newPinnedState });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getGroupMembers = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;
        const requesterCompanyId = await resolveRequesterCompanyId(req.user?.id, req.user?.company_id);
        const groupIdInt = parseInt(id, 10);
        const visibleRoles = getVisibleRolesForViewer(userRole);

        if (!Number.isInteger(groupIdInt)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        const allowed = await isGroupMember(groupIdInt, userId);
        if (!allowed && !ADMIN_LIKE_ROLES.has(req.user.role)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const membersRes = await db.query(`
            SELECT u.id, u.username, u.role, u.status, u.profile_picture, u.department
            FROM users u
            JOIN chat_group_members gm ON u.id = gm.user_id
            WHERE gm.group_id = $1
              AND u.role = ANY($2::text[])
              AND (
                ($3::uuid IS NULL AND u.company_id IS NULL)
                OR u.company_id = $3::uuid
              )
            ORDER BY u.username ASC
        `, [groupIdInt, visibleRoles, requesterCompanyId]);

        const maskedMembers = membersRes.rows.map((member) => ({
            ...member,
            username: getVisibleNameForViewer({
                viewerId: userId,
                viewerRole: userRole,
                targetId: member.id,
                targetRole: member.role,
                targetUsername: member.username,
                targetDepartment: member.department
            }),
            role: getVisibleRoleLabelForViewer({
                viewerId: userId,
                viewerRole: userRole,
                targetId: member.id,
                targetRole: member.role,
                targetDepartment: member.department
            })
        }));

        res.json(maskedMembers);
    } catch (err) {
        console.error('Failed to get group members', err);
        res.status(500).json({ error: 'Server error' });
    }
};

const clearConversation = async (req, res) => {
    try {
        const { id } = req.params; // contactId or groupId
        const userId = req.user.id;
        const io = req.app.get('io');

        let query;
        let params;

        if (id.startsWith('group-')) {
            const groupId = parseInt(id.replace('group-', ''), 10);
            query = `
                UPDATE messages 
                SET deleted_for = array_append(deleted_for, $1) 
                WHERE group_id = $2 AND NOT ($1 = ANY(deleted_for))
            `;
            params = [userId, groupId];
        } else if (id === 'team') {
            query = `
                UPDATE messages 
                SET deleted_for = array_append(deleted_for, $1) 
                WHERE recipient_id IS NULL AND group_id IS NULL AND NOT ($1 = ANY(deleted_for))
            `;
            params = [userId];
        } else {
            const contactId = parseInt(id, 10);
            query = `
                UPDATE messages 
                SET deleted_for = array_append(deleted_for, $1) 
                WHERE ((user_id = $1 AND recipient_id = $2) OR (user_id = $2 AND recipient_id = $1))
                  AND group_id IS NULL
                  AND NOT ($1 = ANY(deleted_for))
            `;
            params = [userId, contactId];
        }

        await db.query(query, params);
        
        // Notify the user via socket to clear their local messages
        io.to(userId.toString()).emit('conversation_cleared', { conversationId: id });

        res.json({ success: true, conversationId: id });
    } catch (err) {
        console.error('Failed to clear conversation', err);
        res.status(500).json({ error: 'Server error' });
    }
};

const leaveGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const groupIdInt = parseInt(id, 10);

        if (!Number.isInteger(groupIdInt)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        const groupRes = await db.query(
            `SELECT id, name
             FROM chat_groups
             WHERE id = $1
               AND (
                    ($2::uuid IS NULL AND company_id IS NULL)
                    OR company_id = $2::uuid
               )`,
            [groupIdInt, await resolveRequesterCompanyId(req.user?.id, req.user?.company_id)]
        );

        if (groupRes.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const group = groupRes.rows[0];
        if (isReservedSystemGroupName(group.name)) {
            return res.status(400).json({ error: 'You cannot leave this system group' });
        }

        const membershipRes = await db.query(
            'SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2',
            [groupIdInt, userId]
        );

        if (membershipRes.rows.length === 0) {
            return res.status(404).json({ error: 'You are not a member of this group' });
        }

        await db.query(
            'DELETE FROM chat_group_members WHERE group_id = $1 AND user_id = $2',
            [groupIdInt, userId]
        );

        const remainingMembersRes = await db.query(
            'SELECT COUNT(*)::int AS count FROM chat_group_members WHERE group_id = $1',
            [groupIdInt]
        );

        if ((remainingMembersRes.rows[0]?.count || 0) === 0) {
            await db.query('DELETE FROM chat_groups WHERE id = $1', [groupIdInt]);
        }

        const io = req.app.get('io');
        io.to(userId.toString()).emit('chat_group_left', {
            group_id: groupIdInt,
            conversation_id: groupConversationId(groupIdInt)
        });

        res.json({ success: true, groupId: groupIdInt });
    } catch (err) {
        console.error('Failed to leave group', err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getMessages,
    getConversations,
    createGroup,
    uploadAttachment,
    deleteMessage,
    editMessage,
    addReaction,
    togglePin,
    getGroupMembers,
    clearConversation,
    leaveGroup
};
