const { queryCache, CACHE_KEYS } = require('../utils/queryCache');

const cacheMiddleware = (options = {}) => {
  const {
    getKey,
    ttl = 300,
    condition = () => true,
    skip = () => false
  } = options;

  return async (req, res, next) => {
    if (skip(req)) {
      return next();
    }

    if (!condition(req)) {
      return next();
    }

    const cacheKey = getKey(req);
    if (!cacheKey) {
      return next();
    }

    try {
      const cachedData = await queryCache.get(cacheKey);
      
      if (cachedData) {
        return res.status(200).json({
          success: true,
          data: cachedData,
          cached: true
        });
      }

      const originalJson = res.json.bind(res);
      
      res.json = function(body) {
        if (body?.success !== false && body?.data) {
          queryCache.set(cacheKey, body.data, ttl).catch(err => {
            console.error('[CacheMiddleware] Failed to cache:', err.message);
          });
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      console.error('[CacheMiddleware] Error:', err.message);
      next();
    }
  };
};

const invalidateOnWrite = (patterns = []) => {
  return async (req, res, next) => {
    const originalSend = res.send.bind(res);
    
    res.send = function(body) {
      const statusCode = res.statusCode;
      
      if ((statusCode >= 200 && statusCode < 300) && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
        patterns.forEach(pattern => {
          if (typeof pattern === 'function') {
            queryCache.invalidatePattern(pattern(req)).catch(() => {});
          } else {
            queryCache.invalidatePattern(pattern).catch(() => {});
          }
        });
      }
      
      return originalSend(body);
    };
    
    next();
  };
};

const dashboardCache = cacheMiddleware({
  getKey: (req) => {
    const companyId = req.user?.company_id;
    if (!companyId) return null;
    return CACHE_KEYS.dashboardStats(companyId);
  },
  ttl: 300,
  condition: (req) => req.path === '/admin/dashboard' || req.path.includes('dashboard'),
  skip: (req) => req.query.noCache === 'true'
});

const userListCache = cacheMiddleware({
  getKey: (req) => {
    const companyId = req.user?.company_id;
    if (!companyId) return null;
    return `${CACHE_KEYS.userList(companyId)}:${JSON.stringify(req.query)}`;
  },
  ttl: 120,
  condition: (req) => req.path.includes('/admin/employees') || req.path.includes('/users'),
  skip: (req) => req.query.noCache === 'true' || req.method !== 'GET'
});

const settingsCache = cacheMiddleware({
  getKey: (req) => {
    const companyId = req.user?.company_id;
    if (!companyId) return null;
    return CACHE_KEYS.settings(companyId);
  },
  ttl: 600,
  condition: (req) => req.path.includes('/settings'),
  skip: (req) => req.method !== 'GET'
});

const holidaysCache = cacheMiddleware({
  getKey: (req) => {
    const companyId = req.user?.company_id;
    if (!companyId) return null;
    return CACHE_KEYS.holidays(companyId);
  },
  ttl: 3600,
  condition: (req) => req.path.includes('/holidays'),
  skip: (req) => req.method !== 'GET'
});

const cacheInvalidator = invalidateOnWrite([
  (req) => `dashboardStats:${req.user?.company_id}`,
  (req) => `userList:${req.user?.company_id}`,
  (req) => `settings:${req.user?.company_id}`,
  (req) => `leaveBalance:*`
]);

const clearCacheByCompany = async (companyId) => {
  await queryCache.invalidatePattern(`dashboardStats:${companyId}`);
  await queryCache.invalidatePattern(`userList:${companyId}`);
  await queryCache.invalidatePattern(`settings:${companyId}`);
  await queryCache.invalidatePattern(`holidays:${companyId}`);
  await queryCache.invalidatePattern(`projects:${companyId}`);
};

module.exports = {
  cacheMiddleware,
  dashboardCache,
  userListCache,
  settingsCache,
  holidaysCache,
  cacheInvalidator,
  clearCacheByCompany,
  queryCache
};