const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/permissionMiddleware');
const db = require('../db');

const { 
  setSalary, 
  getSalaryHistory, 
  getCurrentSalary, 
  generatePayslip, 
  getPayslips, 
  addBonus, 
  exportPayrollData 
} = require('../controllers/payrollController');

router.post('/salary', verifyToken, requirePermission('payroll', 'create'), setSalary);
router.get('/salary/:employeeId', verifyToken, getSalaryHistory);
router.get('/salary/current/:employeeId', verifyToken, getCurrentSalary);

router.post('/payslip/generate', verifyToken, requirePermission('payroll', 'create'), generatePayslip);
router.get('/payslips', verifyToken, getPayslips);

router.post('/bonus', verifyToken, requirePermission('payroll', 'create'), addBonus);

router.get('/export', verifyToken, requirePermission('payroll', 'read'), exportPayrollData);

router.get('/export/gusto', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const companyId = req.user.company_id;

    const employees = await db.query(
      `SELECT id, full_name, email, department, contact_number, bank_details
       FROM users 
       WHERE company_id = $1 AND is_active = true AND role = 'EMPLOYEE'`,
      [companyId]
    );

    const timeLogs = await db.query(
      `SELECT user_id, date, 
              SUM(CASE WHEN activity_type = 'clock_in' THEN 1 ELSE 0 END) as clock_ins,
              SUM(CASE WHEN activity_type = 'clock_out' THEN 1 ELSE 0 END) as clock_outs
       FROM "ActivityLog" 
       WHERE timestamp::date BETWEEN $1 AND $2
       GROUP BY user_id, date`,
      [startDate || '2024-01-01', endDate || new Date().toISOString().split('T')[0]]
    );

    const gustoFormat = employees.rows.map(emp => ({
      'First Name': emp.full_name?.split(' ')[0] || '',
      'Last Name': emp.full_name?.split(' ').slice(1).join(' ') || '',
      'Email': emp.email || '',
      'Department': emp.department || '',
      'Hourly Rate': '0',
      'Salary': '0',
      'Start Date': new Date().toISOString().split('T')[0],
      'Employment Type': 'Full-Time',
      'Job Title': emp.department || 'Employee'
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=gusto-import.csv');
    
    if (gustoFormat.length === 0) {
      return res.send('First Name,Last Name,Email,Department,Hourly Rate,Salary,Start Date,Employment Type,Job Title');
    }
    
    const headers = Object.keys(gustoFormat[0]);
    const csv = [
      headers.join(','),
      ...gustoFormat.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');
    
    res.send(csv);
  } catch (err) {
    console.error('Error exporting to Gusto:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export/deel', verifyToken, async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const employees = await db.query(
      `SELECT u.id, u.full_name, u.email, u.department, u.contact_number, u.created_at,
              COALESCE(SUM(al.balance_change), 0) as total_hours
       FROM users u
       LEFT JOIN "ActivityLog" al ON u.id = al.user_id
       WHERE u.company_id = $1 AND u.is_active = true AND u.role = 'EMPLOYEE'
       GROUP BY u.id`,
      [companyId]
    );

    const deelFormat = employees.rows.map(emp => ({
      'Name': emp.full_name || '',
      'Email': emp.email || '',
      'Department': emp.department || '',
      'Phone': emp.contact_number || '',
      'Start Date': new Date(emp.created_at).toISOString().split('T')[0],
      'Contract Type': 'Full-Time',
      'Work Schedule': 'Standard',
      'Country': 'US',
      'State': ''
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=deel-import.csv');
    
    if (deelFormat.length === 0) {
      return res.send('Name,Email,Department,Phone,Start Date,Contract Type,Work Schedule,Country,State');
    }
    
    const headers = Object.keys(deelFormat[0]);
    const csv = [
      headers.join(','),
      ...deelFormat.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');
    
    res.send(csv);
  } catch (err) {
    console.error('Error exporting to Deel:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export/quickbooks', verifyToken, async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { payPeriod } = req.query;

    const employees = await db.query(
      `SELECT u.id, u.full_name, u.email, u.department, 
              COALESCE(SUM(al.balance_change), 0) as total_minutes
       FROM users u
       LEFT JOIN "ActivityLog" al ON u.id = al.user_id
       WHERE u.company_id = $1 AND u.is_active = true AND u.role = 'EMPLOYEE'
       GROUP BY u.id`,
      [companyId]
    );

    const qbFormat = employees.rows.map(emp => ({
      'EmployeeName': emp.full_name || '',
      'EmployeeID': `EMP-${emp.id}`,
      'Email': emp.email || '',
      'Department': emp.department || '',
      'PayRate': '0.00',
      'HoursWorked': Math.round((emp.total_minutes || 0) / 60 * 100) / 100,
      'PayPeriod': payPeriod || new Date().toISOString().slice(0, 7),
      'FederalFilingStatus': 'Single',
      'StateFilingStatus': 'CA'
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=quickbooks-payroll.csv');
    
    if (qbFormat.length === 0) {
      return res.send('EmployeeName,EmployeeID,Email,Department,PayRate,HoursWorked,PayPeriod,FederalFilingStatus,StateFilingStatus');
    }
    
    const headers = Object.keys(qbFormat[0]);
    const csv = [
      headers.join(','),
      ...qbFormat.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');
    
    res.send(csv);
  } catch (err) {
    console.error('Error exporting to QuickBooks:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/export/timesheet', verifyToken, async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { startDate, endDate, format = 'csv' } = req.query;

    const timeData = await db.query(
      `SELECT 
        u.id as user_id,
        u.full_name,
        u.email,
        u.department,
        al.timestamp::date as work_date,
        MIN(CASE WHEN al.activity_type = 'clock_in' THEN al.timestamp END) as clock_in,
        MAX(CASE WHEN al.activity_type = 'clock_out' THEN al.timestamp END) as clock_out,
        COUNT(*) as total_entries,
        SUM(al.balance_change) as minutes_worked
       FROM users u
       LEFT JOIN "ActivityLog" al ON u.id = al.user_id 
         AND al.timestamp::date BETWEEN $2 AND $3
       WHERE u.company_id = $1 AND u.is_active = true
       GROUP BY u.id, u.full_name, u.email, u.department, al.timestamp::date
       ORDER BY work_date DESC, u.full_name`,
      [companyId, startDate || '2024-01-01', endDate || new Date().toISOString().split('T')[0]]
    );

    if (format === 'json') {
      return res.json(timeData.rows);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=timesheet.csv');
    
    const csv = [
      'Employee ID,Full Name,Email,Department,Date,Clock In,Clock Out,Minutes Worked',
      ...timeData.rows.map(row => 
        `${row.user_id},"${row.full_name}","${row.email}","${row.department || ''}",${row.work_date},"${row.clock_in || ''}","${row.clock_out || ''}",${row.minutes_worked || 0}`
      )
    ].join('\n');
    
    res.send(csv);
  } catch (err) {
    console.error('Error exporting timesheet:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;