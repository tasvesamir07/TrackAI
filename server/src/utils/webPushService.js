const webPush = require('web-push');
const db = require('../db');

let configured = false;
let warnedMissingConfig = false;

const getVapidPublicKey = () => String(process.env.VAPID_PUBLIC_KEY || '').trim();
const getVapidPrivateKey = () => String(process.env.VAPID_PRIVATE_KEY || '').trim();
const getVapidSubject = () => String(process.env.VAPID_SUBJECT || '').trim() || 'mailto:admin@example.com';

const ensureConfigured = () => {
    if (configured) return true;

    const publicKey = getVapidPublicKey();
    const privateKey = getVapidPrivateKey();
    if (!publicKey || !privateKey) {
        if (!warnedMissingConfig) {
            console.warn('[WebPush] VAPID keys are missing. Push notifications are disabled.');
            warnedMissingConfig = true;
        }
        return false;
    }

    try {
        webPush.setVapidDetails(getVapidSubject(), publicKey, privateKey);
        configured = true;
        return true;
    } catch (error) {
        console.error('[WebPush] Failed to configure web-push:', error?.message || error);
        return false;
    }
};

const normalizePushSubscription = (input) => {
    if (!input || typeof input !== 'object') return null;

    const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
    const keys = input.keys && typeof input.keys === 'object' ? input.keys : null;
    const p256dh = keys && typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
    const auth = keys && typeof keys.auth === 'string' ? keys.auth.trim() : '';

    if (!endpoint || !p256dh || !auth) return null;

    return {
        endpoint,
        expirationTime: input.expirationTime ?? null,
        keys: { p256dh, auth }
    };
};

const upsertPushSubscription = async ({ userId, subscription, userAgent }) => {
    await db.query(`
        INSERT INTO push_subscriptions (user_id, endpoint, subscription, user_agent)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (endpoint)
        DO UPDATE SET
            user_id = EXCLUDED.user_id,
            subscription = EXCLUDED.subscription,
            user_agent = EXCLUDED.user_agent,
            updated_at = CURRENT_TIMESTAMP
    `, [userId, subscription.endpoint, JSON.stringify(subscription), userAgent || null]);
};

const removePushSubscription = async ({ userId, endpoint }) => {
    await db.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [userId, endpoint]
    );
};

const sendPushToUsers = async ({ userIds, payload }) => {
    if (!Array.isArray(userIds) || userIds.length === 0) return;
    if (!ensureConfigured()) return;

    const dedupedUserIds = Array.from(new Set(
        userIds.map((value) => Number.parseInt(value, 10)).filter((value) => Number.isInteger(value))
    ));
    if (dedupedUserIds.length === 0) return;

    const subscriptionsRes = await db.query(
        'SELECT id, endpoint, subscription FROM push_subscriptions WHERE user_id = ANY($1::int[])',
        [dedupedUserIds]
    );

    const body = JSON.stringify(payload || {});
    const jobs = subscriptionsRes.rows.map(async (row) => {
        try {
            const parsedSubscription = typeof row.subscription === 'string'
                ? JSON.parse(row.subscription)
                : row.subscription;
            await webPush.sendNotification(parsedSubscription, body, { TTL: 60 });
            await db.query(
                `UPDATE push_subscriptions
                 SET last_success_at = CURRENT_TIMESTAMP,
                     failure_count = 0
                 WHERE id = $1`,
                [row.id]
            );
        } catch (error) {
            const statusCode = Number(error?.statusCode || error?.status || 0);
            if (statusCode === 404 || statusCode === 410) {
                await db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
                return;
            }

            await db.query(
                `UPDATE push_subscriptions
                 SET last_failure_at = CURRENT_TIMESTAMP,
                     failure_count = failure_count + 1
                 WHERE id = $1`,
                [row.id]
            );
            console.warn('[WebPush] Failed to send notification:', error?.message || error);
        }
    });

    await Promise.allSettled(jobs);
};

const sendChatPushToUsers = async ({
    recipientUserIds,
    senderName,
    messageText,
    conversationId,
    groupName
}) => {
    const trimmed = String(messageText || '').trim();
    const body = trimmed || 'Sent an attachment';
    const normalizedConversationId = conversationId ? String(conversationId) : '';
    const targetUrl = normalizedConversationId
        ? `/?chat=${encodeURIComponent(normalizedConversationId)}`
        : '/';
    const title = groupName
        ? `${senderName || 'New message'} in ${groupName}`
        : `${senderName || 'New message'}`;

    await sendPushToUsers({
        userIds: recipientUserIds,
        payload: {
            type: 'chat_message',
            title,
            body,
            conversationId: normalizedConversationId || null,
            badgeCount: 1,
            url: targetUrl
        }
    });
};

module.exports = {
    ensureConfigured,
    getVapidPublicKey,
    normalizePushSubscription,
    upsertPushSubscription,
    removePushSubscription,
    sendPushToUsers,
    sendChatPushToUsers
};
