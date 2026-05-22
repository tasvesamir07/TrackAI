const rateLimit = require('express-rate-limit');
const { logger } = require('./errorHandler');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePath = (value = '') => String(value || '').split('?')[0].toLowerCase();

const shouldSkipGlobalApiLimit = (req) => {
  const path = normalizePath(req.path || req.originalUrl || '');
  if (path === '/saas/auth/plans') return true;
  return false;
};

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
  max: parsePositiveInt(process.env.API_RATE_LIMIT_MAX, 500), // default for larger teams behind shared IPs
  skip: shouldSkipGlobalApiLimit,
  message: {
    success: false,
    error: {
      message: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({
      message: 'Rate limit exceeded',
      ip: req.ip,
      path: req.path
    });
    return res.status(429).json({
      success: false,
      error: {
        message: 'Too many requests, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      }
    });
  }
});

// Strict limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per windowMs
  message: {
    success: false,
    error: {
      message: 'Too many authentication attempts, please try again later.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

// Stricter limiter for sensitive operations (password reset, etc.)
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 attempts per hour
  message: {
    success: false,
    error: {
      message: 'Too many attempts, please try again later.',
      code: 'SENSITIVE_OPERATION_LIMIT'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// WebSocket connection limiter
const wsConnectionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 connections per minute
  skip: (req) => !req.path.startsWith('/socket.io')
});

// File upload limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 uploads per minute
  message: {
    success: false,
    error: {
      message: 'Too many file uploads, please try again later.',
      code: 'UPLOAD_RATE_LIMIT_EXCEEDED'
    }
  },
  skip: (req) => !req.path.includes('/upload')
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 80,
  message: {
    success: false,
    error: {
      message: 'Too many chat requests, please slow down.',
      code: 'CHAT_RATE_LIMIT_EXCEEDED'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  authLimiter,
  sensitiveLimiter,
  wsConnectionLimiter,
  uploadLimiter,
  chatLimiter
};
