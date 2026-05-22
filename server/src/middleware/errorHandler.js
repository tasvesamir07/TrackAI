const winston = require('winston');

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'track-ai' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;

  // Log the error
  if (statusCode >= 500) {
    logger.error({
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id
    });
  } else {
    logger.warn({
      message: err.message,
      url: req.originalUrl,
      method: req.method,
      statusCode
    });
  }

  // Don't expose internal error details in production
  const message = process.env.NODE_ENV === 'production' && statusCode >= 500
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: err.code || 'ERROR'
    }
  });
};

// Async handler wrapper to catch errors automatically
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Not found handler
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

module.exports = {
  logger,
  errorHandler,
  asyncHandler,
  notFoundHandler
};