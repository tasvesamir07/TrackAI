const db = require('../db');

const getReferralCode = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    let { rows } = await db.query(
      `SELECT referral_code FROM tenants WHERE id = $1`,
      [companyId]
    );

    if (!rows[0]?.referral_code) {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      await db.query(
        `UPDATE tenants SET referral_code = $1 WHERE id = $2`,
        [code, companyId]
      );
      return res.json({ data: { referralCode: code } });
    }

    return res.json({ data: { referralCode: rows[0].referral_code } });
  } catch (error) {
    console.error('Get referral code error:', error);
    return res.status(500).json({ error: 'Failed to get referral code' });
  }
};

const registerWithReferral = async (req, res) => {
  try {
    const { referralCode, companyName, email, password } = req.body;

    const { rows: referrer } = await db.query(
      `SELECT id FROM tenants WHERE referral_code = $1`,
      [referralCode]
    );

    if (!referrer.length) {
      return res.status(400).json({ error: 'Invalid referral code' });
    }

    const { rows: newTenant } = await db.query(
      `INSERT INTO tenants (name, email) VALUES ($1, $2) RETURNING id`,
      [companyName, email]
    );

    await db.query(
      `INSERT INTO referrals (referrer_company_id, referred_company_id, status)
       VALUES ($1, $2, 'completed')`,
      [referrer[0].id, newTenant[0].id]
    );

    return res.json({ 
      success: true, 
      message: 'Registration successful! Referrer will receive reward.',
      tenantId: newTenant[0].id 
    });
  } catch (error) {
    console.error('Register with referral error:', error);
    return res.status(500).json({ error: 'Failed to register with referral' });
  }
};

const getReferralStats = async (req, res) => {
  try {
    const companyId = req.user?.company_id;

    const { rows } = await db.query(
      `SELECT r.*, t.name as referred_company_name
       FROM referrals r
       LEFT JOIN tenants t ON r.referred_company_id = t.id
       WHERE r.referrer_company_id = $1
       ORDER BY r.created_at DESC`,
      [companyId]
    );

    const totalReferrals = rows.length;
    const successfulReferrals = rows.filter(r => r.status === 'completed').length;

    return res.json({ 
      data: { 
        referrals: rows,
        totalReferrals,
        successfulReferrals,
        rewardMonths: successfulReferrals
      } 
    });
  } catch (error) {
    console.error('Get referral stats error:', error);
    return res.status(500).json({ error: 'Failed to get referral stats' });
  }
};

module.exports = {
  getReferralCode,
  registerWithReferral,
  getReferralStats
};