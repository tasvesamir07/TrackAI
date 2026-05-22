const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const UPLOADS_PREFIX = '/uploads/';
const DEFAULT_BUCKET = 'media';
const LOCAL_UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

const SAFE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.zip',
    '.mp4', '.mov', '.bin'
]);

const MIME_EXTENSION_MAP = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov'
};

let supabaseClient = null;
let supabaseClientKey = '';

const stripWrappingQuotes = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '');

const getDatabaseUrlCandidate = () => (
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_IPV4 ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_IPV4 ||
    process.env.PGURL ||
    process.env.PGURL_IPV4 ||
    ''
);

const inferProjectRefFromDatabaseUrl = () => {
    const dbUrl = getDatabaseUrlCandidate();
    if (!dbUrl) return '';

    try {
        const parsed = new URL(dbUrl);
        const username = parsed.username || '';
        const usernameMatch = username.match(/^postgres\.([a-z0-9]+)/i);
        if (usernameMatch) return usernameMatch[1];
    } catch (_err) {
        // Ignore malformed DB URLs.
    }

    return '';
};

const getSupabaseConfig = () => {
    const explicitUrl = stripWrappingQuotes(process.env.SUPABASE_URL);
    const inferredProjectRef = inferProjectRefFromDatabaseUrl();
    const inferredUrl = inferredProjectRef ? `https://${inferredProjectRef}.supabase.co` : '';

    let url = explicitUrl || inferredUrl;
    try {
        if (url) {
            const parsed = new URL(url);
            url = `${parsed.protocol}//${parsed.host}`;
        }
    } catch (_err) {
        // Keep raw value if URL parsing fails; caller can detect invalid config downstream.
    }

    const explicitServiceRoleKey = stripWrappingQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    const fallbackKey = stripWrappingQuotes(process.env.SUPABASE_KEY || '');
    const serviceRoleKey = explicitServiceRoleKey || fallbackKey;
    const keySource = explicitServiceRoleKey
        ? 'SUPABASE_SERVICE_ROLE_KEY'
        : (fallbackKey ? 'SUPABASE_KEY' : '');

    const rawBucket = stripWrappingQuotes(process.env.SUPABASE_BUCKET || DEFAULT_BUCKET);
    const bucket = rawBucket.replace(/^\/+|\/+$/g, '') || DEFAULT_BUCKET;

    return { url, serviceRoleKey, bucket, keySource };
};

const isSupabaseStorageEnabled = () => {
    const cfg = getSupabaseConfig();
    return Boolean(cfg.url && cfg.serviceRoleKey && cfg.bucket);
};

const isSupabaseBucketPublic = () => {
    const raw = String(process.env.SUPABASE_BUCKET_PUBLIC || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
};

const getSupabaseClient = () => {
    const cfg = getSupabaseConfig();
    if (!cfg.url || !cfg.serviceRoleKey) return null;

    const clientKey = `${cfg.url}::${cfg.serviceRoleKey}`;
    if (!supabaseClient || supabaseClientKey !== clientKey) {
        supabaseClient = createClient(cfg.url, cfg.serviceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
        supabaseClientKey = clientKey;
    }

    return supabaseClient;
};

const isSupabaseBucketMissingError = (error) => {
    const statusCode = Number(error?.statusCode || error?.status || 0);
    if (statusCode === 404) return true;

    const message = String(error?.message || '').toLowerCase();
    return (
        (message.includes('bucket') && (message.includes('not found') || message.includes('does not exist'))) ||
        message.includes('resource was not found')
    );
};

const isSupabasePermissionError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('row level security') ||
        message.includes('not authorized') ||
        message.includes('permission denied') ||
        message.includes('unauthorized')
    );
};

