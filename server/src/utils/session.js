const session = require('express-session');
const connectRedis = require('connect-redis');
const Redis = require('ioredis');

const RedisStore =
  connectRedis?.default ||
  connectRedis?.RedisStore ||
  connectRedis;

// Create Redis client
const createRedisClient = () => {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  const allowLocalRedis = ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_LOCAL_REDIS || '').toLowerCase());

  if (!redisUrl) {
    console.warn('[Session] REDIS_URL not configured - using memory store');
    return null;
  }

  if (!/^rediss?:\/\//i.test(redisUrl)) {
    console.warn('[Session] REDIS_URL is invalid (must start with redis:// or rediss://). Using memory store.');
    return null;
  }

  const isLocalhost = /127\.0\.0\.1:6379|localhost:6379/i.test(redisUrl);

  if (process.env.NODE_ENV === 'production' && isLocalhost) {
    console.error('[Session] REDIS_URL points to localhost in production. This is not allowed.');
    return null;
  }

  if (!allowLocalRedis && isLocalhost) {
    console.warn('[Session] REDIS_URL points to localhost:6379. Ignoring it and using memory store.');
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 10000,
    });

    client.on('error', (err) => {
      console.error('[Session] Redis connection error:', err.message);
    });

    client.on('connect', () => {
      console.log('[Session] Redis connected successfully');
    });

    return client;
  } catch (err) {
    console.error('[Session] Failed to create Redis client:', err.message);
    return null;
  }
};

// Session configuration
const getSessionConfig = (redisClient) => {
  const sessionConfig = {
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'default-secret-change-me-in-production',
    name: 'trackai.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax',
    },
  };

  // Use Redis store if client available
  if (redisClient) {
    if (typeof RedisStore === 'function') {
      sessionConfig.store = new RedisStore({
        client: redisClient,
        prefix: 'trackai:session:',
      });
      console.log('[Session] Using Redis session store');
    } else {
      console.error('[Session] connect-redis export is invalid. Falling back to in-memory session store.');
    }
  } else {
    console.warn('[Session] Using in-memory session store (not suitable for production)');
  }

  return sessionConfig;
};

module.exports = {
  createRedisClient,
  getSessionConfig,
};
