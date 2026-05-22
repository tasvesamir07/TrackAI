const { z } = require('zod');

const createUserSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters'),
  email: z.string().email('Invalid email format').optional().nullable(),
  full_name: z.string().min(1, 'Full name is required').optional(),
  role: z.enum(['EMPLOYEE', 'PROJECT_MANAGER', 'COMPANY_ADMIN']).optional(),
  department: z.string().optional().nullable(),
  contact_number: z.string().optional().nullable()
});

const updateUserSchema = z.object({
  full_name: z.string().optional(),
  email: z.string().email('Invalid email format').optional().nullable(),
  role: z.enum(['EMPLOYEE', 'PROJECT_MANAGER', 'COMPANY_ADMIN']).optional(),
  department: z.string().optional().nullable(),
  contact_number: z.string().optional().nullable(),
  is_active: z.boolean().optional()
});

const userQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  search: z.string().optional(),
  department: z.string().optional(),
  role: z.string().optional()
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  userQuerySchema
};