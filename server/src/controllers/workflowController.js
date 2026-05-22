const db = require('../db');

const createApprovalChain = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { name, entityType, steps } = req.body;

    const { rows } = await db.query(
      `INSERT INTO approval_chains (company_id, name, entity_type, steps, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [companyId, name, entityType, JSON.stringify(steps), userId]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Create approval chain error:', error);
    return res.status(500).json({ error: 'Failed to create approval chain' });
  }
};

const getApprovalChains = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { entityType } = req.query;

    let query = `SELECT * FROM approval_chains WHERE company_id = $1 AND is_active = true`;
    const params = [companyId];

    if (entityType) {
      query += ` AND entity_type = $2`;
      params.push(entityType);
    }

    const { rows } = await db.query(query, params);

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get approval chains error:', error);
    return res.status(500).json({ error: 'Failed to get approval chains' });
  }
};

const updateApprovalChain = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const { id } = req.params;
    const { name, steps, isActive } = req.body;

    await db.query(
      `UPDATE approval_chains 
       SET name = COALESCE($1, name), steps = COALESCE($2, steps), is_active = COALESCE($3, is_active), updated_at = NOW()
       WHERE id = $4 AND company_id = $5`,
      [name, steps ? JSON.stringify(steps) : null, isActive, id, companyId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Update approval chain error:', error);
    return res.status(500).json({ error: 'Failed to update approval chain' });
  }
};

const createApprovalRequest = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { chainId, entityType, entityId } = req.body;

    const { rows: chain } = await db.query(
      `SELECT steps FROM approval_chains WHERE id = $1 AND company_id = $2`,
      [chainId, companyId]
    );

    if (!chain.length) {
      return res.status(400).json({ error: 'Approval chain not found' });
    }

    const { rows } = await db.query(
      `INSERT INTO approval_requests (company_id, chain_id, entity_type, entity_id, requester_id, current_step, status)
       VALUES ($1, $2, $3, $4, $5, 1, 'pending')
       RETURNING id`,
      [companyId, chainId, entityType, entityId, userId]
    );

    return res.json({ data: { id: rows[0].id, success: true } });
  } catch (error) {
    console.error('Create approval request error:', error);
    return res.status(500).json({ error: 'Failed to create approval request' });
  }
};

const getApprovalRequests = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { status, entityType } = req.query;

    let query = `
      SELECT ar.*, ac.name as chain_name, ac.steps
      FROM approval_requests ar
      JOIN approval_chains ac ON ar.chain_id = ac.id
      WHERE ar.company_id = $1
    `;
    const params = [companyId];

    if (status) {
      query += ` AND ar.status = $${params.length + 1}`;
      params.push(status);
    }

    if (entityType) {
      query += ` AND ar.entity_type = $${params.length + 1}`;
      params.push(entityType);
    }

    query += ` ORDER BY ar.created_at DESC`;

    const { rows } = await db.query(query, params);

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get approval requests error:', error);
    return res.status(500).json({ error: 'Failed to get approval requests' });
  }
};

const approveRequest = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { id } = req.params;
    const { notes } = req.body;

    const { rows: request } = await db.query(
      `SELECT * FROM approval_requests WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (!request.length) {
      return res.status(400).json({ error: 'Request not found' });
    }

    const steps = JSON.parse(request[0].steps || '[]');
    const nextStep = request[0].current_step + 1;

    if (nextStep > steps.length) {
      await db.query(
        `UPDATE approval_requests SET status = 'approved', current_step = $1, completed_at = NOW() WHERE id = $2`,
        [nextStep, id]
      );
    } else {
      await db.query(
        `UPDATE approval_requests SET current_step = $1, notes = COALESCE(notes, '') || ' | Approved by user ' || $2 WHERE id = $3`,
        [nextStep, userId, id]
      );
    }

    return res.json({ success: true, message: 'Request approved' });
  } catch (error) {
    console.error('Approve request error:', error);
    return res.status(500).json({ error: 'Failed to approve request' });
  }
};

const rejectRequest = async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const { id } = req.params;
    const { reason } = req.body;

    await db.query(
      `UPDATE approval_requests SET status = 'rejected', notes = $1, completed_at = NOW() WHERE id = $2 AND company_id = $3`,
      [reason, id, companyId]
    );

    return res.json({ success: true, message: 'Request rejected' });
  } catch (error) {
    console.error('Reject request error:', error);
    return res.status(500).json({ error: 'Failed to reject request' });
  }
};

const createDelegation = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { delegateId, startDate, endDate } = req.body;

    await db.query(
      `INSERT INTO approval_delegations (delegator_id, delegate_id, start_date, end_date)
       VALUES ($1, $2, $3, $4)`,
      [userId, delegateId, startDate, endDate]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Create delegation error:', error);
    return res.status(500).json({ error: 'Failed to create delegation' });
  }
};

const getDelegations = async (req, res) => {
  try {
    const userId = req.user?.id;

    const { rows } = await db.query(
      `SELECT * FROM approval_delegations WHERE delegator_id = $1 OR delegate_id = $1 AND is_active = true`,
      [userId]
    );

    return res.json({ data: rows });
  } catch (error) {
    console.error('Get delegations error:', error);
    return res.status(500).json({ error: 'Failed to get delegations' });
  }
};

module.exports = {
  createApprovalChain,
  getApprovalChains,
  updateApprovalChain,
  createApprovalRequest,
  getApprovalRequests,
  approveRequest,
  rejectRequest,
  createDelegation,
  getDelegations,
};