const db = require('../db');

const resetYearlyPaidLeaveBalances = async () => {
    console.log('[Worker] Starting yearly paid leave balance reset...');
    try {
        await db.query('BEGIN');
        
        // Get global paid leave days
        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'paid_leave_days'");
        const days = settingsRes.rows.length > 0 ? parseInt(settingsRes.rows[0].value) : 10;
        
        // Reset for all employees
        await db.query("UPDATE users SET paid_leave_balance = $1 WHERE role = 'employee'", [days]);
        
        await db.query('COMMIT');
        console.log(`[Worker] Successfully reset paid leave balances to ${days} days for all employees.`);
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('[Worker] Failed to reset yearly paid leave balances:', err);
    }
};

module.exports = { resetYearlyPaidLeaveBalances };
