const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { isSupabaseStorageEnabled, isSupabaseBucketPublic, getPublicUrlForRelativeUrl, getSignedUrlForRelativeUrl, getStorageRuntimeInfo, ensureStorageFolderMarkers } = require('./utils/storageService');

// Load environment variables with an absolute path to ensure they are found regardless of where the app is started from
const envResult = dotenv.config({
    path: path.join(__dirname, '../.env'),
    quiet: process.env.NODE_ENV === 'production'
});

if (envResult.error) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn('[Environment] Warning: .env file not found at expected path. Using system environment variables.');
    }
}

// Normalize DB URL aliases so Railway setups using DATABASE_URL_IPV4 work out-of-the-box.
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
        process.env.DATABASE_URL_IPV4 ||
        process.env.POSTGRES_URL ||
        process.env.POSTGRES_URL_IPV4 ||
        process.env.PGURL ||
        process.env.PGURL_IPV4 ||
        '';
}

process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Process] Uncaught Exception:', error);
});

// Critical Environment Validation
const REQUIRED_VARS = ['JWT_SECRET'];
const missingVars = REQUIRED_VARS.filter(v => !process.env[v]);

// Database check (supports DATABASE_URL variants and discrete PG/DB vars)
const hasDatabaseString = Boolean(
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PGURL ||
    process.env.DATABASE_URL_IPV4 ||
    process.env.POSTGRES_URL_IPV4 ||
    process.env.PGURL_IPV4
);
if (!hasDatabaseString && !process.env.DB_DATABASE && !process.env.PGDATABASE) {
    const presentDbKeys = [
        'DATABASE_URL',
        'DATABASE_URL_IPV4',
        'POSTGRES_URL',
        'POSTGRES_URL_IPV4',
        'PGURL',
        'PGURL_IPV4',
        'DB_DATABASE',
        'PGDATABASE'
    ].filter((key) => Boolean(process.env[key]));

    console.error('[Environment] Present DB env keys:', presentDbKeys.length ? presentDbKeys.join(', ') : '(none)');
    missingVars.push('DATABASE_URL / DATABASE_URL_IPV4 (or DB_DATABASE / PGDATABASE)');
}

if (missingVars.length > 0) {
    console.error('[Environment] Missing/invalid required environment variables:', missingVars.join(', '));
    console.error('[Environment] Continuing startup so /health stays available. API routes depending on these vars may fail until fixed.');
}

const encryptionKey = (process.env.MESSAGE_ENCRYPTION_KEY || '').trim();
if (!encryptionKey) {
    console.warn('[Environment] MESSAGE_ENCRYPTION_KEY is not set. Chat message encryption will be disabled.');
} else if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
    console.warn('[Environment] MESSAGE_ENCRYPTION_KEY is invalid (must be 64 hex chars). Chat message encryption will be disabled.');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const db = require('./db');
const { initDb } = require('./db/init');
const { setupSocket } = require('./socket');

// Sentry - Error tracking
const { initSentry, setupSentryErrorHandler } = require('./utils/sentry');
initSentry();

// Session with Redis support
const { createRedisClient, getSessionConfig } = require('./utils/session');
const redisClient = createRedisClient();

// Swagger API docs
const { setupSwagger } = require('./utils/swagger');

const app = express();
const PORT = Number(process.env.PORT || process.env.RAILWAY_PUBLIC_PORT || 8080);

const parseTrustProxy = (rawValue) => {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
        return process.env.NODE_ENV === 'production' ? 1 : false;
    }

    const normalized = String(rawValue).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return 1;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;

    const numericValue = Number(normalized);
    if (Number.isInteger(numericValue) && numericValue >= 0) return numericValue;

    // Allow full Express trust proxy values (e.g. loopback, linklocal, uniquelocal, subnet list)
    return rawValue;
};

app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// Keep liveness checks dependency-light and fast for platform health probes.
// This route is intentionally registered before middleware that can depend on Redis/DB.
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'ok'
    });
});