const ensureSupabaseBucketExists = async (client, bucket) => {
    const { data, error: bucketError } = await client.storage.getBucket(bucket);
    if (!bucketError && data) return;

    if (bucketError && !isSupabaseBucketMissingError(bucketError)) {
        throw new Error(`Supabase bucket check failed: ${bucketError.message}`);
    }

    const { error: createError } = await client.storage.createBucket(bucket, { public: false });
    if (createError && !String(createError.message || '').toLowerCase().includes('already exists')) {
        throw new Error(`Supabase bucket create failed: ${createError.message}`);
    }

    console.log(`[Storage] Created missing Supabase bucket "${bucket}".`);
};

const buildSupabaseUploadErrorMessage = (error, context) => {
    const message = String(error?.message || 'Unknown Supabase error');
    const hints = [];

    if (isSupabasePermissionError(error)) {
        hints.push(`Check ${context.keySource || 'Supabase key'} is service-role/secret (not anon/publishable).`);
    }
    if (/api key|invalid.*key|jwt/i.test(message)) {
        hints.push('Verify SUPABASE_URL and key are from the same Supabase project.');
    }

    const hintText = hints.length > 0 ? `, hint="${hints.join(' ')}"` : '';
    return `Supabase upload failed: ${message} (bucket="${context.bucket}", objectPath="${context.objectPath}", url="${context.url}", keySource="${context.keySource || 'unknown'}"${hintText})`;
};

const normalizeOriginalName = (originalName) => {
    const value = String(originalName || 'file');
    try {
        return Buffer.from(value, 'latin1').toString('utf8');
    } catch (_err) {
        return value;
    }
};

const getSafeExtension = (originalName, mimetype) => {
    const extFromName = path.extname(String(originalName || '')).toLowerCase();
    if (SAFE_EXTENSIONS.has(extFromName)) return extFromName;

    const extFromMime = MIME_EXTENSION_MAP[String(mimetype || '').toLowerCase()];
    if (extFromMime && SAFE_EXTENSIONS.has(extFromMime)) return extFromMime;

    return '.bin';
};

const sanitizeFolder = (folder) => {
    const raw = String(folder || 'misc').trim().toLowerCase();
    const mapped = ({
        profiles: 'profiles',
        profile: 'profiles',
        'profile-pictures': 'profiles',
        chat: 'chat',
        'chat-attachments': 'chat',
        tasks: 'tasks',
        task: 'tasks',
        'task-attachments': 'tasks'
    })[raw] || raw;

    const normalized = String(mapped || 'misc')
        .split('/')
        .map((segment) => segment.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
        .filter(Boolean)
        .join('/');

    return normalized || 'misc';
};

const toRelativeUploadUrl = (value) => {
    if (!value || typeof value !== 'string') return null;

    let candidate = value.trim();
    if (!candidate) return null;

    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        try {
            candidate = new URL(candidate).pathname;
        } catch (_err) {
            return null;
        }
    }

    if (!candidate.startsWith(UPLOADS_PREFIX)) return null;

    const objectPath = candidate.slice(UPLOADS_PREFIX.length);
    if (!objectPath || objectPath.includes('..') || objectPath.includes('\\')) return null;

    try {
        const decodedObjectPath = decodeURIComponent(objectPath);
        if (!decodedObjectPath || decodedObjectPath.includes('..') || decodedObjectPath.includes('\\')) {
            return null;
        }
        return `${UPLOADS_PREFIX}${decodedObjectPath}`;
    } catch (_err) {
        return null;
    }
};

const toObjectPath = (relativeOrAbsoluteUrl) => {
    const normalizedRelative = toRelativeUploadUrl(relativeOrAbsoluteUrl);
    if (!normalizedRelative) return null;

    const objectPath = normalizedRelative.slice(UPLOADS_PREFIX.length);
    return normalizeObjectPath(objectPath);
};

const ensureWithinLocalUploads = (absolutePath) => {
    const resolvedTarget = path.resolve(absolutePath);
    const resolvedRoot = path.resolve(LOCAL_UPLOADS_DIR);
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
};

