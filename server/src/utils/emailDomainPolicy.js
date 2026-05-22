const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_EMAIL_DOMAIN_POLICY = {
    mode: 'all',
    allowedDomains: []
};

const createPolicyError = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'EMAIL_DOMAIN_POLICY';
    return error;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const isValidEmail = (value) => EMAIL_REGEX.test(normalizeEmail(value));

const normalizeEmailDomainMode = (value) => (
    String(value || '').trim().toLowerCase() === 'allowlist' ? 'allowlist' : 'all'
);

const normalizeDomainSuffix = (value) => {
    let domain = String(value || '').trim().toLowerCase();
    if (!domain) return '';

    if (domain.startsWith('@')) domain = domain.slice(1);
    if (domain.startsWith('*.')) domain = domain.slice(2);
    domain = domain.replace(/\.+$/g, '');

    if (!domain.includes('.')) return '';
    if (domain.includes('..')) return '';
    if (!/^[a-z0-9.-]+$/.test(domain)) return '';

    const labels = domain.split('.');
    if (labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))) return '';

    return domain;
};

const parseAllowedEmailDomains = (rawValue) => {
    const values = Array.isArray(rawValue)
        ? rawValue
        : String(rawValue || '').split(',');

    const normalized = values
        .map((value) => normalizeDomainSuffix(value))
        .filter(Boolean);

    return Array.from(new Set(normalized));
};

const buildEmailDomainPolicyFromConfig = (config = {}) => {
    const mode = normalizeEmailDomainMode(config.emailDomainMode);
    const allowedDomains = parseAllowedEmailDomains(config.allowedEmailDomains);
    return { mode, allowedDomains };
};

const extractEmailDomain = (email) => {
    const normalized = normalizeEmail(email);
    const atIndex = normalized.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === normalized.length - 1) return '';
    return normalized.slice(atIndex + 1);
};

const isEmailAllowedByPolicy = (email, policy = DEFAULT_EMAIL_DOMAIN_POLICY) => {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) return false;

    const normalizedPolicy = {
        mode: normalizeEmailDomainMode(policy.mode),
        allowedDomains: parseAllowedEmailDomains(policy.allowedDomains)
    };

    if (normalizedPolicy.mode === 'all') return true;
    if (normalizedPolicy.allowedDomains.length === 0) return false;

    const domain = extractEmailDomain(normalizedEmail);
    if (!domain) return false;

    return normalizedPolicy.allowedDomains.some((allowedDomain) => (
        domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
    ));
};

const assertEmailAllowedByPolicy = (email, policy, label = 'Email') => {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
        throw createPolicyError(`${label} is invalid`);
    }

    const normalizedPolicy = {
        mode: normalizeEmailDomainMode(policy?.mode),
        allowedDomains: parseAllowedEmailDomains(policy?.allowedDomains)
    };

    if (normalizedPolicy.mode === 'all') return normalizedEmail;

    if (normalizedPolicy.allowedDomains.length === 0) {
        throw createPolicyError('Email restriction is enabled but no allowed domain endings are configured');
    }

    if (!isEmailAllowedByPolicy(normalizedEmail, normalizedPolicy)) {
        throw createPolicyError(
            `${label} must end with one of: ${normalizedPolicy.allowedDomains.map((domain) => `@${domain}`).join(', ')}`
        );
    }

    return normalizedEmail;
};

const loadEmailDomainPolicy = async (queryable, companyId = null) => {
    try {
        const result = await queryable.query(
            `SELECT value
             FROM settings
             WHERE key = 'admin_notification_settings'
               AND (company_id = $1::uuid OR company_id IS NULL)
             ORDER BY CASE WHEN company_id = $1::uuid THEN 0 ELSE 1 END
             LIMIT 1`,
            [companyId]
        );
        if (result.rows.length === 0) return { ...DEFAULT_EMAIL_DOMAIN_POLICY };

        const config = JSON.parse(result.rows[0].value || '{}');
        return buildEmailDomainPolicyFromConfig(config);
    } catch (_err) {
        return { ...DEFAULT_EMAIL_DOMAIN_POLICY };
    }
};

module.exports = {
    DEFAULT_EMAIL_DOMAIN_POLICY,
    normalizeEmail,
    isValidEmail,
    normalizeEmailDomainMode,
    parseAllowedEmailDomains,
    buildEmailDomainPolicyFromConfig,
    isEmailAllowedByPolicy,
    assertEmailAllowedByPolicy,
    loadEmailDomainPolicy
};