// Optional readiness endpoint with dependency checks (safe for manual/ops checks).
app.get('/ready', async (_req, res) => {
    let dbStatus = 'unknown';
    try {
        await db.query('SELECT 1');
        dbStatus = 'connected';
    } catch (_err) {
        dbStatus = 'disconnected';
    }

const ready = dbStatus === 'connected';
    return res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'degraded',
        timestamp: new Date().toISOString(),
        database: dbStatus
    });
});

// Metrics endpoint (Prometheus format)
const metrics = require('./utils/metrics');
const metricsAuth = (req, res, next) => {
    const metricsToken = process.env.METRICS_TOKEN;
    if (!metricsToken) {
        return res.status(403).json({ error: 'Metrics endpoint disabled' });
    }
    const providedToken = req.headers['x-metrics-token'];
    if (providedToken !== metricsToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.get('/metrics', metricsAuth, (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.getMetrics());
});

app.get('/metrics/json', metricsAuth, (_req, res) => {
    res.json({
        application: metrics.getMetricsJSON(),
        process: metrics.getProcessMetrics()
    });
});

const timeService = require('./utils/timeService');
const emailService = require('./utils/emailService');
const { ensureConfigured: ensureWebPushConfigured } = require('./utils/webPushService');

// Initialize Time Service
timeService.init();

// Security Middleware
const helmetConfig = {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "https://*.stream-io-api.com", "wss://*.stream-io-api.com", "ws:", "wss:", "https:"],
            fontSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'self'", "https://*.stream-io-api.com"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "blob:"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: process.env.NODE_ENV === 'production' ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false,
            frameguard: {
                action: 'sameorigin'
            },
            frameAncestors: ["'self'"],
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
};

app.use(helmet(helmetConfig));

// Middleware
// Support multiple origins for local development and production
const normalizeOrigin = (origin) => (origin || '').trim().replace(/\/+$/, '');
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(normalizeOrigin).filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:3000'];

const isRailwayPreviewOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(String(origin || ''));

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        const normalizedOrigin = normalizeOrigin(origin);
        const allowAll = allowedOrigins.includes('*');

        if (allowAll && process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else if (allowedOrigins.includes(normalizedOrigin)) {
            callback(null, true);
        } else {
            if (process.env.NODE_ENV !== 'production') {
                console.log('CORS Blocked:', normalizedOrigin, 'Allowed:', allowedOrigins);
            }
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Debug logging - only in development
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        if (req.url.includes('/api/auth')) {
            console.log(`[DEBUG] ${req.method} ${req.url} from ${req.headers.origin || 'no-origin'}`);
        }
        next();
    });
}

// Stripe webhook must be registered before express.json() to keep raw request body.
const stripeWebhookRoutes = require('./routes/stripeWebhookRoutes');
app.use('/api/billing/stripe', stripeWebhookRoutes);

app.use(express.json({ limit: '10mb' }));

