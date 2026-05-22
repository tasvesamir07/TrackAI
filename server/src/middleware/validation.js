const { logger } = require('./errorHandler');

// Input validation utilities
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  // Minimum 8 characters, at least one uppercase, one lowercase, one number
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  return passwordRegex.test(password);
};

const validatePhone = (phone) => {
  const phoneRegex = /^\+?[\d\s-()]{10,}$/;
  return phoneRegex.test(phone);
};

const validateUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
};

const validateRequired = (obj, fields) => {
  const missing = [];
  for (const field of fields) {
    if (!obj[field] && obj[field] !== 0 && obj[field] !== false) {
      missing.push(field);
    }
  }
  return missing.length === 0 ? null : `Missing required fields: ${missing.join(', ')}`;
};

const validateRange = (value, min, max) => {
  const num = Number(value);
  if (isNaN(num)) return 'Value must be a number';
  if (min !== undefined && num < min) return `Value must be at least ${min}`;
  if (max !== undefined && num > max) return `Value must be at most ${max}`;
  return null;
};

// Request validator middleware factory
const validateRequest = (schema) => {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value !== undefined && value !== null) {
        if (rules.type && typeof value !== rules.type) {
          errors.push(`${field} must be of type ${rules.type}`);
        }

        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }

        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must be at most ${rules.maxLength} characters`);
        }

        if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }

        if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        }

        if (rules.enum && !rules.enum.includes(value)) {
          errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
        }

        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }

        if (rules.custom && !rules.custom(value)) {
          errors.push(`${field} is invalid`);
        }
      }
    }

    if (errors.length > 0) {
      logger.warn({ message: 'Validation failed', errors, path: req.path });
      return res.status(400).json({
        success: false,
        error: { message: 'Validation failed', details: errors, code: 'VALIDATION_ERROR' }
      });
    }

    next();
  };
};

// ID parameter validator
const validateIdParam = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!id || isNaN(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: `Invalid ${paramName}`, code: 'INVALID_ID' }
      });
    }
    next();
  };
};

module.exports = {
  validateEmail,
  validatePassword,
  validatePhone,
  validateUrl,
  sanitizeInput,
  validateRequired,
  validateRange,
  validateRequest,
  validateIdParam
};