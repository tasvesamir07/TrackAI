const { z } = require('zod');

const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be at most 200 characters'),
  description: z.string().optional().nullable(),
  project_id: z.string().uuid('Invalid project ID').optional().nullable(),
  assigned_to: z.coerce.number().optional().nullable(),
  due_date: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional()
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional().nullable(),
  assigned_to: z.coerce.number().optional().nullable(),
  due_date: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional()
});

const taskQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  status: z.string().optional(),
  project_id: z.string().uuid().optional(),
  assigned_to: z.coerce.number().optional()
});

module.exports = {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema
};