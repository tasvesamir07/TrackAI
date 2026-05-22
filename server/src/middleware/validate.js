/**
 * Validation Middleware using Zod
 * Provides request body, query, and params validation
 * @module validate
 * @description Validates incoming requests using Zod schemas to ensure data integrity
 */

const { z } = require('zod');

/**
 * Validates request data using a Zod schema
 * @function validate
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @param {string} source - Source of data to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 * @example
 * const { loginSchema } = require('../validators/auth.validator');
 * router.post('/login', validate(loginSchema, 'body'), loginController);
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = source === 'body' 
        ? req.body 
        : source === 'query' 
          ? req.query 
          : req.params;

      const result = schema.parse(data);
      
      // Replace request data with parsed (and sanitized) data
      if (source === 'body') req.body = result;
      else if (source === 'query') req.query = result;
      else req.params = result;

      next();
    } catch (error) {
      if (error.name === 'ZodError') {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      
      return res.status(500).json({
        error: 'Internal validation error'
      });
    }
  };
};

const validateBody = (schema) => validate(schema, 'body');
const validateQuery = (schema) => validate(schema, 'query');
const validateParams = (schema) => validate(schema, 'params');

module.exports = {
  validate,
  validateBody,
  validateQuery,
  validateParams
};