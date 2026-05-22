const db = require('../db');
const {
    getStreamConfig,
    getStreamServerClient,
    isStreamConfigured,
    toStreamUserId,
    toStreamUser,
} = require('../utils/streamService');

const getStreamSession = async (req, res) => {
    if (!isStreamConfigured()) {
        return res.status(503).json({ error: 'Stream is not configured on server.' });
    }

    try {
        const result = await db.query(
            `SELECT id, username, full_name, role, profile_picture, company_id
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [req.user.id]
        );
        const userRow = result.rows[0];
        if (!userRow) {
            return res.status(404).json({ error: 'User not found' });
        }

        const streamClient = getStreamServerClient();
        const streamUser = toStreamUser(userRow);
        await streamClient.upsertUsers({ [streamUser.id]: streamUser });

        const token = streamClient.createToken(streamUser.id);
        const { apiKey } = getStreamConfig();

        return res.json({
            apiKey,
            token,
            user: streamUser,
        });
    } catch (error) {
        console.error('Get Stream session failed:', error);
        return res.status(500).json({ error: 'Failed to create Stream session' });
    }
};

const createDirectChannel = async (req, res) => {
    if (!isStreamConfigured()) {
        return res.status(503).json({ error: 'Stream is not configured on server.' });
    }

    const targetUserId = Number.parseInt(String(req.body?.targetUserId || ''), 10);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'Valid targetUserId is required' });
    }
    if (targetUserId === req.user.id) {
        return res.status(400).json({ error: 'Cannot create direct channel with yourself' });
    }

    try {
        const usersResult = await db.query(
            `SELECT id, username, full_name, role, profile_picture, company_id
             FROM users
             WHERE id = ANY($1::int[])`,
            [[req.user.id, targetUserId]]
        );

        if (usersResult.rows.length !== 2) {
            return res.status(404).json({ error: 'User not found' });
        }

        const sourceUser = usersResult.rows.find((row) => Number(row.id) === Number(req.user.id));
        const targetUser = usersResult.rows.find((row) => Number(row.id) === Number(targetUserId));
        if (!sourceUser || !targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const isSuperadmin = String(req.user.role || '').toUpperCase() === 'SUPERADMIN';
        if (!isSuperadmin && String(sourceUser.company_id || '') !== String(targetUser.company_id || '')) {
            return res.status(403).json({ error: 'Cannot create channel across companies' });
        }

        const streamClient = getStreamServerClient();
        const streamSource = toStreamUser(sourceUser);
        const streamTarget = toStreamUser(targetUser);

        await streamClient.upsertUsers({
            [streamSource.id]: streamSource,
            [streamTarget.id]: streamTarget,
        });

        const memberIds = [toStreamUserId(sourceUser.id), toStreamUserId(targetUser.id)].sort();
        const channelId = `dm-${memberIds[0]}-${memberIds[1]}`.replace(/[^a-zA-Z0-9!_-]/g, '_');
        const channel = streamClient.channel('messaging', channelId, {
            members: memberIds,
            created_by_id: toStreamUserId(sourceUser.id),
        });

        await channel.create();
        return res.json({
            channelId,
            memberIds,
        });
    } catch (error) {
        if (String(error?.message || '').toLowerCase().includes('already exists')) {
            const memberIds = [toStreamUserId(req.user.id), toStreamUserId(targetUserId)].sort();
            const channelId = `dm-${memberIds[0]}-${memberIds[1]}`.replace(/[^a-zA-Z0-9!_-]/g, '_');
            return res.json({ channelId, memberIds });
        }

        console.error('Create Stream direct channel failed:', error);
        return res.status(500).json({ error: 'Failed to create direct channel' });
    }
};

module.exports = {
    getStreamSession,
    createDirectChannel,
};

