const { z } = require('zod');

const createLeaveSchema = z.object({
  leave_type: z.enum(['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid', 'other']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  reason: z.string().max(500, 'Reason must be at most 500 characters').optional()
}).refine(data => new Date(data.start_date) <= new Date(data.end_date), {
  message: 'End date must be after start date',
  path: ['end_date']
});

const updateLeaveSchema = z.object({
  leave_type: z.enum(['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid', 'other']).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(500).optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional()
});

const approveLeaveSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional()
});

const leaveQuerySchema = z.object({
  page: z.coerce.number().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  status: z.string().optional(),
  leave_type: z.string().optional(),
  year: z.coerce.number().optional(),
  month: z.coerce.number().min(1).max(12).optional()
});

module.exports = {
  createLeaveSchema,
  updateLeaveSchema,
  approveLeaveSchema,
  leaveQuerySchema
};