const buildObjectPath = (folder, originalName, mimetype) => {
    const safeFolder = sanitizeFolder(folder);
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const ext = getSafeExtension(originalName, mimetype);
    return normalizeObjectPath(`${safeFolder}/${unique}${ext}`);
};

const normalizeObjectPath = (value) => {
    if (!value || typeof value !== 'string') return null;

    const normalized = value
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join('/');

    if (!normalized || normalized.includes('..')) return null;

    // Keep storage keys conservative to avoid Supabase path validation errors.
    if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return null;

    return normalized;
};

const readIncomingFileBuffer = async (file) => {
    if (file?.buffer && Buffer.isBuffer(file.buffer)) {
        return file.buffer;
    }

    if (file?.path) {
        return fs.promises.readFile(file.path);
    }

    throw new Error('No upload file buffer/path available');
};

const uploadIncomingFile = async (file, options = {}) => {
    if (!file) throw new Error('No file provided');

    const folder = options.folder || 'misc';
    const normalizedName = normalizeOriginalName(file.originalname);
    const buffer = await readIncomingFileBuffer(file);
    const objectPath = buildObjectPath(folder, normalizedName, file.mimetype);
    if (!objectPath) {
        throw new Error('Failed to construct a valid storage path for upload');
    }

    const relativeUrl = `${UPLOADS_PREFIX}${objectPath}`;
    const contentType = file.mimetype || 'application/octet-stream';

    if (isSupabaseStorageEnabled()) {
        const client = getSupabaseClient();
        const cfg = getSupabaseConfig();
        const bucket = cfg.bucket;

        if (!client) {
            throw new Error('Supabase storage is enabled but client initialization failed');
        }

        const uploadToSupabase = async () => client.storage
            .from(bucket)
            .upload(objectPath, buffer, {
                contentType,
                upsert: false
            });

        let { error } = await uploadToSupabase();
        if (error && isSupabaseBucketMissingError(error)) {
            await ensureSupabaseBucketExists(client, bucket);
            ({ error } = await uploadToSupabase());
        }

        if (error) {
            throw new Error(buildSupabaseUploadErrorMessage(error, {
                bucket,
                objectPath,
                url: cfg.url,
                keySource: cfg.keySource
            }));
        }

        console.log(`[Storage] Uploaded to Supabase bucket="${bucket}" path="${objectPath}" contentType="${contentType}"`);
    } else {
        const absolutePath = path.join(LOCAL_UPLOADS_DIR, objectPath);
        if (!ensureWithinLocalUploads(absolutePath)) {
            throw new Error('Resolved upload path escapes uploads directory');
        }

        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.promises.writeFile(absolutePath, buffer);
    }

    return {
        url: relativeUrl,
        objectPath,
        type: contentType,
        name: normalizedName,
        size: buffer.length
    };
};

const getStorageRuntimeInfo = () => {
    const cfg = getSupabaseConfig();
    return {
        enabled: isSupabaseStorageEnabled(),
        bucket: cfg.bucket,
        url: cfg.url,
        keySource: cfg.keySource || null
    };
};

const getPublicUrlForRelativeUrl = (relativeOrAbsoluteUrl) => {
    const objectPath = toObjectPath(relativeOrAbsoluteUrl);
    if (!objectPath || !isSupabaseStorageEnabled()) return null;

    const client = getSupabaseClient();
    const { bucket } = getSupabaseConfig();
    const { data } = client.storage.from(bucket).getPublicUrl(objectPath);
    return data?.publicUrl || null;
};

const getSignedUrlForRelativeUrl = async (relativeOrAbsoluteUrl, expiresInSeconds = 60) => {
    const objectPath = toObjectPath(relativeOrAbsoluteUrl);
    if (!objectPath || !isSupabaseStorageEnabled()) return null;

    try {
        const client = getSupabaseClient();
        const { bucket } = getSupabaseConfig();
        const { data, error } = await client.storage
            .from(bucket)
            .createSignedUrl(objectPath, expiresInSeconds);

        if (error) {
            console.warn(`[Storage] Signed URL warning for ${objectPath}: ${error.message}`);
            return null;
        }

        return data?.signedUrl || null;
    } catch (err) {
        console.warn(`[Storage] Signed URL error for ${objectPath}: ${err.message}`);
        return null;
    }
};

