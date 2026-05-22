const { Queue } = require('bullmq');
const Redis = require('ioredis');

const redisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
};

const redisUrl = String(process.env.REDIS_URL || '').trim();
const hasRedisUrl = Boolean(redisUrl);
const hasValidRedisScheme = /^rediss?:\/\//i.test(redisUrl);

let connection = null;
let inactivityQueue = null;
let leaveBalanceQueue = null;
let isRedisEnabled = false;

if (hasRedisUrl && hasValidRedisScheme) {
    try {
        connection = new Redis(redisUrl, redisOptions);
        connection.on('error', (err) => {
            console.error('[Scheduler] Redis connection error:', err.message || err);
        });

        inactivityQueue = new Queue('inactivityTermination', { connection });
        leaveBalanceQueue = new Queue('leaveBalanceReset', { connection });
        isRedisEnabled = true;
    } catch (err) {
        console.error('[Scheduler] Failed to initialize Redis queues. Queues disabled:', err.message || err);
    }
} else if (hasRedisUrl && !hasValidRedisScheme) {
    console.error('[Scheduler] REDIS_URL is set but invalid. Expected redis:// or rediss://. Queues disabled.');
} else {
    console.warn('[Scheduler] REDIS_URL is not configured. BullMQ queues are disabled.');
}

module.exports = {
    isRedisEnabled,
    inactivityQueue,
    leaveBalanceQueue,
    connection
};
