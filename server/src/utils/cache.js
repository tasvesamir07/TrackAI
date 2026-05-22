/**
 * Redis Cache Service
 * Provides caching for frequently accessed data
 */

const Redis = require('ioredis');

let redis = null;

// Initialize Redis connection
function initRedis() {
  if (redis) return redis;
  
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 10000,
    });
    
    redis.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
    
    redis.on('connect', () => {
      console.log('Redis connected successfully');
    });
  }
  
  return redis;
}

// Get Redis client (or null if not configured)
function getRedis() {
  if (!redis) {
    initRedis();
  }
  return redis;
}

// Cache wrapper with fallback to in-memory
const cache = {
  async get(key) {
    try {
      const client = getRedis();
      if (!client) return null;
      
      const data = await client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error.message);
      return null;
    }
  },

  async set(key, value, ttlSeconds = 300) {
    try {
      const client = getRedis();
      if (!client) return false;
      
      await client.setex(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Cache set error:', error.message);
      return false;
    }
  },

  async invalidate(pattern) {
    try {
      const client = getRedis();
      if (!client) return false;
      
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
      }
      return true;
    } catch (error) {
      console.error('Cache invalidate error:', error.message);
      return false;
    }
  },

  async invalidatePrefix(prefix) {
    return this.invalidate(`${prefix}*`);
  }
};

// Middleware for caching API responses
function cacheMiddleware(keyGenerator, ttlSeconds = 60) {
  return async (req, res, next) => {
    const key = keyGenerator(req);
    const cachedData = await cache.get(key);
    
    if (cachedData) {
      return res.json(cachedData);
    }
    
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode === 200) {
        cache.set(key, data, ttlSeconds).catch(console.error);
      }
      return originalJson(data);
    };
    
    next();
  };
}

module.exports = {
  initRedis,
  getRedis,
  cache,
  cacheMiddleware
};