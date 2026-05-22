const { Pool } = require('pg');
const dns = require('node:dns');
const net = require('node:net');
require('dotenv').config();

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const connectionStringCandidates = [
    ['SUPABASE_DB_POOL_URL', process.env.SUPABASE_DB_POOL_URL],
    ['SUPABASE_PGBOUNCER_URL', process.env.SUPABASE_PGBOUNCER_URL],
    ['DATABASE_POOL_URL', process.env.DATABASE_POOL_URL],
    ['PGBOUNCER_DATABASE_URL', process.env.PGBOUNCER_DATABASE_URL],
    ['DATABASE_URL_IPV4', process.env.DATABASE_URL_IPV4],
    ['POSTGRES_URL_IPV4', process.env.POSTGRES_URL_IPV4],
    ['PGURL_IPV4', process.env.PGURL_IPV4],
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['POSTGRES_URL', process.env.POSTGRES_URL],
    ['PGURL', process.env.PGURL]
];

const selectedCandidate = connectionStringCandidates.find(([, value]) => Boolean(value)) || null;
const selectedConnectionStringSource = selectedCandidate ? selectedCandidate[0] : null;
const primaryConnectionStringFromEnv = selectedCandidate ? selectedCandidate[1] : null;

const ipv4HostOverride =
    process.env.DB_HOST_IPV4 ||
    process.env.PGHOST_IPV4 ||
    process.env.DB_IPV4_HOST ||
    null;

const applyHostOverrideToConnectionString = (value, overrideHost) => {
    if (!value || !overrideHost) return value;
    try {
        const parsed = new URL(value);
        parsed.hostname = overrideHost;
        return parsed.toString();
    } catch (err) {
        console.warn('[Database] Failed to parse connection string for host override. Using original value.');
        return value;
    }
};

const preferIpv6 = isTruthy(process.env.DB_PREFER_IPV6) || isTruthy(process.env.PG_PREFER_IPV6);
const forceIpv4 = !preferIpv6 && (
    isTruthy(process.env.DB_FORCE_IPV4) ||
    isTruthy(process.env.PG_FORCE_IPV4) ||
    process.env.NODE_ENV === 'production'
);

const selectedConnectionString = primaryConnectionStringFromEnv;

const connectionString = applyHostOverrideToConnectionString(selectedConnectionString, ipv4HostOverride);

const getConnectionHostname = (value) => {
    if (!value) return null;
    try {
        return new URL(value).hostname;
    } catch {
        return null;
    }
};

const ipv4Lookup = (hostname, options, callback) => {
    const normalizedOptions = typeof options === 'function' ? {} : (options || {});
    const cb = typeof options === 'function' ? options : callback;
    return dns.lookup(hostname, { ...normalizedOptions, family: 4, all: false }, cb);
};

const connectionHostname = getConnectionHostname(connectionString);
if (connectionHostname) {
    console.log(`[Database] Using ${selectedConnectionStringSource} host: ${connectionHostname}`);
}
if (forceIpv4 && connectionHostname && net.isIP(connectionHostname) === 6 && !ipv4HostOverride) {
    console.warn('[Database] Force IPv4 is enabled but DATABASE_URL host is an IPv6 literal. Set DB_HOST_IPV4 or DATABASE_URL_IPV4.');
}

const getConnectionPort = (value) => {
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (parsed.port) return Number.parseInt(parsed.port, 10);
        return parsed.protocol.startsWith('postgres') ? 5432 : null;
    } catch {
        return null;
    }
};

const connectionPort = getConnectionPort(connectionString);
const isSupabaseHost = Boolean(connectionHostname && connectionHostname.includes('.supabase.co'));
if (isSupabaseHost && connectionPort === 5432) {
    console.warn('[Database] Supabase direct DB port (5432) detected. Prefer PgBouncer pooler port (usually 6543) for better performance.');
}

const useSsl =
    process.env.DB_SSL === 'true' ||
    process.env.PGSSLMODE === 'require' ||
    Boolean(connectionString);

const sslRejectUnauthorizedEnv = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase();
const sslRejectUnauthorized =
    sslRejectUnauthorizedEnv === ''
        ? false
        : ['1', 'true', 'yes', 'on'].includes(sslRejectUnauthorizedEnv);

const poolMax = Number.parseInt(String(process.env.DB_POOL_MAX || process.env.PGPOOL_MAX || '20'), 10);
const poolMin = Number.parseInt(String(process.env.DB_POOL_MIN || process.env.PGPOOL_MIN || '2'), 10);
const idleTimeoutMillis = Number.parseInt(String(process.env.DB_IDLE_TIMEOUT_MS || '30000'), 10);
const connectionTimeoutMillis = Number.parseInt(String(process.env.DB_CONNECT_TIMEOUT_MS || '5000'), 10);

const baseConfig = {
    ssl: useSsl ? { rejectUnauthorized: sslRejectUnauthorized } : false,
    ...(forceIpv4 ? { lookup: ipv4Lookup } : {}),
    max: Number.isFinite(poolMax) ? poolMax : 20,
    min: Number.isFinite(poolMin) ? poolMin : 2,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? idleTimeoutMillis : 30000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) ? connectionTimeoutMillis : 5000,
    keepAlive: true
};

const pool = connectionString
    ? new Pool({
        ...baseConfig,
        connectionString
    })
    : new Pool({
        ...baseConfig,
        user: process.env.DB_USER || process.env.PGUSER,
        password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
        host: ipv4HostOverride || process.env.DB_HOST || process.env.PGHOST || '127.0.0.1',
        port: process.env.DB_PORT || process.env.PGPORT || 5432,
        database: process.env.DB_DATABASE || process.env.PGDATABASE
    });

// Log pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

module.exports = {
    query: async (text, params) => {
        try {
            return await pool.query(text, params);
        } catch (err) {
            console.error('Database Query Error:', err.message);
            if (process.env.NODE_ENV !== 'production') {
                console.error('Query Text:', text);
            }
            throw err;
        }
    },
    getClient: () => pool.connect(),
};
