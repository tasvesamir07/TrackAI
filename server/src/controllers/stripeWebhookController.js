const Stripe = require('stripe');
const db = require('../db');

const getStripeClient = () => {
    if (!process.env.STRIPE_SECRET_KEY) {
        return null;
    }
    return new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2024-06-20'
    });
};

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const resolveCheckoutBaseUrl = (req) => {
    const explicitBaseUrl = String(
        process.env.STRIPE_CHECKOUT_BASE_URL ||
        process.env.FRONTEND_URL ||
        process.env.APP_URL ||
        ''
    ).trim();

    if (isHttpUrl(explicitBaseUrl)) {
        return normalizeBaseUrl(explicitBaseUrl);
    }

    const originHeader = String(req.headers.origin || '').trim();
    if (isHttpUrl(originHeader)) {
        return normalizeBaseUrl(originHeader);
    }

    const corsOrigins = String(process.env.CORS_ORIGIN || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(isHttpUrl);

    if (corsOrigins.length > 0) {
        return normalizeBaseUrl(corsOrigins[0]);
    }

    return 'http://localhost:5173';
};

const createCheckoutSession = async (req, res) => {
    const stripe = getStripeClient();
    if (!stripe) {
        return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured' });
    }

    const planCode = String(req.body?.planCode || '').trim().toUpperCase();
    if (!planCode) {
        return res.status(400).json({ error: 'planCode is required' });
    }

    try {
        const planResult = await db.query(
            `SELECT code, name, monthly_price, currency, trial_days
             FROM plans
             WHERE code = $1
               AND is_active = TRUE
             LIMIT 1`,
            [planCode]
        );

        const plan = planResult.rows[0];
        if (!plan) {
            return res.status(404).json({ error: 'Selected plan is not available' });
        }

        const monthlyPrice = Number(plan.monthly_price);
        if (!Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
            return res.status(409).json({ error: `Plan ${plan.code} has invalid monthly price in database` });
        }
        const unitAmount = Math.round(monthlyPrice * 100);
        const currency = String(plan.currency || 'USD').trim().toLowerCase();

        const baseUrl = resolveCheckoutBaseUrl(req);
        const successUrl = `${baseUrl}/signup?plan=${encodeURIComponent(plan.code)}&checkout=success&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${baseUrl}/?checkout=cancel#pricing`;

        const trialDays = Number(plan.trial_days) || 0;
        const subscriptionData = trialDays > 0
            ? {
                trial_period_days: trialDays,
                metadata: { plan_code: plan.code }
            }
            : {
                metadata: { plan_code: plan.code }
            };

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [
                {
                    price_data: {
                        currency,
                        unit_amount: unitAmount,
                        recurring: {
                            interval: 'month'
                        },
                        product_data: {
                            name: `${plan.name || plan.code} Plan`
                        }
                    },
                    quantity: 1
                }
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            billing_address_collection: 'auto',
            metadata: { plan_code: plan.code },
            subscription_data: subscriptionData
        });

        return res.status(201).json({
            sessionId: session.id,
            checkoutUrl: session.url
        });
    } catch (error) {
        console.error('createCheckoutSession error:', error);
        const stripeMessage = String(error?.raw?.message || error?.message || '').trim();
        const stripeStatus = Number(error?.statusCode || 0);
        if (stripeMessage) {
            return res.status(stripeStatus >= 400 && stripeStatus < 600 ? stripeStatus : 500).json({ error: stripeMessage });
        }
        return res.status(500).json({ error: 'Failed to create Stripe checkout session' });
    }
};

const resolvePlanIdByPrice = async (priceId) => {
    if (!priceId) return null;

    const result = await db.query(
        `SELECT id
         FROM plans
         WHERE stripe_price_id = $1
         LIMIT 1`,
        [priceId]
    );

    return result.rows[0]?.id || null;
};

const handleInvoicePaid = async (invoice) => {
    const customerId = invoice.customer || null;
    const subscriptionId = invoice.subscription || null;
    const line = invoice.lines?.data?.[0] || null;
    const priceId = line?.price?.id || null;
    const periodEndUnix = line?.period?.end || null;
    const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
    const mappedPlanId = await resolvePlanIdByPrice(priceId);

    const params = [
        customerId,
        subscriptionId,
        periodEnd,
        mappedPlanId
    ];

    await db.query(
        `UPDATE tenants
         SET
            stripe_customer_id = COALESCE($1, stripe_customer_id),
            stripe_subscription_id = COALESCE($2, stripe_subscription_id),
            current_period_ends_at = COALESCE($3, current_period_ends_at),
            plan_id = COALESCE($4, plan_id),
            subscription_status = 'active',
            last_payment_at = NOW(),
            is_active = TRUE,
            updated_at = NOW()
         WHERE stripe_customer_id = $1
            OR stripe_subscription_id = $2`,
        params
    );
};

const handleSubscriptionDeleted = async (subscription) => {
    const customerId = subscription.customer || null;
    const subscriptionId = subscription.id || null;

    await db.query(
        `UPDATE tenants
         SET
            subscription_status = 'canceled',
            is_active = FALSE,
            updated_at = NOW()
         WHERE stripe_customer_id = $1
            OR stripe_subscription_id = $2`,
        [customerId, subscriptionId]
    );
};

const handleInvoicePaymentFailed = async (invoice) => {
    const customerId = invoice.customer || null;
    const subscriptionId = invoice.subscription || null;

    await db.query(
        `UPDATE tenants
         SET
            subscription_status = 'past_due',
            updated_at = NOW()
         WHERE stripe_customer_id = $1
            OR stripe_subscription_id = $2`,
        [customerId, subscriptionId]
    );
};

const stripeWebhookHandler = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const stripe = getStripeClient();

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' });
    }

    if (!stripe) {
        return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured' });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.error('Stripe signature verification failed:', error.message);
        return res.status(400).json({ error: 'Invalid Stripe webhook signature' });
    }

    try {
        switch (event.type) {
            case 'invoice.paid':
                await handleInvoicePaid(event.data.object);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
                break;
                
            case 'invoice.payment_failed':
                await handleInvoicePaymentFailed(event.data.object);
                break;

            default:
                break;
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error('Stripe webhook handling error:', error);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
};

module.exports = {
    createCheckoutSession,
    stripeWebhookHandler,
    handleInvoicePaid,
    handleSubscriptionDeleted
};