// Enhanced compression with Brotli support
const crypto = require('crypto');
app.use(compression({
  threshold: 1024,
  level: 6,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// ETag middleware for API cache validation
app.use('/api', (req, res, next) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  res.send = function(body) {
    if (req.method === 'GET' && res.statusCode >= 200 && res.statusCode < 300 && body) {
      const etag = `"${crypto.createHash('sha256').update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex').substring(0, 16)}"`;
      res.set('ETag', etag);
      
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
    }
    return originalSend.call(this, body);
  };
  
  res.json = function(data) {
    if (req.method === 'GET' && res.statusCode >= 200 && res.statusCode < 300 && data) {
      const etag = `"${crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').substring(0, 16)}"`;
      res.set('ETag', etag);
      
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
    }
    return originalJson.call(this, data);
  };
  
  next();
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session middleware with Redis
app.use(session(getSessionConfig(redisClient)));

app.use(cookieParser());

// Global rate limiting
const { apiLimiter } = require('./middleware/rateLimiter');
const { dashboardCache, userListCache, settingsCache, holidaysCache, cacheInvalidator } = require('./middleware/cacheMiddleware');
app.use('/api', apiLimiter);

// Request Logger for debugging
// app.use((req, res, next) => {
//     if (req.url.startsWith('/api/tasks')) {
//         console.log(`[Request] ${req.method} ${req.url} - Content-Type: ${req.headers['content-type']}`);
//     }
//     next();
// });

// Disable caching for API routes only (do not disable media/static caching).
app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
});

// API Routes
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

const searchRoutes = require('./routes/searchRoutes');
app.use('/api/search', searchRoutes);

const settingsRoutes = require('./routes/settingsRoutes');
app.use('/api/settings', settingsCache, cacheInvalidator, settingsRoutes);

// Request analytics logging (captures path/IP/geo/user metadata for geo map + traffic analytics)
const { logRequest } = require('./controllers/trackingController');
const { verifySession } = require('./middleware/authMiddleware');
app.use('/api', verifySession, logRequest);

const trackingRoutes = require('./routes/trackingRoutes');
app.use('/api/tracking', trackingRoutes);

const loadTestRoutes = require('./routes/loadTestRoutes');
app.use('/api/loadtest', loadTestRoutes);

const securityRoutes = require('./routes/securityRoutes');
app.use('/api/security', securityRoutes);

const onboardingRoutes = require('./routes/onboardingRoutes');
app.use('/api/onboarding', onboardingRoutes);

const workflowRoutes = require('./routes/workflowRoutes');
app.use('/api/workflow', workflowRoutes);

const attendanceRoutes = require('./routes/attendanceRoutes');
app.use('/api/attendance', attendanceRoutes);

const payrollRoutes = require('./routes/payrollRoutes');
app.use('/api/payroll', payrollRoutes);

const complianceRoutes = require('./routes/complianceRoutes');
app.use('/api/compliance', complianceRoutes);

const aiRoutes = require('./routes/aiRoutes');
app.use('/api/ai', aiRoutes);

const integrationRoutes = require('./routes/integrationRoutes');
app.use('/api/integrations', integrationRoutes);

const salesRoutes = require('./routes/salesRoutes');
app.use('/api/sales', salesRoutes);

const enterpriseRoutes = require('./routes/enterpriseRoutes');
app.use('/api/enterprise', enterpriseRoutes);

const referralRoutes = require('./routes/referralRoutes');
app.use('/api/referrals', referralRoutes);

const saasAuthRoutes = require('./routes/saasAuthRoutes');
app.use('/api/saas/auth', saasAuthRoutes);

const tenantUserRoutes = require('./routes/tenantUserRoutes');
app.use('/api/saas/company', tenantUserRoutes);

const superadminRoutes = require('./routes/superadminRoutes');
app.use('/api/superadmin', superadminRoutes);

const taskRoutes = require('./routes/taskRoutes');
app.use('/api/tasks', taskRoutes);

const projectRoutes = require('./routes/projectRoutes');
app.use('/api/projects', projectRoutes);

const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', dashboardCache, userListCache, settingsCache, cacheInvalidator, adminRoutes);

const devRoutes = require('./routes/devRoutes');
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev', devRoutes);
}

const chatRoutes = require('./routes/chatRoutes');
app.use('/api/chat', chatRoutes);

const activityRoutes = require('./routes/activityRoutes');
app.use('/api/activity', activityRoutes);

const leaveRoutes = require('./routes/leaveRoutes');
app.use('/api/leaves', leaveRoutes);

const whatsappRoutes = require('./routes/whatsappRoutes');
app.use('/api/whatsapp', whatsappRoutes);

const telegramRoutes = require('./routes/telegramRoutes');
app.use('/api/telegram', telegramRoutes);

const nylasRoutes = require('./routes/nylasRoutes');
app.use('/api/v1/nylas', nylasRoutes);
app.use('/api/nylas', nylasRoutes);

const uploadRoutes = require('./routes/uploadRoutes');
app.use('/api/uploads', uploadRoutes);

const permissionRoutes = require('./routes/permissionRoutes');
app.use('/api/permissions', permissionRoutes);

const surveyRoutes = require('./routes/surveyRoutes');
app.use('/api/surveys', surveyRoutes);



// Swagger API documentation
setupSwagger(app);

// Initialize tables and run migrations
const runMigrations = require('./db/runMigrations');

initDb().then(async () => {
    console.log('[Startup] Core tables initialized, running migrations...');

    await runMigrations();

    // Initialize email service with DB settings after tables are ready
    emailService.initEmailService();

    // Apply non-destructive performance indexes.
    const applyIndexes = require('./db/applyIndexes');
    applyIndexes().catch((indexErr) => {
        console.error('[Startup] Failed to apply performance indexes:', indexErr);
    });
}).catch((err) => {
    console.error('[Startup] Database initialization failed:', err);
});

// Initialize scheduler later after server start

// For legacy/missing profile images on ephemeral storage, return a tiny transparent GIF
// instead of a blocked 404. This applies only to root-level /uploads/<filename> image paths.
const transparentGif1x1 = Buffer.from('R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64');
app.get('/uploads/:filename', (req, res, next) => {
    try {
        if (isSupabaseStorageEnabled()) {
            return next();
        }


        const filename = req.params.filename || '';
        if (!filename || filename.includes('/') || filename.includes('\\')) {
            return next();
        }

        const lower = filename.toLowerCase();
        const isImage = lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp') || lower.endsWith('.gif');
        if (!isImage) {
            return next();
        }

        const absolutePath = path.join(__dirname, '../uploads', filename);
        if (fs.existsSync(absolutePath)) {
            return next();
        }

        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        return res.status(200).send(transparentGif1x1);
    } catch (_err) {
        return next();
    }
});

// Serve uploads folder
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.mov') || filePath.endsWith('.MOV')) {
            res.setHeader('Content-Type', 'video/mp4'); // Trick browser to treat MOV as MP4 if container allows, or strict video/quicktime
            // Actually, video/mp4 is safer for chrome to attempt playback.
            // But let's stick to standard first:
            // res.setHeader('Content-Type', 'video/quicktime');
        }
        // Uploaded files use unique names, so browser caching is safe and improves mobile load time.
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
}));

