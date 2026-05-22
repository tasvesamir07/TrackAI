const Sentry = require('@sentry/node');

// Initialize Sentry for error tracking
const initSentry = () => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.warn('[Sentry] SENTRY_DSN not configured - skipping Sentry initialization');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || '1.0.0',
    integrations: [
      // Enable HTTP tracing
      Sentry.httpIntegration(),
      // Enable Express error handling
      Sentry.linkedErrors(),
    ],
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Filter out certain errors
    beforeSend(event, hint) {
      const error = hint.originalException;

      // Don't send expected errors in development
      if (process.env.NODE_ENV !== 'production') {
        return event;
      }

      // Filter out 404s or other expected client errors if needed
      if (event.status === 404) {
        return null;
      }

      return event;
    },
  });

  console.log('[Sentry] Initialized with environment:', process.env.NODE_ENV);
};

// Setup Sentry Express error handler (must be called after all routes are registered)
const setupSentryErrorHandler = (app) => {
  Sentry.setupExpressErrorHandler(app);
};

module.exports = {
  Sentry,
  initSentry,
  setupSentryErrorHandler,
};
