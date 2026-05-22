const fs = require('fs');
const path = require('path');
const db = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const runMigrations = async () => {
    console.log('[Migrations] Starting automatic migration runner...');

    try {
        if (!fs.existsSync(MIGRATIONS_DIR)) {
            console.log('[Migrations] No migrations directory found, skipping.');
            return;
        }

        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort();

        console.log(`[Migrations] Found ${files.length} migration files.`);

        for (const file of files) {
            const filePath = path.join(MIGRATIONS_DIR, file);
            const sql = fs.readFileSync(filePath, 'utf8');

            console.log(`[Migrations] Running: ${file}`);
            try {
                await db.query(sql);
                console.log(`[Migrations] ✓ ${file}`);
            } catch (err) {
                if (err.message.includes('already exists') || err.code === '42P07') {
                    console.log(`[Migrations] ⊘ ${file} (already exists)`);
                } else {
                    console.error(`[Migrations] ✗ ${file}: ${err.message}`);
                }
            }
        }

        console.log('[Migrations] All migrations complete.');
    } catch (err) {
        console.error('[Migrations] Fatal error:', err);
    }
};

if (require.main === module) {
    runMigrations().then(() => process.exit(0)).catch(e => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = runMigrations;