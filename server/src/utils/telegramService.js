const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');

let bot = null;
let botInfo = null;
let isInitializing = false;
let pollingLockClient = null;
let hasPollingLeadership = false;
let pollingConflictDisabled = false;
const TELEGRAM_POLLING_LOCK_KEY = 87422153;

const acquirePollingLeadership = async () => {
    if (pollingConflictDisabled) {
        return false;
    }

    if (hasPollingLeadership && pollingLockClient) {
        return true;
    }

    if (pollingLockClient) {
        return hasPollingLeadership;
    }

    const client = await db.getClient();

    try {
        const result = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [TELEGRAM_POLLING_LOCK_KEY]);
        const locked = result.rows[0]?.locked === true;

        if (!locked) {
            client.release();
            return false;
        }

        pollingLockClient = client;
        hasPollingLeadership = true;
        return true;
    } catch (error) {
        client.release();
        throw error;
    }
};

const releasePollingLeadership = async () => {
    if (!pollingLockClient) {
        hasPollingLeadership = false;
        return;
    }

    const client = pollingLockClient;
    pollingLockClient = null;
    hasPollingLeadership = false;

    try {
        await client.query('SELECT pg_advisory_unlock($1)', [TELEGRAM_POLLING_LOCK_KEY]);
    } catch (error) {
        console.error('[TelegramService] Failed to release polling lock:', error.message);
    } finally {
        client.release();
    }
};

const startPollingIfLeader = async () => {
    if (!bot) return;
    if (pollingConflictDisabled) return;

    try {
        const isLeader = await acquirePollingLeadership();
        if (!isLeader) {
            console.log(`[TelegramService][PID:${process.pid}] Another server instance owns Telegram polling. This instance will stay idle.`);
            return;
        }

        const info = await bot.getWebHookInfo();
        if (info.url) {
            console.log(`[TelegramService][PID:${process.pid}] Deleting existing webhook:`, info.url);
            await bot.deleteWebHook();
        }

        console.log(`[TelegramService][PID:${process.pid}] Starting polling as active Telegram instance...`);
        if (bot.isPolling()) {
            console.log(`[TelegramService][PID:${process.pid}] Polling already active, skipping startPolling.`);
        } else {
            await bot.startPolling();
        }
    } catch (err) {
        console.error('[TelegramService] Error during polling startup:', err.message);
        if (hasPollingLeadership) {
            try {
                await bot.startPolling();
            } catch (fallbackErr) {
                console.error('[TelegramService] Polling fallback failed:', fallbackErr.message);
            }
        }
    }
};

const initBot = () => {
    if (bot) return bot;
    if (isInitializing) return null;
    
    isInitializing = true;
    
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.warn('[TelegramService] TELEGRAM_BOT_TOKEN missing in .env. Telegram features will be disabled.');
        isInitializing = false;
        return null;
    }

    // Use polling: false initially to prevent auto-start before webhook 
    bot = new TelegramBot(token, { polling: false });
    
    console.log('[TelegramService] Initializing bot...');

    // Fetch bot info (username) automatically
    bot.getMe().then((info) => {
        botInfo = info;
        console.log(`[TelegramService] Bot identified as @${info.username} (${info.first_name})`);
    }).catch((err) => {
        console.error('[TelegramService] Failed to get bot info:', err.message);
    });

    startPollingIfLeader().then(() => {
        console.log('[TelegramService] Initial leadership check complete');
    }).catch((err) => {
        console.error('[TelegramService] Bot startup failed:', err.message);
    });

    // Periodically check if we can become the leader (in case of zombie locks or crashes)
    setInterval(() => {
        if (!hasPollingLeadership) {
            console.log('[TelegramService] Checking for polling leadership...');
            startPollingIfLeader().catch(() => {});
        }
    }, 10000); // Every 10 seconds

    bot.on('polling_error', (error) => {
        const errorMsg = error.response ? `${error.response.body.error_code}: ${error.response.body.description}` : error.message;
        console.error(`[TelegramService][PID:${process.pid}] Polling error:`, error.code || 'UNKNOWN', errorMsg);
        
        // If another process already owns getUpdates, stand down and let the leadership cycle handle it.
        if (error.message.includes('409') || (error.response && error.response.body.error_code === 409)) {
            console.error(`[TelegramService][PID:${process.pid}] CONFLICT DETECTED (409): Another server instance is already polling for this bot!`);
            console.warn(`[TelegramService] This instance will stop polling and retry leadership acquisition soon.`);
            bot.stopPolling().catch(() => {});
            releasePollingLeadership().catch(() => {});
            // Reset conflict flag to allow retry in the next interval
            pollingConflictDisabled = false;
        }
    });

    const shutdown = async () => {
        try {
            if (bot) {
                await bot.stopPolling();
            }
        } catch (_error) {
            // Ignore polling shutdown errors during process exit.
        } finally {
            await releasePollingLeadership();
        }
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    process.once('beforeExit', shutdown);
    
    return bot;
};

const getBot = () => {
    if (!bot) return initBot();
    return bot;
};

const sendMessage = async (chatId, text, options = {}) => {
    const b = getBot();
    if (!b) return null;
    
    // Default to Markdown parse mode if none specified
    const finalOptions = {
        parse_mode: 'Markdown',
        ...options
    };

    try {
        console.log(`[TelegramService] Sending message to ${chatId}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(__dirname, '../../tg_debug.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] [OUTGOING] to ${chatId}: ${text}\n`);

        if (finalOptions.reply_markup) {
            console.log(`[TelegramService] Reply Markup:`, JSON.stringify(finalOptions.reply_markup));
        }
        return await b.sendMessage(chatId, text, finalOptions);
    } catch (error) {
        console.error(`[TelegramService] Error sending message to ${chatId}:`, error.message);
        console.error(`[TelegramService] Detailed Error:`, error.response?.body || error);
        return null;
    }
};

