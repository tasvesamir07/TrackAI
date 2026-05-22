const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const getNylasConfig = () => ({
    apiKey: String(process.env.NYLAS_API_KEY || '').trim(),
    apiUri: normalizeUrl(process.env.NYLAS_API_URI || 'https://api.us.nylas.com'),
    clientId: String(process.env.NYLAS_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.NYLAS_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.NYLAS_REDIRECT_URI || '').trim(),
    webhookSecret: String(process.env.NYLAS_WEBHOOK_SECRET || '').trim()
});

const getFrontendBaseUrl = () => {
    const explicit = normalizeUrl(process.env.FRONTEND_URL || process.env.APP_URL || '');
    if (explicit) return explicit;

    const corsOrigins = String(process.env.CORS_ORIGIN || '')
        .split(',')
        .map((origin) => normalizeUrl(origin))
        .filter((origin) => /^https?:\/\//i.test(origin));
    if (corsOrigins.length > 0) return corsOrigins[0];

    return '';
};

const getCallbackTarget = (status, message) => {
    const base = getFrontendBaseUrl();
    if (!base) return null;
    const target = new URL(`${base}/profile`);
    target.searchParams.set('nylas_status', status);
    if (message) target.searchParams.set('nylas_message', message);
    return target.toString();
};

const signOauthState = ({ userId, companyId = null }) => {
    const payload = {
        purpose: 'nylas_connect',
        nonce: crypto.randomUUID(),
        userId,
        companyId,
        ts: Date.now()
    };
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '10m' });
};

const verifyOauthState = (state) => {
    const decoded = jwt.verify(String(state || ''), process.env.JWT_SECRET);
    if (decoded?.purpose !== 'nylas_connect' || !decoded?.userId) {
        throw new Error('Invalid OAuth state');
    }
    return decoded;
};

const ensureConnectConfig = () => {
    const config = getNylasConfig();
    const missing = [];
    if (!config.apiKey) missing.push('NYLAS_API_KEY');
    if (!config.clientId) missing.push('NYLAS_CLIENT_ID');
    if (!config.redirectUri) missing.push('NYLAS_REDIRECT_URI');
    if (missing.length > 0) {
        const error = new Error(`Missing Nylas config: ${missing.join(', ')}`);
        error.statusCode = 500;
        throw error;
    }
    return config;
};

const resolveProvider = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const allowed = new Set(['google', 'microsoft', 'imap', 'yahoo', 'icloud', 'exchange']);
    return allowed.has(raw) ? raw : '';
};

const startOauth = async (req, res) => {
    try {
        const config = ensureConnectConfig();
        const provider = resolveProvider(req.query?.provider);
        const loginHint = String(req.query?.email || req.query?.login_hint || req.user?.email || '').trim();
        const state = signOauthState({ userId: req.user.id, companyId: req.user.company_id || null });

        const authUrl = new URL(`${config.apiUri}/v3/connect/auth`);
        authUrl.searchParams.set('client_id', config.clientId);
        authUrl.searchParams.set('redirect_uri', config.redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('state', state);
        if (provider) authUrl.searchParams.set('provider', provider);
        if (loginHint) authUrl.searchParams.set('login_hint', loginHint);

        return res.json({ authUrl: authUrl.toString(), state });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.message || 'Failed to start Nylas OAuth' });
    }
};