// Supabase Storage fallback for environments where local disk is ephemeral (e.g., Railway).
app.get(/^\/uploads\/.+$/, async (req, res, next) => {
    if (!isSupabaseStorageEnabled()) {
        return next();
    }

    if (isSupabaseBucketPublic()) {
        const publicUrl = getPublicUrlForRelativeUrl(req.path);
        if (publicUrl) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.redirect(302, publicUrl);
        }
    }

    const signedUrl = await getSignedUrlForRelativeUrl(req.path, 3600);
    if (!signedUrl) {
        return next();
    }

    // Cache redirect briefly to avoid repeated signed URL lookups during navigation.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.redirect(302, signedUrl);
});

// Serve static frontend assets with cache policies suitable for web performance.
const publicDir = path.join(__dirname, '../public');
const publicAssetsDir = path.join(publicDir, 'assets');

// Vite build assets are content-hashed, so long immutable caching is safe.
app.use('/assets', express.static(publicAssetsDir, {
    maxAge: '1y',
    immutable: true
}));

// Other public files (HTML, favicon, manifest, etc.)
app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
        const normalized = String(filePath || '').toLowerCase();
        if (
            normalized.endsWith('.html') ||
            normalized.endsWith('/sw.js') ||
            normalized.endsWith('\\sw.js') ||
            normalized.endsWith('/manifest.webmanifest') ||
            normalized.endsWith('\\manifest.webmanifest')
        ) {
            // Always revalidate HTML so users get the newest app shell.
            res.setHeader('Cache-Control', 'no-cache');
            return;
        }

        // Cache non-hashed public files for a short period.
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

