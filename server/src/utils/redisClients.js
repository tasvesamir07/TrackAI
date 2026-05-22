const Redis = require('ioredis');

let pubClient = null;
let subClient = null;

const createPubClient = async () => {
    if (pubClient) return pubClient;

    pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    pubClient.on('error', (err) => {
        console.error('[Redis] Pub client error:', err);
    });

    return pubClient;
};

const createSubClient = async () => {
    if (subClient) return subClient;

    subClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    subClient.on('error', (err) => {
        console.error('[Redis] Sub client error:', err);
    });

    return subClient;
};

module.exports = {
    createPubClient,
    createSubClient,
    getPubClient: () => pubClient,
    getSubClient: () => subClient
};