const sendText = async (chatId, text) => {
    return await sendMessage(chatId, text);
};

const startsWithSymbol = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return !/^[a-z0-9]/i.test(normalized);
};

const normalizeButtonKey = (value = '') => (
    String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

const getButtonEmoji = (label = '') => {
    const key = normalizeButtonKey(label);

    if (key.includes('sign in')) return '✅';
    if (key.includes('sign out')) return '🛑';
    if (key === 'break' || key.includes(' break')) return '☕';
    if (key.includes('resume')) return '▶️';
    if (key.includes('my status') || key === 'status') return '📊';
    if (key.includes('assigned tasks')) return '📌';
    if (key.includes('my projects') || key === 'projects') return '🗂';
    if (key.includes('apply leave')) return '🏖';
    if (key.includes('my leaves')) return '📋';
    if (key.includes('holidays')) return '🗓';
    if (key.includes('assign task')) return '🧩';
    if (key.includes('on leave now')) return '🌴';
    if (key.includes('employee status')) return '👥';
    if (key.includes('daily report')) return '📝';
    if (key.includes('weekly report')) return '📆';
    if (key.includes('monthly report')) return '🗓';
    if (key.includes('yearly report')) return '📅';
    if (key.includes('attendance report')) return '📈';
    if (key.includes('request live location')) return '📍';
    if (key.includes('pending leaves')) return '⏳';
    if (key.includes('profile requests')) return '🪪';
    if (key === 'menu') return '🔄';
    if (key.includes('back')) return '🔙';
    if (key.includes('tasks')) return '📌';
    if (key.includes('summary')) return '📊';
    if (key.includes('approve')) return '✅';
    if (key.includes('reject')) return '❌';
    if (key.includes('cancel')) return '❌';
    if (key.includes('done')) return '✅';
    if (key.includes('create')) return '➕';
    if (key.includes('save')) return '💾';
    if (key.includes('restore')) return '♻️';
    if (key.includes('recycle bin') || key.includes('bin')) return '🗑';

    return '🔹';
};

const decorateButtonText = (label = '') => {
    const text = String(label || '').trim();
    if (!text) return text;
    if (startsWithSymbol(text)) return text;
    return `${getButtonEmoji(text)} ${text}`;
};

const decorateKeyboardButtons = (keyboard = []) => (
    (Array.isArray(keyboard) ? keyboard : []).map((row) => (
        (Array.isArray(row) ? row : []).map((button) => {
            if (typeof button === 'string') {
                return decorateButtonText(button);
            }
            if (button && typeof button === 'object' && button.text) {
                return { ...button, text: decorateButtonText(button.text) };
            }
            return button;
        })
    ))
);

const sendKeyboard = async (chatId, text, keyboardColumns, resize = true, oneTime = false) => {
    const options = {
        reply_markup: {
            keyboard: decorateKeyboardButtons(keyboardColumns),
            resize_keyboard: resize,
            one_time_keyboard: oneTime
        }
    };
    return await sendMessage(chatId, text, options);
};

const sendInlineKeyboard = async (chatId, text, inlineKeyboard) => {
    const options = {
        reply_markup: {
            inline_keyboard: decorateKeyboardButtons(inlineKeyboard)
        }
    };
    return await sendMessage(chatId, text, options);
};

const sendLocation = async (chatId, latitude, longitude, options = {}) => {
    const b = getBot();
    if (!b) return null;

    try {
        console.log(`[TelegramService] Sending location to ${chatId}: ${latitude}, ${longitude}`);
        return await b.sendLocation(chatId, latitude, longitude, options);
    } catch (error) {
        console.error(`[TelegramService] Error sending location to ${chatId}:`, error.message);
        console.error(`[TelegramService] Detailed Error:`, error.response?.body || error);
        return null;
    }
};

const editMessageLiveLocation = async (chatId, messageId, latitude, longitude, options = {}) => {
    const b = getBot();
    if (!b) return null;

    try {
        console.log(`[TelegramService] Updating live location in ${chatId} (msg: ${messageId}): ${latitude}, ${longitude}`);
        return await b.editMessageLiveLocation(latitude, longitude, {
            chat_id: chatId,
            message_id: messageId,
            ...options
        });
    } catch (error) {
        // Suppress errors if location hasn't changed enough or message is already deleted/stopped
        if (error.message.includes('message is not modified')) return null;
        console.error(`[TelegramService] Error editing live location in ${chatId}:`, error.message);
        return null;
    }
};

const sendLocationRequestKeyboard = async (chatId, text) => {
    const options = {
        reply_markup: {
            keyboard: decorateKeyboardButtons([[{ text: 'Share My Live Location', request_location: true }]]),
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
    return await sendMessage(chatId, text, options);
};

module.exports = {
    initBot,
    getBot,
    sendMessage,
    sendText,
    sendKeyboard,
    sendInlineKeyboard,
    sendLocation,
    editMessageLiveLocation,
    sendLocationRequestKeyboard,
    getBotUsername: () => botInfo?.username || process.env.TELEGRAM_BOT_USERNAME || null
};