// Handle React Router - serve index.html for all non-API routes (Express 5.x compatible)
app.use((req, res) => {
    const indexPath = path.join(__dirname, '../public', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            if (!res.headersSent) {
                res.status(404).send("Client build not found. If you are developing, please use the client dev server (port 5173).");
            }
        }
    });
});

// Sentry error handler (must be after all routes)
setupSentryErrorHandler(app);

// Setup Socket.IO
const server = require('http').createServer(app);
const { createAdapter } = require('@socket.io/redis-adapter');
const { createPubClient, createSubClient } = require('./utils/redisClients');

const setupSocketWithAdapter = async () => {
    const pubClient = await createPubClient();
    const subClient = await createSubClient();

    const io = require('socket.io')(server, {
        adapter: createAdapter(pubClient, subClient),
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            credentials: true
        }
    });

    app.set('io', io);
    require('./socket').attachSocketHandlers(io, app);
};

setupSocketWithAdapter().catch((err) => {
    console.error('[Socket] Failed to setup Socket.IO with Redis adapter:', err);
    setupSocket(server, app, allowedOrigins);
});

// Telegram Bot Integration
const telegramService = require('./utils/telegramService');
const telegramController = require('./controllers/telegramController');

try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
        console.log('[Startup] Telegram Bot initialized');
    } else {
        console.warn('[Startup] TELEGRAM_BOT_TOKEN is missing!');
    }
    const bot = telegramService.initBot();
    if (bot) {
        bot.on('message', (msg) => {
            telegramController.handleTelegramUpdate(msg, app.get('io'));
        });
        bot.on('callback_query', (query) => {
            telegramController.handleTelegramCallback(query, app.get('io'));
        });
        bot.on('location', (msg) => {
            telegramController.handleTelegramLocation(msg, app.get('io'));
        });
        bot.on('edited_message', (msg) => {
            if (msg.location) {
                telegramController.handleTelegramLocation(msg, app.get('io'), true);
            }
        });
    }
} catch (err) {
    console.error('[Startup] Telegram bot initialization failed:', err);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on 0.0.0.0:${PORT} (env PORT=${process.env.PORT || 'unset'})`);
    ensureWebPushConfigured();
    if (isSupabaseStorageEnabled()) {
        const info = getStorageRuntimeInfo();
        console.log(`[Storage] Supabase Storage enabled. bucket="${info.bucket}" url="${info.url}" keySource="${info.keySource || 'unknown'}"`);
        ensureStorageFolderMarkers(['chat', 'tasks', 'landing-page-video']).catch((err) => {
            console.warn('[Storage] Failed to ensure storage folders:', err?.message || err);
        });
    } else {
        console.warn('[Storage] Supabase Storage is not fully configured. Falling back to local uploads/ directory.');
    }
    if (process.env.RAILWAY_GIT_COMMIT_SHA) {
        console.log(`[Startup] Railway commit: ${process.env.RAILWAY_GIT_COMMIT_SHA}`);
    }
    // Initialize scheduler after server is up and io is ready
    try {
        const scheduler = require('./scheduler');
        scheduler.init(app);
    } catch (err) {
        console.error('[Startup] Scheduler initialization failed:', err);
    }
});

server.on('error', (err) => {
    console.error('[Server] Failed to start HTTP server:', err);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
    console.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);
    server.close(() => {
        console.log('[Shutdown] HTTP server closed');
        // Close database connection if needed
        const db = require('./db');
        if (db.end) {
            db.end().then(() => {
                console.log('[Shutdown] Database connections closed');
                process.exit(0);
            }).catch((err) => {
                console.error('[Shutdown] Database close error:', err);
                process.exit(1);
            });
        } else {
            process.exit(0);
        }
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
        console.error('[Shutdown] Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
