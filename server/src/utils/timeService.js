const db = require('../db');

const { toZonedTime, fromZonedTime, format: formatTz } = require('date-fns-tz');
// Use a safe system fallback that doesn't depend on subpaths
const DEFAULT_TZ = process.env.TZ || 'UTC';

// In-memory cache for the offset to avoid DB hits on every Date call
let offsetMs = 0;
let isInitialized = false;

const init = async () => {
    try {
        const res = await db.query("SELECT value FROM settings WHERE key = 'virtual_clock_offset_ms'");
        if (res.rows.length > 0) {
            offsetMs = parseInt(res.rows[0].value) || 0;
        } else {
            // Initialize if not present
            await db.query("INSERT INTO settings (key, value) VALUES ('virtual_clock_offset_ms', '0')");
            offsetMs = 0;
        }
        isInitialized = true;
        const virtualTime = new Date(Date.now() + offsetMs);
        console.log(`TimeService initialized. Offset: ${offsetMs}ms. Virtual Time: ${virtualTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`);
    } catch (err) {
        console.error('Failed to initialize TimeService:', err);
    }
};

const getNow = () => {
    return new Date(Date.now() + offsetMs);
};

// Returns current virtual time shifted to a specific timezone
const getZnow = (timezone) => {
    // Default to Dhaka ONLY as a final fallback for now, but allow dynamic override
    return toZonedTime(getNow(), timezone || DEFAULT_TZ);
};

const getOffset = () => {
    return offsetMs;
};

const setOffset = async (newOffsetMs) => {
    try {
        offsetMs = newOffsetMs;
        // Check if exists before update
        const check = await db.query("SELECT 1 FROM settings WHERE key = 'virtual_clock_offset_ms'");
        if (check.rows.length === 0) {
            await db.query("INSERT INTO settings (key, value) VALUES ('virtual_clock_offset_ms', $1)", [newOffsetMs]);
        } else {
            await db.query("UPDATE settings SET value = $1 WHERE key = 'virtual_clock_offset_ms'", [newOffsetMs]);
        }
        console.log(`Time Travel: Offset set to ${offsetMs}ms. New Virtual Time: ${getNow().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`);
        return true;
    } catch (err) {
        console.error('Failed to set time offset:', err);
        return false;
    }
};

const addOffset = async (msToAdd) => {
    return await setOffset(offsetMs + msToAdd);
};

const reset = async () => {
    return await setOffset(0);
};

const formatLiteral = (date, timezone) => {
    if (!date) return null;
    try {
        const d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) {
            console.error(`[TimeService] Invalid date in formatLiteral:`, date);
            return null;
        }
        // Use ISO-8601 format (yyyy-MM-dd'T'HH:mm:ssXXX) for maximum compatibility
        return formatTz(d, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone });
    } catch (e) {
        console.error(`[TimeService] formatLiteral error:`, e, 'Input:', date);
        return null;
    }
};

const parseLiteral = (str, timezone) => {
    if (!str) return null;
    if (str instanceof Date) return str;
    
    try {
        let cleanStr = str;
        if (typeof str === 'string') {
            // Handle non-standard formats like "2026-03-16 21:33:05 +06:00" 
            // by removing the space before the offset if it exists
            cleanStr = str.replace(/(\d{2}:\d{2}:\d{2})\s+([+-])/, '$1$2').replace(/\s+/, 'T');
        }

        // Try native Date first
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) return d;

        // Fallback to fromZonedTime
        const parsed = fromZonedTime(str, timezone || DEFAULT_TZ);
        if (!isNaN(parsed.getTime())) return parsed;

        console.error(`[TimeService] Unable to parse date literal:`, str);
        return null;
    } catch (e) {
        console.error(`[TimeService] parseLiteral error:`, e, 'Input:', str);
        return null;
    }
};


const getNowLiteral = (timezone) => {
    return formatLiteral(getNow(), timezone);
};

const getDateStr = (date, timezone) => {
    if (!date) return null;
    try {
        const d = (date instanceof Date) ? date : new Date(date);
        if (isNaN(d.getTime())) {
            console.error(`[TimeService] Invalid date in getDateStr:`, date);
            return null;
        }
        return formatTz(d, 'yyyy-MM-dd', { timeZone: timezone || DEFAULT_TZ });
    } catch (e) {
        console.error(`[TimeService] getDateStr error:`, e, 'Input:', date);
        return null;
    }
};

const getDayOfWeek = (date, timezone) => {
    if (!date) return null;
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    
    const tz = timezone || DEFAULT_TZ;
    const zoned = toZonedTime(d, tz);
    return zoned.getDay(); // 0-6 (Sun-Sat) Standard JS
};

module.exports = {
    init,
    getNow,
    getZnow,
    getNowLiteral,
    getOffset,
    setOffset,
    addOffset,
    reset,
    formatLiteral,
    parseLiteral,
    getDateStr,
    getDayOfWeek
};
