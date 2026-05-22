const { StreamChat } = require('stream-chat');

let streamClient = null;

const getStreamConfig = () => {
    const apiKey = String(process.env.STREAM_API_KEY || '').trim();
    const apiSecret = String(process.env.STREAM_API_SECRET || '').trim();
    return { apiKey, apiSecret };
};

const isStreamConfigured = () => {
    const { apiKey, apiSecret } = getStreamConfig();
    return Boolean(apiKey && apiSecret);
};

const getStreamServerClient = () => {
    const { apiKey, apiSecret } = getStreamConfig();
    if (!apiKey || !apiSecret) {
        throw new Error('Stream is not configured. Set STREAM_API_KEY and STREAM_API_SECRET.');
    }

    if (!streamClient) {
        streamClient = StreamChat.getInstance(apiKey, apiSecret);
    }

    return streamClient;
};

const toStreamUserId = (appUserId) => `app-${String(appUserId)}`;

const toStreamUser = (row) => ({
    id: toStreamUserId(row.id),
    name: row.full_name || row.username || `User ${row.id}`,
    image: row.profile_picture || undefined,
    role: row.role || undefined,
    app_user_id: row.id,
    company_id: row.company_id || undefined,
});

module.exports = {
    getStreamConfig,
    getStreamServerClient,
    isStreamConfigured,
    toStreamUserId,
    toStreamUser,
};

