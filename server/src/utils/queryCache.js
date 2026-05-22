const Redis = require('ioredis');

const CACHE_DEFAULT_TTL = 300;
const CACHE_SHORT_TTL = 60;
const CACHE_MEDIUM_TTL = 300;
const CACHE_LONG_TTL = 900;

let redisClient = null;

function createCacheClient() {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  
  if (!redisUrl) {
    console.warn('[QueryCache] REDIS_URL not set. Query caching disabled.');
    return null;
  }
  
  if (!/^rediss?:\/\//i.test(redisUrl)) {
    console.warn('[QueryCache] REDIS_URL must start with redis:// or rediss://');
    return null;
  }
  
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  
  client.on('error', (err) => {
    console.error('[QueryCache] Redis error:', err.message);
  });
  
  client.on('connect', () => {
    console.log('[QueryCache] Connected to Redis');
  });
  
  return client;
}

function getClient() {
  if (!redisClient) {
    redisClient = createCacheClient();
  }
  return redisClient;
}

const queryCache = {
  async get(key) {
    try {
      const client = getClient();
      if (!client) return null;
      
      const data = await client.get(`cache:${key}`);
      if (!data) return null;
      
      return JSON.parse(data);
    } catch (err) {
      console.error('[QueryCache] Get error:', err.message);
      return null;
    }
  },
  
  async set(key, value, ttl = CACHE_DEFAULT_TTL) {
    try {
      const client = getClient();
      if (!client) return false;
      
      await client.setex(`cache:${key}`, ttl, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error('[QueryCache] Set error:', err.message);
      return false;
    }
  },
  
  async del(key) {
    try {
      const client = getClient();
      if (!client) return false;
      
      await client.del(`cache:${key}`);
      return true;
    } catch (err) {
      console.error('[QueryCache] Del error:', err.message);
      return false;
    }
  },
  
  async invalidatePattern(pattern) {
    try {
      const client = getClient();
      if (!client) return false;
      
      const keys = await client.keys(`cache:${pattern}`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
      return true;
    } catch (err) {
      console.error('[QueryCache] Invalidate pattern error:', err.message);
      return false;
    }
  },
  
  async getOrSet(key, fetchFn, ttl = CACHE_DEFAULT_TTL) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }
    
    const data = await fetchFn();
    if (data) {
      await this.set(key, data, ttl);
    }
    return data;
  },
  
  TTL: {
    SHORT: CACHE_SHORT_TTL,
    MEDIUM: CACHE_MEDIUM_TTL,
    DEFAULT: CACHE_DEFAULT_TTL,
    LONG: CACHE_LONG_TTL,
  },
};

const CACHE_KEYS = {
  userList: (companyId) => `userList:${companyId}`,
  departments: (companyId) => `departments:${companyId}`,
  settings: (companyId) => `settings:${companyId}`,
  globalSettings: () => 'settings:global',
  dashboardStats: (companyId) => `dashboardStats:${companyId}`,
  holidays: (companyId) => `holidays:${companyId}`,
  leaveBalance: (userId) => `leaveBalance:${userId}`,
  projectList: (companyId) => `projects:${companyId}`,
};

module.exports = {
  queryCache,
  CACHE_KEYS,
  createCacheClient,
};