/**
 * API Versioning Middleware
 * Provides URL-based API versioning
 * @module apiVersioning
 */

const API_VERSIONS = ['v1', 'v2'];
const DEFAULT_VERSION = 'v1';

/**
 * Create API versioning middleware
 * @function createVersioningMiddleware
 * @param {Object} options - Versioning options
 * @param {string} options.defaultVersion - Default version if none specified
 * @param {string} options.headerName - Custom header for version (e.g., 'Accept-Version')
 * @returns {Function} Express middleware
 * 
 * @example
 * const versioning = createVersioningMiddleware();
 * app.use('/api', versioning);
 */
function createVersioningMiddleware(options = {}) {
  const defaultVersion = options.defaultVersion || DEFAULT_VERSION;
  const headerName = options.headerName || 'X-API-Version';
  
  return (req, res, next) => {
    // Check URL path for version (e.g., /api/v1/users)
    const pathMatch = req.path.match(/^\/(v\d+)\//);
    const urlVersion = pathMatch ? pathMatch[1] : null;
    
    // Check header for version
    const headerVersion = req.header(headerName);
    
    // Determine version priority: URL > Header > Default
    let version = urlVersion || headerVersion || defaultVersion;
    
    // Validate version
    if (!API_VERSIONS.includes(version)) {
      version = defaultVersion;
    }
    
    // Attach version to request
    req.apiVersion = version;
    
    // Add version header to response
    res.setHeader('X-API-Version', version);
    
    next();
  };
}

/**
 * Version-specific route handler
 * @function versionedRoute
 * @param {Object} routes - Object mapping versions to handlers
 * @returns {Function} Express route handler
 * 
 * @example
 * app.use('/users', versionedRoute({
 *   v1: userControllerV1.getUsers,
 *   v2: userControllerV2.getUsersNew,
 * }));
 */
function versionedRoute(routes) {
  return (req, res, next) => {
    const version = req.apiVersion || DEFAULT_VERSION;
    const handler = routes[version];
    
    if (handler) {
      return handler(req, res, next);
    }
    
    // Fallback to default version if available
    if (routes[DEFAULT_VERSION]) {
      return routes[DEFAULT_VERSION](req, res, next);
    }
    
    return res.status(404).json({
      error: 'Version not supported',
      supportedVersions: Object.keys(routes),
    });
  };
}

/**
 * Create versioned router
 * @function createVersionedRouter
 * @param {string} version - API version
 * @returns {Object} Express router with version prefix
 */
function createVersionedRouter(version) {
  const express = require('express');
  const router = express.Router();
  
  // Add version to all routes
  router.use((req, res, next) => {
    req.apiVersion = version;
    next();
  });
  
  return router;
}

/**
 * Deprecation middleware - adds deprecation headers
 * @function deprecate
 * @param {string} sunsetDate - Date to sunset (ISO 8601)
 * @param {string} removalVersion - Version to remove in
 * @returns {Function} Express middleware
 */
function deprecate(sunsetDate, removalVersion) {
  return (req, res, next) => {
    res.setHeader('Sunset', sunsetDate);
    res.setHeader('X-API-Deprecation', JSON.stringify({
      sunset: sunsetDate,
      removal: removalVersion,
      alternative: `Use API version ${removalVersion}`,
    }));
    next();
  };
}

/**
 * Migration helper - redirect to new version
 * @function migrateTo
 * @param {string} newVersion - Target version
 * @returns {Function} Express middleware
 */
function migrateTo(newVersion) {
  return (req, res, next) => {
    const redirectPath = req.path.replace(/\/v\d+/, `/${newVersion}`);
    
    res.setHeader('X-API-Migration', `Use ${newVersion} instead`);
    res.setHeader('Location', redirectPath);
    
    return res.status(307).json({
      message: `This endpoint has moved to /${newVersion}`,
      newEndpoint: redirectPath,
    });
  };
}

/**
 * Version compatibility checker
 * @function checkCompatibility
 * @param {string} minVersion - Minimum required version
 * @returns {Function} Express middleware
 */
function checkCompatibility(minVersion) {
  return (req, res, next) => {
    const currentVersion = req.apiVersion || DEFAULT_VERSION;
    
    const versions = API_VERSIONS;
    const currentIndex = versions.indexOf(currentVersion);
    const minIndex = versions.indexOf(minVersion);
    
    if (currentIndex < minIndex) {
      return res.status(400).json({
        error: 'Incompatible API version',
        minimum: minVersion,
        current: currentVersion,
        message: `This endpoint requires ${minVersion} or higher`,
      });
    }
    
    next();
  };
}

// Export helper for creating route groups
function versionGroup(router, version, routes) {
  const versionedRouter = createVersionedRouter(version);
  
  Object.entries(routes).forEach(([path, handler]) => {
    versionedRouter.use(path, handler);
  });
  
  router.use(`/${version}`, versionedRouter);
}

module.exports = {
  createVersioningMiddleware,
  versionedRoute,
  createVersionedRouter,
  deprecate,
  migrateTo,
  checkCompatibility,
  versionGroup,
  API_VERSIONS,
  DEFAULT_VERSION,
};