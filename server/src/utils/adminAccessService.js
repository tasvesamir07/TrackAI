const db = require('../db');
const whatsappService = require('./whatsappService');
const { resolveTelegramChatIds } = require('./notificationService');

const getAdminNotificationConfig = async () => {
    const result = await db.query("SELECT value FROM settings WHERE key = 'admin_notification_settings'");
    return result.rows.length > 0
        ? JSON.parse(result.rows[0].value)
        : {
            enabled: false,
            emailEnabled: false,
            recipientEmails: [],
            emailDomainMode: 'all',
            allowedEmailDomains: [],
            whatsappNumbers: [],
            telegramChatIds: [],
            telegramChatIdLabels: {},
            scheduleTime: '18:00',
            timezone: 'UTC',
            smtpHost: '',
            smtpPort: '587',
            smtpUser: '',
            smtpPass: '',
            lastSentDate: null
        };
};

const normalizePhoneNumber = (value) => whatsappService.cleanPhoneNumber(String(value || ''));

const formatRoleLabel = (role) => {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'admin' || normalized === 'company_admin') return 'Admin';
    if (normalized === 'moderator' || normalized === 'project_manager') return 'Moderator';
    return 'Employee';
};

const getConfiguredTelegramAdminLabel = async (chatId) => {
    if (!chatId) return null;

    const config = await getAdminNotificationConfig();
    const labels = config.telegramChatIdLabels || {};
    const directLabel = labels[String(chatId)];
    if (typeof directLabel === 'string' && directLabel.trim()) {
        return directLabel.trim();
    }

    return null;
};

const getConfiguredWhatsAppAdminLabel = async (phoneNumber) => {
    if (!phoneNumber) return null;
    return 'Admin';
};

const buildVirtualAdminUser = ({ chatId = null, phoneNumber = null, actingAdminName = null } = {}) => ({
    id: null,
    username: phoneNumber ? `Admin (${phoneNumber})` : `Admin (${chatId})`,
    role: 'admin',
    original_role: null,
    is_communication_hub_admin: true,
    acting_admin_name: actingAdminName || 'Admin',
    status: 'active',
    telegram_chat_id: chatId ? chatId.toString() : null,
    contact_number: phoneNumber || null
});

const findUserByPhoneNumber = async (phoneNumber) => {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    if (!normalizedPhoneNumber) {
        return null;
    }

    const res = await db.query('SELECT * FROM users WHERE deleted_at IS NULL AND contact_number IS NOT NULL');
    const exactMatch = res.rows.find((user) => normalizePhoneNumber(user.contact_number) === normalizedPhoneNumber);
    if (exactMatch) {
        return exactMatch;
    }

    const normalizedTail = normalizedPhoneNumber.slice(-10);
    if (!normalizedTail) {
        return null;
    }

    return res.rows.find((user) => normalizePhoneNumber(user.contact_number).slice(-10) === normalizedTail) || null;
};

const isConfiguredTelegramAdminChatId = async (chatId) => {
    const config = await getAdminNotificationConfig();
    const telegramChatIds = Array.isArray(config.telegramChatIds) ? config.telegramChatIds : [];
    const resolvedChatIds = await resolveTelegramChatIds(telegramChatIds);
    return resolvedChatIds.has(chatId.toString());
};

const isConfiguredWhatsAppAdminNumber = async (phoneNumber) => {
    const config = await getAdminNotificationConfig();
    const whatsappNumbers = Array.isArray(config.whatsappNumbers) ? config.whatsappNumbers : [];
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    if (!normalizedPhoneNumber) {
        return false;
    }

    return whatsappNumbers.some((entry) => normalizePhoneNumber(entry) === normalizedPhoneNumber);
};

const linkTelegramAdminPhone = async (phoneNumber, chatId) => {
    const config = await getAdminNotificationConfig();
    const telegramChatIds = Array.isArray(config.telegramChatIds) ? config.telegramChatIds : [];
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    if (!normalizedPhoneNumber) {
        return false;
    }

    let didReplace = false;
    const updatedChatIds = telegramChatIds.map((entry) => {
        if (normalizePhoneNumber(entry) === normalizedPhoneNumber) {
            didReplace = true;
            return chatId.toString();
        }

        return entry;
    });

    if (!didReplace) {
        return false;
    }

    config.telegramChatIds = Array.from(new Set(updatedChatIds.filter(Boolean)));
    const telegramChatIdLabels = { ...(config.telegramChatIdLabels || {}) };
    const preservedLabel = telegramChatIdLabels[phoneNumber] || telegramChatIdLabels[normalizedPhoneNumber] || normalizedPhoneNumber;

    delete telegramChatIdLabels[phoneNumber];
    delete telegramChatIdLabels[normalizedPhoneNumber];
    telegramChatIdLabels[chatId.toString()] = preservedLabel;
    config.telegramChatIdLabels = telegramChatIdLabels;

    await db.query(
        "INSERT INTO settings (key, value, company_id) VALUES ('admin_notification_settings', $1, NULL) ON CONFLICT (key) WHERE company_id IS NULL DO UPDATE SET value = $1",
        [JSON.stringify(config)]
    );

    // Also update users table if a matching user exists
    try {
        const user = await findUserByPhoneNumber(normalizedPhoneNumber);
        if (user) {
            await db.query('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [chatId.toString(), user.id]);
        }
    } catch (err) {
        console.error('[AdminAccessService] Failed to update user record during admin link:', err.message);
    }

    return true;
};

module.exports = {
    buildVirtualAdminUser,
    findUserByPhoneNumber,
    formatRoleLabel,
    getConfiguredTelegramAdminLabel,
    getConfiguredWhatsAppAdminLabel,
    getAdminNotificationConfig,
    isConfiguredTelegramAdminChatId,
    isConfiguredWhatsAppAdminNumber,
    linkTelegramAdminPhone,
    normalizePhoneNumber
};
