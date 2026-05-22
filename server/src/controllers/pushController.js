const {
    ensureConfigured,
    getVapidPublicKey,
    normalizePushSubscription,
    upsertPushSubscription,
    removePushSubscription
} = require('../utils/webPushService');

const getPushPublicKey = (_req, res) => {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
        return res.status(204).end();
    }

    res.json({ publicKey });
};

const subscribePush = async (req, res) => {
    try {
        if (!ensureConfigured()) {
            return res.status(503).json({ error: 'Push notifications are not configured on server' });
        }

        const normalized = normalizePushSubscription(req.body?.subscription);
        if (!normalized) {
            return res.status(400).json({ error: 'Invalid push subscription payload' });
        }

        await upsertPushSubscription({
            userId: req.user.id,
            subscription: normalized,
            userAgent: req.get('user-agent')
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[PushController] Failed to subscribe push notification:', error);
        res.status(500).json({ error: 'Failed to subscribe for push notifications' });
    }
};

const unsubscribePush = async (req, res) => {
    try {
        const endpoint = String(req.body?.endpoint || '').trim();
        if (!endpoint) {
            return res.status(400).json({ error: 'Push endpoint is required' });
        }

        await removePushSubscription({
            userId: req.user.id,
            endpoint
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[PushController] Failed to unsubscribe push notification:', error);
        res.status(500).json({ error: 'Failed to unsubscribe push notifications' });
    }
};

module.exports = {
    getPushPublicKey,
    subscribePush,
    unsubscribePush
};
