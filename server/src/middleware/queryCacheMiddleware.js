const { queryCache, CACHE_KEYS } = require('../utils/queryCache');

const CACHEABLE_ENDPOINTS = [
  { path: '/api/admin/users', ttl: 60 },
  { path: '/api/admin/departments', ttl: 300 },
  { path: '/api/admin/holidays', ttl: 900 },
  { path: '/api/auth/companies', ttl: 300 },
  { path: '/api/projects', ttl: 120 },
  { path: '/api/leaves', ttl: 60 },
];

function isCacheableEndpoint(req) {
  if (req.method !== 'GET') return false;
  
  const url = req.url.split('?')[0];
  return CACHEABLE_ENDPOINTS.some(endpoint => url.startsWith(endpoint.path));
}

function getCacheTTL(req) {
  const url = req.url.split('?')[0];
  const match = CACHEABLE_ENDPOINTS.find(endpoint => url.startsWith(endpoint.path));
  return match ? match.ttl : 60;
}

function generateCacheKey(req) {
  const url = req.url.split('?')[0];
  const userId = req.user?.id || 'anonymous';
  const companyId = req.user?.company_id || 'global';
  return `${url}:${companyId}:${userId}`;
}

const cacheMiddleware = async (req, res, next) => {
  if (!isCacheableEndpoint(req)) {
    return next();
  }
  
  const cacheKey = generateCacheKey(req);
  const ttl = getCacheTTL(req);
  
  try {
    const cachedData = await queryCache.get(cacheKey);
    
    if (cachedData) {
      res.set('X-Cache', 'HIT');
      return res.status(200).json(cachedData);
    }
    
    res.set('X-Cache', 'MISS');
    
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      if (res.statusCode === 200 && data) {
        queryCache.set(cacheKey, data, ttl).catch(() => {});
      }
      return originalJson(data);
    };
    
    next();
  } catch (err) {
    next();
  }
};

const invalidateCache = async (pattern) => {
  await queryCache.invalidatePattern(pattern);
};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  CACHE_KEYS,
};