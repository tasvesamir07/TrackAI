const toMs = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : null;
};

const evaluateTenantAccess = (tenant = {}, now = new Date()) => {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const tenantActive = Boolean(tenant.tenant_active ?? tenant.is_active ?? true);
    const unlimitedAccess = Boolean(tenant.unlimited_access);
    const status = String(tenant.subscription_status || '').trim().toLowerCase();
    const trialEndsAtMs = toMs(tenant.trial_ends_at);
    const currentPeriodEndsAtMs = toMs(tenant.current_period_ends_at);

    if (!tenantActive) {
        return {
            allowed: false,
            reason: 'tenant_blocked',
            message: 'Your company account is blocked. Please contact support.',
            trialEndsAtMs,
            currentPeriodEndsAtMs
        };
    }

    if (unlimitedAccess) {
        return {
            allowed: true,
            reason: null,
            message: null,
            trialEndsAtMs,
            currentPeriodEndsAtMs
        };
    }

    if (status === 'trialing' && trialEndsAtMs !== null && nowMs >= trialEndsAtMs) {
        return {
            allowed: false,
            reason: 'trial_expired',
            message: 'Your trial has expired. Please upgrade your subscription.',
            trialEndsAtMs,
            currentPeriodEndsAtMs
        };
    }

    if (status === 'active' && currentPeriodEndsAtMs !== null && nowMs >= currentPeriodEndsAtMs) {
        return {
            allowed: false,
            reason: 'subscription_expired',
            message: 'Your subscription has expired. Please renew to continue.',
            trialEndsAtMs,
            currentPeriodEndsAtMs
        };
    }

    if (status === 'canceled') {
        return {
            allowed: false,
            reason: 'subscription_canceled',
            message: 'Your company subscription is inactive. Please contact support.',
            trialEndsAtMs,
            currentPeriodEndsAtMs
        };
    }

    return {
        allowed: true,
        reason: null,
        message: null,
        trialEndsAtMs,
        currentPeriodEndsAtMs
    };
};

module.exports = {
    evaluateTenantAccess,
    toMs
};

