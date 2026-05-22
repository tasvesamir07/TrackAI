const db = require('../db');

const setSalary = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { employeeId, effectiveFrom, baseSalary, allowances, deductions } = req.body;

    const { rows } = await db.query(
      `INSERT INTO salary_history (employee_id, effective_from, base_salary, allowances, deductions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [employeeId, effectiveFrom, baseSalary, JSON.stringify(allowances || {}), JSON.stringify(deductions || {}), userId]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Set salary error:', error);
    return res.status(500).json({ error: 'Failed to set salary' });
  }
};

const getSalaryHistory = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const { rows } = await db.query(
      `SELECT * FROM salary_history WHERE employee_id = $1 ORDER BY effective_from DESC`,
      [employeeId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get salary history error:', error);
    return res.status(500).json({ error: 'Failed to get salary history' });
  }
};

const getCurrentSalary = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const { rows } = await db.query(
      `SELECT * FROM salary_history 
       WHERE employee_id = $1 AND effective_from <= CURRENT_DATE
       ORDER BY effective_from DESC LIMIT 1`,
      [employeeId]
    );

    return res.json({ data: rows[0] || null });
  } catch (error) {
    console.error('Get current salary error:', error);
    return res.status(500).json({ error: 'Failed to get current salary' });
  }
};

const generatePayslip = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { employeeId, periodStart, periodEnd } = req.body;

    const { rows: salary } = await db.query(
      `SELECT * FROM salary_history 
       WHERE employee_id = $1 AND effective_from <= $2
       ORDER BY effective_from DESC LIMIT 1`,
      [employeeId, periodEnd]
    );

    if (!salary.length) {
      return res.status(400).json({ error: 'No salary configured for this employee' });
    }

    const { rows: overtime } = await db.query(
      `SELECT COALESCE(SUM(overtime_minutes), 0) as total_minutes
       FROM attendance
       WHERE user_id = $1 AND check_in >= $2 AND check_out <= $3`,
      [employeeId, periodStart, periodEnd]
    );

    const overtimePay = (overtime[0].total_minutes / 60) * (salary[0].base_salary / 176);
    
    const allowances = JSON.parse(salary[0].allowances || '{}');
    const deductions = JSON.parse(salary[0].deductions || '{}');
    
    const totalAllowances = Object.values(allowances).reduce((sum, val) => sum + Number(val), 0);
    const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + Number(val), 0);
    
    const grossPay = Number(salary[0].base_salary) + totalAllowances + overtimePay;
    const netPay = grossPay - totalDeductions;

    const { rows } = await db.query(
      `INSERT INTO payslips (company_id, employee_id, period_start, period_end, basic_salary, allowances, deductions, overtime_pay, gross_pay, net_pay, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'generated')
       RETURNING id`,
      [companyId, employeeId, periodStart, periodEnd, salary[0].base_salary, JSON.stringify(allowances), JSON.stringify(deductions), overtimePay, grossPay, netPay]
    );

    return res.json({ data: { id: rows[0].id, grossPay, netPay } });
  } catch (error) {
    console.error('Generate payslip error:', error);
    return res.status(500).json({ error: 'Failed to generate payslip' });
  }
};

const getPayslips = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { employeeId, periodStart, periodEnd } = req.query;

    let query = `SELECT p.*, u.full_name as employee_name FROM payslips p JOIN users u ON p.employee_id = u.id WHERE p.company_id = $1`;
    const params = [companyId];

    if (employeeId) {
      query += ` AND p.employee_id = $${params.length + 1}`;
      params.push(employeeId);
    }

    if (periodStart) {
      query += ` AND p.period_start >= $${params.length + 1}`;
      params.push(periodStart);
    }

    if (periodEnd) {
      query += ` AND p.period_end <= $${params.length + 1}`;
      params.push(periodEnd);
    }

    query += ` ORDER BY p.created_at DESC`;

    const { rows } = await db.query(query, params);

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get payslips error:', error);
    return res.status(500).json({ error: 'Failed to get payslips' });
  }
};

const addBonus = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { employeeId, amount, type, description, paymentDate, taxDeducted } = req.body;

    const { rows } = await db.query(
      `INSERT INTO bonuses (company_id, employee_id, amount, type, description, payment_date, tax_deducted, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [companyId, employeeId, amount, type, description, paymentDate, taxDeducted || false, userId]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Add bonus error:', error);
    return res.status(500).json({ error: 'Failed to add bonus' });
  }
};

const exportPayrollData = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { periodStart, periodEnd } = req.query;

    const { rows } = await db.query(
      `SELECT 
        u.id, u.full_name, u.email, u.department,
        sh.base_salary, sh.allowances, sh.deductions,
        COALESCE(SUM(a.overtime_minutes), 0) as overtime_minutes,
        COALESCE(SUM(b.amount), 0) as bonus_amount
      FROM users u
      LEFT JOIN salary_history sh ON u.id = sh.employee_id AND sh.effective_from <= $3
      LEFT JOIN attendance a ON u.id = a.user_id AND a.check_in >= $1 AND a.check_out <= $2
      LEFT JOIN bonuses b ON u.id = b.employee_id AND b.payment_date >= $1 AND b.payment_date <= $2
      WHERE u.company_id = $4 AND u.status = 'active'
      GROUP BY u.id, u.full_name, u.email, u.department, sh.base_salary, sh.allowances, sh.deductions`,
      [periodStart, periodEnd, periodEnd, companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Export payroll data error:', error);
    return res.status(500).json({ error: 'Failed to export payroll data' });
  }
};

module.exports = {
  setSalary,
  getSalaryHistory,
  getCurrentSalary,
  generatePayslip,
  getPayslips,
  addBonus,
  exportPayrollData,
};