const deleteUploadedFile = async (relativeOrAbsoluteUrl) => {
    const objectPath = toObjectPath(relativeOrAbsoluteUrl);
    if (!objectPath) return false;

    if (isSupabaseStorageEnabled()) {
        try {
            const client = getSupabaseClient();
            const { bucket } = getSupabaseConfig();
            await client.storage.from(bucket).remove([objectPath]);
        } catch (err) {
            console.warn(`[Storage] Supabase delete warning for ${objectPath}: ${err.message}`);
        }
    }

    // Always attempt local cleanup too for compatibility/migrations.
    try {
        const absolutePath = path.join(LOCAL_UPLOADS_DIR, objectPath);
        if (ensureWithinLocalUploads(absolutePath) && fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
        }
    } catch (err) {
        console.warn(`[Storage] Local delete warning for ${objectPath}: ${err.message}`);
    }

    return true;
};

const createPresignedUpload = async ({ folder = 'misc', fileName = 'file.bin', contentType = 'application/octet-stream' } = {}) => {
    const normalizedName = normalizeOriginalName(fileName);
    const objectPath = buildObjectPath(folder, normalizedName, contentType);
    if (!objectPath) throw new Error('Failed to construct upload path');

    const relativeUrl = `${UPLOADS_PREFIX}${objectPath}`;

    if (!isSupabaseStorageEnabled()) {
        return {
            uploadStrategy: 'legacy',
            relativeUrl,
            objectPath,
            signedUrl: null,
            token: null
        };
    }

    const client = getSupabaseClient();
    const cfg = getSupabaseConfig();
    if (!client) {
        throw new Error('Supabase storage is enabled but client initialization failed');
    }

    const { data, error } = await client.storage
        .from(cfg.bucket)
        .createSignedUploadUrl(objectPath, {
            upsert: false
        });

    if (error) {
        throw new Error(buildSupabaseUploadErrorMessage(error, {
            bucket: cfg.bucket,
            objectPath,
            url: cfg.url,
            keySource: cfg.keySource
        }));
    }

    return {
        uploadStrategy: 'supabase_signed_upload',
        relativeUrl,
        objectPath,
        signedUrl: data?.signedUrl || null,
        token: data?.token || null
    };
};

const ensureStorageFolderMarkers = async (folders = []) => {
    if (!isSupabaseStorageEnabled()) return;

    const client = getSupabaseClient();
    const cfg = getSupabaseConfig();
    if (!client) return;

    const bucket = cfg.bucket;
    await ensureSupabaseBucketExists(client, bucket);

    for (const rawFolder of folders) {
        const folder = sanitizeFolder(rawFolder);
        if (!folder) continue;

        const markerObjectPath = `${folder}/.keep`;
        try {
            const { error } = await client.storage
                .from(bucket)
                .upload(markerObjectPath, Buffer.from(''), {
                    contentType: 'text/plain',
                    upsert: true
                });

            if (error) {
                console.warn(`[Storage] Failed to ensure folder marker "${markerObjectPath}": ${error.message}`);
                continue;
            }

            console.log(`[Storage] Ensured folder marker: ${markerObjectPath}`);
        } catch (err) {
            console.warn(`[Storage] Failed to ensure folder marker "${markerObjectPath}": ${err.message}`);
        }
    }
};

module.exports = {
    isSupabaseStorageEnabled,
    isSupabaseBucketPublic,
    uploadIncomingFile,
    createPresignedUpload,
    ensureStorageFolderMarkers,
    getPublicUrlForRelativeUrl,
    getSignedUrlForRelativeUrl,
    deleteUploadedFile,
    toRelativeUploadUrl,
    getStorageRuntimeInfo
};