const exchangeCodeForGrant = async ({ code, config }) => {
    const requestBody = {
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code: String(code || '').trim()
    };
    if (config.clientSecret) {
        requestBody.client_secret = config.clientSecret;
    }

    const response = await fetch(`${config.apiUri}/v3/connect/token`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    const raw = await response.text();
    let parsed = null;
    try {
        parsed = raw ? JSON.parse(raw) : null;
    } catch (_) {
        parsed = null;
    }

    if (!response.ok) {
        const message = parsed?.error?.message || parsed?.message || raw || `Token exchange failed (${response.status})`;
        const error = new Error(message);
        error.statusCode = response.status;
        throw error;
    }

    return parsed?.data || parsed || {};
};

const getGrantDetails = async ({ grantId, config }) => {
    const response = await fetch(`${config.apiUri}/v3/grants/${encodeURIComponent(grantId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            Accept: 'application/json'
        }
    });

    const raw = await response.text();
    let parsed = null;
    try {
        parsed = raw ? JSON.parse(raw) : null;
    } catch (_) {
        parsed = null;
    }

    if (!response.ok) {
        const message = parsed?.error?.message || parsed?.message || raw || `Grant lookup failed (${response.status})`;
        const error = new Error(message);
        error.statusCode = response.status;
        throw error;
    }

    return parsed?.data || parsed || {};
};

const callbackOauth = async (req, res) => {
    const redirectSuccess = (message = 'connected') => {
        const target = getCallbackTarget('success', message);
        if (target) return res.redirect(target);
        return res.status(200).send('Nylas account connected successfully.');
    };
    const redirectError = (message) => {
        const target = getCallbackTarget('error', message);
        if (target) return res.redirect(target);
        return res.status(400).send(message || 'Nylas OAuth failed.');
    };

    try {
        const config = ensureConnectConfig();
        const code = String(req.query?.code || '').trim();
        const state = String(req.query?.state || '').trim();
        const oauthError = String(req.query?.error || '').trim();
        const oauthErrorDescription = String(req.query?.error_description || '').trim();

        if (oauthError) {
            return redirectError(oauthErrorDescription || oauthError);
        }
        if (!code || !state) {
            return redirectError('Missing OAuth code/state');
        }

        const decodedState = verifyOauthState(state);
        const tokenData = await exchangeCodeForGrant({ code, config });
        const grantId = String(tokenData?.grant_id || tokenData?.grantId || '').trim();
        if (!grantId) {
            return redirectError('Missing grant id from Nylas token exchange');
        }

        let grant = {};
        try {
            grant = await getGrantDetails({ grantId, config });
        } catch (grantErr) {
            console.warn('[Nylas] Connected but failed to fetch grant details:', grantErr.message);
        }

        const connectedEmail = String(grant?.email || tokenData?.email || '').trim().toLowerCase();
        const provider = String(grant?.provider || tokenData?.provider || '').trim().toLowerCase();
        const grantStatus = String(grant?.grant_status || tokenData?.grant_status || 'valid').trim().toLowerCase();

        await db.query(
            `UPDATE users
             SET nylas_grant_id = $1,
                 nylas_provider = $2,
                 nylas_connected_email = $3,
                 nylas_grant_status = $4,
                 nylas_connected_at = NOW(),
                 nylas_last_error = NULL
             WHERE id = $5`,
            [grantId, provider || null, connectedEmail || null, grantStatus || 'valid', decodedState.userId]
        );

        return redirectSuccess('mailbox_connected');
    } catch (error) {
        console.error('[Nylas] OAuth callback failed:', error);
        return redirectError(error.message || 'Nylas OAuth callback failed');
    }
};

const getConnectionStatus = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT nylas_grant_id, nylas_provider, nylas_connected_email, nylas_grant_status, nylas_connected_at, nylas_last_error
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const row = result.rows[0];
        return res.json({
            connected: Boolean(row.nylas_grant_id),
            grantId: row.nylas_grant_id || null,
            provider: row.nylas_provider || null,
            email: row.nylas_connected_email || null,
            grantStatus: row.nylas_grant_status || null,
            connectedAt: row.nylas_connected_at || null,
            lastError: row.nylas_last_error || null
        });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to fetch Nylas connection status' });
    }
};

const disconnectMailbox = async (req, res) => {
    try {
        const config = ensureConnectConfig();

        const result = await db.query(
            'SELECT nylas_grant_id FROM users WHERE deleted_at IS NULL AND id = $1 LIMIT 1',
            [req.user.id]
        );
        const grantId = String(result.rows[0]?.nylas_grant_id || '').trim();

        if (grantId) {
            await fetch(`${config.apiUri}/v3/grants/${encodeURIComponent(grantId)}`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    Accept: 'application/json'
                }
            }).catch(() => null);
        }

        await db.query(
            `UPDATE users
             SET nylas_grant_id = NULL,
                 nylas_provider = NULL,
                 nylas_connected_email = NULL,
                 nylas_grant_status = NULL,
                 nylas_connected_at = NULL,
                 nylas_last_error = NULL
             WHERE id = $1`,
            [req.user.id]
        );

        return res.json({ success: true, message: 'Mailbox disconnected' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.message || 'Failed to disconnect mailbox' });
    }
};

const nylasWebhook = async (req, res) => {
    // Keep webhook endpoint available so dashboard checks and retries don't fail.
    // You can add strict signature verification here once event handling is required.
    return res.status(200).json({ received: true });
};

module.exports = {
    startOauth,
    callbackOauth,
    getConnectionStatus,
    disconnectMailbox,
    nylasWebhook
};
