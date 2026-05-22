const jwt = require('jsonwebtoken');
const { RoleUtils, normalizeRole, hasRole } = require('../utils/roleUtils');

const normalizePem = (value) => String(value || '').replace(/\\n/g, '\n').trim();

const decodeJwtHeader = (token) => {
    try {
        const [headerB64] = String(token || '').split('.');
        if (!headerB64) return null;
        const raw = Buffer.from(headerB64, 'base64url').toString('utf8');
        return JSON.parse(raw);
    } catch (_err) {
        return null;
    }
};

const mapSupabaseClaimsToUser = (claims) => {
    const rawId = claims?.user_id ?? claims?.app_metadata?.user_id ?? claims?.sub;
    const numericId = Number.parseInt(String(rawId || ''), 10);
    if (!Number.isFinite(numericId)) return null;

    const role = claims?.role || claims?.app_metadata?.role || 'employee';
    const usernameFallback = String(claims?.email || '').split('@')[0] || `user_${numericId}`;

    return {
        id: numericId,
        role,
        username: claims?.user_metadata?.username || usernameFallback,
        email: claims?.email || null,
        company_id: claims?.company_id || claims?.app_metadata?.company_id || null,
        auth_provider: 'supabase',
        supabase_claims: claims
    };
};

const verifySupabaseTokenOffline = (token) => {
    const header = decodeJwtHeader(token);
    const alg = String(header?.alg || '').toUpperCase();
    if (!alg) return null;

    let decoded = null;
    const supabaseAlg = process.env.SUPABASE_JWT_ALG || 'HS256';
    if (alg !== supabaseAlg) return null;

    if (alg === 'HS256') {
        const hsSecret = process.env.SUPABASE_JWT_SECRET || process.env.GOTRUE_JWT_SECRET || '';
        if (!hsSecret) return null;
        decoded = jwt.verify(token, hsSecret, { algorithms: ['HS256'] });
    } else if (alg === 'RS256') {
        const publicKey = normalizePem(process.env.SUPABASE_JWT_PUBLIC_KEY || process.env.SUPABASE_AUTH_JWT_PUBLIC_KEY || '');
        if (!publicKey) return null;
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    } else if (alg === 'ES256') {
        const publicKey = normalizePem(process.env.SUPABASE_JWT_PUBLIC_KEY || process.env.SUPABASE_AUTH_JWT_PUBLIC_KEY || '');
        if (!publicKey) return null;
        decoded = jwt.verify(token, publicKey, { algorithms: ['ES256'] });
    } else {
        return null;
    }

    return mapSupabaseClaimsToUser(decoded);
};

const getRequestToken = (req) => {
    const authHeader = String(req.headers?.authorization || '').trim();
    if (authHeader.toLowerCase().startsWith('bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken) return bearerToken;
    }

    const cookieToken = req.cookies?.token;
    if (cookieToken) return cookieToken;

    return null;
};

const verifyToken = (req, res, next) => {
    const token = getRequestToken(req);

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        next();
    } catch (error) {
        try {
            const supabaseUser = verifySupabaseTokenOffline(token);
            if (!supabaseUser) {
                return res.status(401).json({ error: 'Invalid token.' });
            }
            req.user = supabaseUser;
            return next();
        } catch (_supabaseError) {
            return res.status(401).json({ error: 'Invalid token.' });
        }
    }
};

const hasAnyRole = (req, roles) => hasRole(req.user?.role, roles);
const hasAnyNormalizedRole = (req, roles) => roles.map(r => normalizeRole(r)).includes(normalizeRole(req.user?.role));

const isAdmin = (req, res, next) => {
    if (!RoleUtils.isAdmin(req.user?.role)) {
        return res.status(403).json({ error: 'Access denied. Admins only.' });
    }
    next();
};

const isAdminOrModerator = (req, res, next) => {
    if (!RoleUtils.isManager(req.user?.role)) {
        return res.status(403).json({ error: 'Access denied. Admins or managers only.' });
    }
    next();
};

const isUserDirectoryViewer = (req, res, next) => {
    if (!req.user?.role) {
        return res.status(403).json({ error: 'Access denied.' });
    }
    next();
};

const isUserDirectoryDetailsViewer = (req, res, next) => {
    if (!RoleUtils.isManager(req.user?.role) && !RoleUtils.isEmployee(req.user?.role)) {
        return res.status(403).json({ error: 'Access denied.' });
    }
    next();
};

// WARNING: verifySession is for OPTIONAL authentication only.
// It sets req.user = null on failure and calls next().
// Routes using this middleware MUST check req.user before accessing user data.
const verifySession = (req, res, next) => {
    const token = getRequestToken(req);
    if (!token) {
        req.user = null;
        return next();
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
    } catch (error) {
        try {
            req.user = verifySupabaseTokenOffline(token);
        } catch (_supabaseError) {
            req.user = null;
        }
    }
    next();
};

module.exports = {
    verifyToken,
    isAdmin,
    isAdminOrModerator,
    isUserDirectoryViewer,
    isUserDirectoryDetailsViewer,
    verifySession
};
