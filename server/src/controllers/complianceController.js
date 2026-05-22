const db = require('../db');

const createContract = async (req, res) => {
  try {
    const { employeeId, contractType, startDate, endDate, terms, documentUrl } = req.body;

    const { rows } = await db.query(
      `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, terms, document_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [employeeId, contractType, startDate, endDate, JSON.stringify(terms || {}), documentUrl]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Create contract error:', error);
    return res.status(500).json({ error: 'Failed to create contract' });
  }
};

const getContracts = async (req, res) => {
  try {
    const { employeeId } = req.query;
    let query = `SELECT ec.*, u.full_name as employee_name FROM employee_contracts ec JOIN users u ON ec.employee_id = u.id WHERE 1=1`;
    const params = [];

    if (employeeId) {
      query += ` AND ec.employee_id = $${params.length + 1}`;
      params.push(employeeId);
    }

    query += ` ORDER BY ec.created_at DESC`;

    const { rows } = await db.query(query, params);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Get contracts error:', error);
    return res.status(500).json({ error: 'Failed to get contracts' });
  }
};

const addDocument = async (req, res) => {
  try {
    const { employeeId, documentType, documentName, expiryDate, documentUrl, alertDaysBefore } = req.body;

    const { rows } = await db.query(
      `INSERT INTO employee_documents (employee_id, document_type, document_name, expiry_date, document_url, alert_days_before)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [employeeId, documentType, documentName, expiryDate, documentUrl, alertDaysBefore || 30]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Add document error:', error);
    return res.status(500).json({ error: 'Failed to add document' });
  }
};

const getDocuments = async (req, res) => {
  try {
    const { employeeId } = req.query;
    let query = `SELECT ed.*, u.full_name as employee_name FROM employee_documents ed JOIN users u ON ed.employee_id = u.id WHERE 1=1`;
    const params = [];

    if (employeeId) {
      query += ` AND ed.employee_id = $${params.length + 1}`;
      params.push(employeeId);
    }

    query += ` ORDER BY ed.expiry_date ASC`;

    const { rows } = await db.query(query, params);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Get documents error:', error);
    return res.status(500).json({ error: 'Failed to get documents' });
  }
};

const getExpiringDocuments = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { days = 30 } = req.query;

    const { rows } = await db.query(
      `SELECT ed.*, u.full_name as employee_name
       FROM employee_documents ed
       JOIN users u ON ed.employee_id = u.id
       WHERE u.company_id = $1 
       AND ed.expiry_date IS NOT NULL
       AND ed.expiry_date <= CURRENT_DATE + INTERVAL '${days} days'
       AND ed.expiry_date >= CURRENT_DATE
       ORDER BY ed.expiry_date ASC`,
      [companyId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get expiring documents error:', error);
    return res.status(500).json({ error: 'Failed to get expiring documents' });
  }
};

const generateAttendanceCertificate = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.body;

    const { rows: attendance } = await db.query(
      `SELECT COUNT(*) as total_days, 
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_days,
              SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
              SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_days
       FROM attendance
       WHERE user_id = $1 AND check_in >= $2 AND check_in <= $3`,
      [employeeId, startDate, endDate]
    );

    const { rows: employee } = await db.query(
      `SELECT u.full_name, u.email, t.name as company_name
       FROM users u
       JOIN tenants t ON u.company_id = t.id
       WHERE u.id = $1`,
      [employeeId]
    );

    const certificate = {
      employeeName: employee[0]?.full_name,
      companyName: employee[0]?.company_name,
      email: employee[0]?.email,
      period: { start: startDate, end: endDate },
      attendance: attendance[0],
      generatedAt: new Date().toISOString(),
    };

    return res.json({ data: certificate });
  } catch (error) {
    console.error('Generate certificate error:', error);
    return res.status(500).json({ error: 'Failed to generate certificate' });
  }
};

module.exports = {
  createContract,
  getContracts,
  addDocument,
  getDocuments,
  getExpiringDocuments,
  generateAttendanceCertificate,
};