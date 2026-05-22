
/**
 * Executes a function in the background and catches any errors to prevent them
 * from crashing the process or being unhandled.
 * 
 * @param {Function} fn - The async function to execute.
 */
const runInBackground = (fn) => {
    if (typeof fn !== 'function') return;
    
    Promise.resolve(fn())
        .catch((err) => {
            console.error('[Background] Unhandled error in background task:', err);
        });
};

module.exports = { runInBackground };
