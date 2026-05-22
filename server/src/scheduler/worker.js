const { Worker } = require('bullmq');
const { connection } = require('./queue');
const { terminateInactiveUsersWithAssignedTasks } = require('./inactivityTerminationTask');
const { resetYearlyPaidLeaveBalances } = require('./leaveBalanceResetTask');

const startWorkers = () => {
    console.log('[Worker] Starting BullMQ background workers...');

    new Worker('inactivityTermination', async (job) => {
        console.log('[Worker] Executing inactivity termination job...', job.id);
        await terminateInactiveUsersWithAssignedTasks();
    }, { connection });

    new Worker('leaveBalanceReset', async (job) => {
        console.log('[Worker] Executing leave balance reset job...', job.id);
        await resetYearlyPaidLeaveBalances();
    }, { connection });
};

module.exports = { startWorkers };
