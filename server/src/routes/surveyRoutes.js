const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/authMiddleware');
const auditLogger = require('../utils/auditLogger');

router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, questions, schedule } = req.body;
    const companyId = req.user.company_id;
    const userId = req.user.id;

    if (!title || !questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Title and questions array are required' });
    }

    const result = await db.query(
      `INSERT INTO "PulseSurvey" (company_id, title, questions, schedule, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [companyId, title, JSON.stringify(questions), schedule || null, userId]
    );

    await auditLogger.logAdminAction({
      adminId: userId,
      action: 'CREATE_SURVEY',
      resourceType: 'pulse_survey',
      resourceId: String(result.rows[0].id),
      companyId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating survey:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const { active, limit = 50, offset = 0 } = req.query;

    let query = `SELECT * FROM "PulseSurvey" WHERE company_id = $1`;
    const params = [companyId];

    if (active === 'true') {
      query += ` AND is_active = true`;
    }

    query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    params.push(Number(limit), Number(offset));

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching surveys:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const result = await db.query(
      `SELECT * FROM "PulseSurvey" WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching survey:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, questions, schedule, is_active } = req.body;
    const companyId = req.user.company_id;
    const userId = req.user.id;

    const result = await db.query(
      `UPDATE "PulseSurvey" 
       SET title = COALESCE($1, title),
           questions = COALESCE($2, questions),
           schedule = COALESCE($3, schedule),
           is_active = COALESCE($4, is_active),
           closed_at = CASE WHEN $4 = false THEN NOW() ELSE closed_at END
       WHERE id = $5 AND company_id = $6
       RETURNING *`,
      [title, questions ? JSON.stringify(questions) : null, schedule, is_active, id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    await auditLogger.logAdminAction({
      adminId: userId,
      action: 'UPDATE_SURVEY',
      resourceType: 'pulse_survey',
      resourceId: id,
      companyId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating survey:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;
    const userId = req.user.id;

    const result = await db.query(
      `DELETE FROM "PulseSurvey" WHERE id = $1 AND company_id = $2 RETURNING *`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    await auditLogger.logAdminAction({
      adminId: userId,
      action: 'DELETE_SURVEY',
      resourceType: 'pulse_survey',
      resourceId: id,
      companyId,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({ message: 'Survey deleted successfully' });
  } catch (err) {
    console.error('Error deleting survey:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/respond', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { answers } = req.body;
    const userId = req.user.id;
    const companyId = req.user.company_id;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Answers object is required' });
    }

    const surveyCheck = await db.query(
      `SELECT * FROM "PulseSurvey" WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [id, companyId]
    );

    if (surveyCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Survey not found or inactive' });
    }

    const result = await db.query(
      `INSERT INTO "PulseSurveyResponse" (survey_id, user_id, answers)
       VALUES ($1, $2, $3)
       ON CONFLICT (survey_id, user_id) 
       DO UPDATE SET answers = $3, submitted_at = NOW()
       RETURNING *`,
      [id, userId, JSON.stringify(answers)]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error submitting response:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/responses', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company_id;

    const surveyCheck = await db.query(
      `SELECT id FROM "PulseSurvey" WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (surveyCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const result = await db.query(
      `SELECT psr.*, u.username, u.full_name 
       FROM "PulseSurveyResponse" psr
       JOIN users u ON psr.user_id = u.id
       WHERE psr.survey_id = $1
       ORDER BY psr.submitted_at DESC`,
      [id]
    );

    const responses = result.rows;
    const totalResponses = responses.length;
    
    const answers = responses.map(r => r.answers);
    const aggregated = {};
    
    answers.forEach(response => {
      Object.entries(response).forEach(([question, answer]) => {
        if (!aggregated[question]) {
          aggregated[question] = { total: 0, sum: 0, values: [] };
        }
        aggregated[question].total++;
        if (typeof answer === 'number') {
          aggregated[question].sum += answer;
        }
        aggregated[question].values.push(answer);
      });
    });

    const summary = Object.entries(aggregated).map(([question, data]) => ({
      question,
      responseCount: data.total,
      average: data.total > 0 && typeof data.values[0] === 'number' 
        ? Math.round((data.sum / data.total) * 10) / 10 
        : null,
      sampleResponses: data.values.slice(0, 5)
    }));

    res.json({
      totalResponses,
      responses,
      summary
    });
  } catch (err) {
    console.error('Error fetching responses:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my/pending', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.company_id;

    const result = await db.query(
      `SELECT ps.*, 
              CASE WHEN psr.id IS NOT NULL THEN true ELSE false END as responded
       FROM "PulseSurvey" ps
       LEFT JOIN "PulseSurveyResponse" psr ON ps.id = psr.survey_id AND psr.user_id = $1
       WHERE ps.company_id = $2 AND ps.is_active = true
       ORDER BY ps.created_at DESC`,
      [userId, companyId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending surveys:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;