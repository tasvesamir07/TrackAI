const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs/promises');
require('dotenv').config();
const db = require('../db');
const { loadEmailDomainPolicy, assertEmailAllowedByPolicy, normalizeEmail } = require('./emailDomainPolicy');

let emailTemplateEngine = null;
try {
  emailTemplateEngine = require('./emailTemplateEngine');
} catch (e) {
  console.warn('[EmailService] Template engine not available:', e.message);
}

const renderEmailTemplate = (templateName, data) => {
  if (!emailTemplateEngine) return null;
  try {
    return emailTemplateEngine.renderTemplate(templateName, data);
  } catch (e) {
    console.error(`[EmailService] Failed to render template ${templateName}:`, e.message);
    return null;
  }
};

// Create reusable transporter using cPanel SMTP
let transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: false
    }
});

const getNylasConfig = () => ({
    apiKey: String(process.env.NYLAS_API_KEY || '').trim(),
    apiUri: String(process.env.NYLAS_API_URI || 'https://api.us.nylas.com').trim().replace(/\/+$/, ''),
    grantId: String(process.env.NYLAS_GRANT_ID || '').trim(),
    domain: String(process.env.NYLAS_DOMAIN || '').trim(),
    fromEmail: String(process.env.NYLAS_FROM_EMAIL || '').trim(),
    fromName: String(process.env.NYLAS_FROM_NAME || 'Daily Task System').trim() || 'Daily Task System',
    allowGrantFromOverride: String(process.env.NYLAS_GRANT_ALLOW_FROM_OVERRIDE || '').trim().toLowerCase() === 'true'
});




/**
 * Configure email transporter with new settings
 * @param {Object} config - SMTP configuration
 */
const configureTransporter = (config) => {
    if (!config.host || !config.port || !config.user || !config.pass) {
        console.warn('Invalid SMTP config provided, skipping reconfiguration');
        return;
    }

    transporter = nodemailer.createTransport({
        host: config.host,
        port: parseInt(config.port),
        secure: config.port === '465' || config.port === 465, // Auto-detect secure based on port if not explicit
        auth: {
            user: config.user,
            pass: config.pass,
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    // Verify new configuration
    transporter.verify((error, success) => {
        if (error) {
            console.error('New email transporter verification failed:', error);
        } else {
            console.log('New email server configuration is ready');
        }
    });
};

// Initial verify
transporter.verify((error, success) => {
    if (error) {
        console.error('Initial email transporter verification failed:', error);
    } else {
        console.log('Initial email server is ready');
    }
});

const extractEmailsFromField = (field) => {
    if (!field) return [];

    if (Array.isArray(field)) {
        return field.flatMap((value) => extractEmailsFromField(value));
    }

    if (typeof field === 'string') {
        const matches = field.match(/[^\s,;<>"]+@[^\s,;<>"]+\.[^\s,;<>"]+/g);
        return matches ? matches : [];
    }

    if (typeof field === 'object') {
        if (typeof field.address === 'string') {
            return [field.address];
        }

        if (Array.isArray(field.value)) {
            return field.value.flatMap((value) => extractEmailsFromField(value));
        }
    }

    return [];
};

const parseAddressEntries = (field) => {
    if (!field) return [];

    if (Array.isArray(field)) {
        return field.flatMap((value) => parseAddressEntries(value));
    }

    if (typeof field === 'object') {
        if (Array.isArray(field.value)) {
            return parseAddressEntries(field.value);
        }

        const address = normalizeEmail(field.email || field.address);
        if (!address) return [];
        return [{
            email: address,
            ...(field.name ? { name: String(field.name).trim() } : {})
        }];
    }

    if (typeof field === 'string') {
        const fromStringMatch = field.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
        if (fromStringMatch) {
            const parsedEmail = normalizeEmail(fromStringMatch[2]);
            if (!parsedEmail) return [];
            const parsedName = String(fromStringMatch[1] || '').trim().replace(/^"|"$/g, '');
            return [{
                email: parsedEmail,
                ...(parsedName ? { name: parsedName } : {})
            }];
        }

        return extractEmailsFromField(field)
            .map((email) => normalizeEmail(email))
            .filter(Boolean)
            .map((email) => ({ email }));
    }

    return [];
};

const toUniqueAddressList = (field) => {
    const seen = new Set();
    const unique = [];
    for (const entry of parseAddressEntries(field)) {
        const normalized = normalizeEmail(entry.email);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push({
            email: normalized,
            ...(entry.name ? { name: entry.name } : {})
        });
    }
    return unique;
};

const getPrimaryAddress = (field) => toUniqueAddressList(field)[0] || null;

const getEmailDomain = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) return '';
    return normalized.split('@')[1];
};

const enforceSmtpSafeFrom = (mailOptions) => {
    const smtpUser = normalizeEmail(process.env.SMTP_USER || '');
    if (!smtpUser) return;

    const smtpDomain = getEmailDomain(smtpUser);
    const currentFrom = getPrimaryAddress(mailOptions.from);
    const currentFromEmail = normalizeEmail(currentFrom?.email || '');
    const currentFromDomain = getEmailDomain(currentFromEmail);

    if (!currentFromEmail) {
        mailOptions.from = `"Daily Task System" <${smtpUser}>`;
        return;
    }

    // Prevent DMARC failures when trying to SMTP-send as an external mailbox (e.g., Gmail).
    if (smtpDomain && currentFromDomain && smtpDomain !== currentFromDomain) {
        if (!mailOptions.replyTo) {
            mailOptions.replyTo = currentFromEmail;
        }
        mailOptions.from = `"Daily Task System" <${smtpUser}>`;
    }
};

const resolveSenderNylasContext = async (senderUser = null) => {
    if (!senderUser) return null;

    const userGrant = String(senderUser.nylas_grant_id || '').trim();
    if (userGrant) {
        return {
            grantId: userGrant,
            connectedEmail: normalizeEmail(senderUser.nylas_connected_email || senderUser.email || '')
        };
    }

    const userId = senderUser.id || senderUser.user_id || null;
    if (!userId) return null;

    try {
        const result = await db.query(
            `SELECT nylas_grant_id, nylas_connected_email, email
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [userId]
        );
        const row = result.rows[0];
        if (!row?.nylas_grant_id) return null;
        return {
            grantId: String(row.nylas_grant_id || '').trim(),
            connectedEmail: normalizeEmail(row.nylas_connected_email || row.email || '')
        };
    } catch (err) {
        console.warn('[EmailService] Failed to resolve sender Nylas grant:', err.message);
        return null;
    }
};

const toNylasAttachment = async (attachment) => {
    if (!attachment) return null;

    let filename = String(attachment.filename || '').trim();
    let contentType = String(attachment.contentType || attachment.content_type || '').trim();
    let base64Content = null;

    if (attachment.path) {
        const filePath = String(attachment.path).trim();
        if (!filename) filename = path.basename(filePath);
        const buffer = await fs.readFile(filePath);
        base64Content = buffer.toString('base64');
    } else if (attachment.content) {
        if (Buffer.isBuffer(attachment.content)) {
            base64Content = attachment.content.toString('base64');
        } else if (typeof attachment.content === 'string') {
            const encoding = String(attachment.encoding || '').trim().toLowerCase();
            base64Content = encoding === 'base64'
                ? attachment.content
                : Buffer.from(attachment.content, 'utf8').toString('base64');
        }
    }

    if (!base64Content) {
        throw new Error('Unsupported attachment format for Nylas');
    }
    if (!filename) filename = 'attachment';
    if (!contentType) contentType = 'application/octet-stream';

    return {
        filename,
        content: base64Content,
        content_type: contentType
    };
};

const toNylasAttachments = async (attachments) => {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    const prepared = await Promise.all(attachments.map((attachment) => toNylasAttachment(attachment)));
    return prepared.filter(Boolean);
};

const sendViaNylas = async (mailOptions, senderContext = null) => {
    const nylas = getNylasConfig();
    if (!nylas.apiKey) return null;

    const effectiveGrantId = String(senderContext?.grantId || nylas.grantId || '').trim();
    const useGrantMode = Boolean(effectiveGrantId);
    const isTransactional = !useGrantMode && Boolean(nylas.domain);

    if (!isTransactional && !useGrantMode) {
        console.warn('[EmailService] NYLAS_API_KEY is set but neither NYLAS_DOMAIN nor NYLAS_GRANT_ID is configured.');
        return null;
    }

    const to = toUniqueAddressList(mailOptions.to);
    if (to.length === 0) {
        throw new Error('No valid recipient email provided');
    }

    const fromEntries = toUniqueAddressList(mailOptions.from);
    const replyTo = toUniqueAddressList(mailOptions.replyTo);
    const cc = toUniqueAddressList(mailOptions.cc);
    const bcc = toUniqueAddressList(mailOptions.bcc);
    const attachments = await toNylasAttachments(mailOptions.attachments);
    const body = mailOptions.html || mailOptions.text || '';

    const requestBody = {
        to,
        subject: String(mailOptions.subject || ''),
        body
    };

    if (mailOptions.text && !mailOptions.html) {
        requestBody.is_plaintext = true;
    }
    if (cc.length > 0) requestBody.cc = cc;
    if (bcc.length > 0) requestBody.bcc = bcc;
    if (replyTo.length > 0) requestBody.reply_to = replyTo;
    if (attachments.length > 0) requestBody.attachments = attachments;
    if (useGrantMode && nylas.allowGrantFromOverride && fromEntries.length > 0) {
        requestBody.from = fromEntries;
    }

    let endpoint;
    if (isTransactional) {
        const transactionalDefaultFrom = normalizeEmail(
            nylas.fromEmail || process.env.SMTP_USER || `no-reply@${nylas.domain}`
        );
        const requestedFrom = fromEntries[0] || null;
        const requestedDomain = getEmailDomain(requestedFrom?.email || '');
        const nylasDomain = String(nylas.domain || '').trim().toLowerCase();
        const canUseRequestedFrom = Boolean(
            requestedFrom?.email
            && requestedDomain
            && nylasDomain
            && requestedDomain === nylasDomain
        );

        const sender = canUseRequestedFrom
            ? requestedFrom
            : {
                name: requestedFrom?.name || nylas.fromName,
                email: transactionalDefaultFrom
            };

        if (!canUseRequestedFrom && requestedFrom?.email && replyTo.length === 0) {
            requestBody.reply_to = [{ email: normalizeEmail(requestedFrom.email) }];
        }

        if (!sender.email) {
            throw new Error('Missing sender address for transactional Nylas email');
        }
        requestBody.from = sender;
        endpoint = `${nylas.apiUri}/v3/domains/${encodeURIComponent(nylas.domain)}/messages/send`;
    } else {
        endpoint = `${nylas.apiUri}/v3/grants/${encodeURIComponent(effectiveGrantId)}/messages/send`;
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${nylas.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    const rawBody = await response.text();
    let parsedBody = null;
    try {
        parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch (_) {
        parsedBody = null;
    }

    if (!response.ok) {
        const errorMessage = parsedBody?.error?.message
            || parsedBody?.message
            || rawBody
            || `Nylas send failed with status ${response.status}`;
        const error = new Error(errorMessage);
        error.statusCode = response.status;
        throw error;
    }

    const messageId = parsedBody?.data?.id
        || parsedBody?.data?.message_id
        || parsedBody?.id
        || null;

    return { messageId };
};

const sendMailWithDomainPolicy = async (mailOptions, senderUser = null, isOTP = false) => {
    const recipients = Array.from(new Set([
        ...extractEmailsFromField(mailOptions?.to),
        ...extractEmailsFromField(mailOptions?.cc),
        ...extractEmailsFromField(mailOptions?.bcc)
    ].map((email) => normalizeEmail(email)).filter(Boolean)));

    if (recipients.length === 0) {
        throw new Error('No valid recipient email provided');
    }

    const policyCompanyId = senderUser?.company_id || senderUser?.companyId || null;
    const policy = await loadEmailDomainPolicy(db, policyCompanyId);
    recipients.forEach((recipient) => {
        assertEmailAllowedByPolicy(recipient, policy, 'Recipient email');
    });

    // 1. If it's an OTP, ALWAYS use the system's no-reply SMTP
    if (isOTP) {
        console.log(`[EmailService] Sending OTP via system SMTP (${process.env.SMTP_USER})`);
        // Ensure 'from' is the no-reply address
        mailOptions.from = `"Daily Task System" <${process.env.SMTP_USER}>`;
        return transporter.sendMail(mailOptions);
    }

    // Use system sender address for provider compatibility; expose actor via reply-to.
    if (!mailOptions.from) {
        mailOptions.from = `"Daily Task System" <${process.env.SMTP_USER}>`;
    }
    if (senderUser && senderUser.email && !mailOptions.replyTo) {
        mailOptions.replyTo = senderUser.email;
    }

    // 2. Try Nylas first when configured
    const senderContext = await resolveSenderNylasContext(senderUser);
    try {
        const nylasResult = await sendViaNylas(mailOptions, senderContext);
        if (nylasResult) {
            console.log('[EmailService] Email sent via Nylas');
            return nylasResult;
        }
    } catch (nylasErr) {
        if (senderContext?.grantId) {
            throw new Error(`Connected mailbox send failed: ${nylasErr.message}`);
        }
        console.error('[EmailService] Nylas send failed:', nylasErr.message);
    }

    // 3. Final fallback to global SMTP
    console.log('[EmailService] Falling back to system SMTP');
    enforceSmtpSafeFrom(mailOptions);

    return transporter.sendMail(mailOptions);
};

/**
 * Send OTP email to user
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit OTP code
 * @param {string} username - User's username
 * @returns {Promise<void>}
 */
const sendOTPEmail = async (email, otp, username) => {
    const mailOptions = {
        from: `"Daily Task System" <${transporter.options.auth.user}>`, // Use configured sender
        to: email,
        subject: 'Password Reset OTP - Daily Task System',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        background-color: #f4f4f4;
                        margin: 0;
                        padding: 0;
                    }
                    .container {
                        max-width: 600px;
                        margin: 40px auto;
                        background: #ffffff;
                        border-radius: 8px;
                        overflow: hidden;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                    }
                    .header {
                        background: linear-gradient(135deg, #3b82f6 0%, #9333ea 100%);
                        padding: 30px;
                        text-align: center;
                        color: white;
                    }
                    .header h1 {
                        margin: 0;
                        font-size: 24px;
                        font-weight: 600;
                    }
                    .content {
                        padding: 40px 30px;
                    }
                    .greeting {
                        font-size: 18px;
                        color: #1f2937;
                        margin-bottom: 20px;
                    }
                    .message {
                        color: #4b5563;
                        margin-bottom: 30px;
                        font-size: 15px;
                    }
                    .otp-container {
                        background: #f9fafb;
                        border: 2px dashed #d1d5db;
                        border-radius: 8px;
                        padding: 25px;
                        text-align: center;
                        margin: 30px 0;
                    }
                    .otp-label {
                        font-size: 14px;
                        color: #6b7280;
                        margin-bottom: 10px;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    }
                    .otp-code {
                        font-size: 36px;
                        font-weight: 700;
                        color: #3b82f6;
                        letter-spacing: 8px;
                        font-family: 'Courier New', monospace;
                    }
                    .warning {
                        background: #fef3c7;
                        border-left: 4px solid #f59e0b;
                        padding: 15px;
                        margin: 20px 0;
                        border-radius: 4px;
                    }
                    .warning-text {
                        color: #92400e;
                        font-size: 14px;
                        margin: 0;
                    }
                    .footer {
                        background: #f9fafb;
                        padding: 20px 30px;
                        text-align: center;
                        color: #6b7280;
                        font-size: 13px;
                        border-top: 1px solid #e5e7eb;
                    }
                    .security-note {
                        margin-top: 20px;
                        padding-top: 20px;
                        border-top: 1px solid #e5e7eb;
                        color: #6b7280;
                        font-size: 13px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>🔐 Password Reset Request</h1>
                    </div>
                    <div class="content">
                        <div class="greeting">Hello,</div>
                        <div class="message">
                            We received a request to reset your password for your Daily Task System account. 
                            Use the OTP code below to complete the password reset process.
                        </div>
                        
                        <div class="otp-container">
                            <div class="otp-label">Your OTP Code</div>
                            <div class="otp-code">${otp}</div>
                        </div>
                        
                        <div class="warning">
                            <p class="warning-text">
                                <strong>⏱️ Important:</strong> This OTP will expire in 15 minutes for security reasons.
                            </p>
                        </div>
                        
                        <div class="message">
                            If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                        </div>
                        
                        <div class="security-note">
                            <strong>Security Tip:</strong> Never share your OTP with anyone. Our team will never ask for your OTP.
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Daily Task Reporting System. All rights reserved.</p>
                        <p>This is an automated message, please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
Hello,

We received a request to reset your password for your Daily Task System account.

Your OTP Code: ${otp}

This OTP will expire in 15 minutes for security reasons.

If you didn't request a password reset, please ignore this email.

Security Tip: Never share your OTP with anyone.

© ${new Date().getFullYear()} Daily Task Reporting System
        `.trim()
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, null, true);
        console.log('OTP email sent successfully:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending OTP email:', error);
        throw new Error('Failed to send OTP email');
    }
};

/**
 * Send daily report email
 * @param {string} email - Recipient email address
 * @param {string} reportContent - The text content of the report
 * @param {string} date - The date string
 * @returns {Promise<void>}
 */
const sendDailyReportEmail = async (email, reportContent, date, senderUser = null) => {
    const mailOptions = {
        from: senderUser ? `"${senderUser.full_name || senderUser.username}" <${senderUser.email}>` : `"Daily Task System" <${transporter.options.auth.user}>`,
        to: email,
        subject: `Daily Work Report - ${date}`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                        line-height: 1.6; 
                        color: #1a1a1a; 
                        background-color: #ffffff; 
                        padding: 30px;
                        margin: 0;
                        text-align: left;
                    }
                    .content { 
                        white-space: pre-wrap; 
                        font-size: 14px;
                        word-wrap: break-word;
                    }
                </style>
            </head>
            <body>
                <div class="content">${reportContent}</div>
            </body>
            </html>
        `,
        text: `Daily Work Report - ${date}\n\n${reportContent}`
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log('Daily report email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending daily report email:', error);
        throw new Error('Failed to send daily report email');
    }
};

/**
 * Send overtime alert email
 * @param {string} email - Recipient email address
 * @param {string} username - User's username
 * @param {number} hoursWorked - Total hours worked
 * @param {number} threshold - Configured threshold
 * @returns {Promise<void>}
 */
const sendOvertimeAlertEmail = async (email, username, hoursWorked, threshold, senderUser = null) => {
    const mailOptions = {
        from: senderUser ? `"${senderUser.full_name || senderUser.username}" <${senderUser.email}>` : `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `⚠️ Overtime Alert: You've been working for ${hoursWorked.toFixed(1)} hours continuously`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; padding: 20px; }
                    .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    .header { text-align: center; margin-bottom: 30px; }
                    .alert-icon { font-size: 48px; margin-bottom: 10px; display: block; }
                    .title { font-size: 24px; font-weight: 700; color: #b91c1c; margin: 0; }
                    .message { font-size: 16px; color: #4b5563; margin-bottom: 25px; }
                    .stat-box { background: #fee2e2; border: 2px solid #fecaca; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 30px; }
                    .stat-value { font-size: 32px; font-weight: 800; color: #b91c1c; display: block; margin-bottom: 5px; }
                    .stat-label { font-size: 14px; color: #7f1d1d; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
                    .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
                    .button { display: inline-block; background: #b91c1c; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <span class="alert-icon">⏰</span>
                        <h1 class="title">Time to Rest!</h1>
                    </div>
                    <div class="message">
                        Hello <strong>${username}</strong>,<br><br>
                        We noticed you have been working for a long time in your current session. It's important to maintain a healthy work-life balance and get enough rest.
                    </div>
                    <div class="stat-box">
                        <span class="stat-value">${hoursWorked.toFixed(1)} Hours</span>
                        <span class="stat-label">Current Session Duration</span>
                    </div>
                    <div class="message" style="text-align: center;">
                        <p>The configured limit is ${threshold} hours. Please consider signing out and taking a break.</p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Daily Task Reporting System</p>
                        <p>This is an automated alert based on your activity logs.</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `Overtime Alert\n\nHello ${username},\n\nYou have been working for ${hoursWorked.toFixed(1)} hours in your current session (Threshold: ${threshold} hours).\n\nPlease consider signing out and taking a rest.\n\nDaily Task Reporting System`
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log(`Overtime alert email sent to ${username} (${email}):`, info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending overtime alert email:', error);
        throw new Error('Failed to send overtime alert email');
    }
};

/**
 * Send username recovery OTP email
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit OTP
 * @param {string} username - Account username for context
 * @returns {Promise<void>}
 */
const sendUsernameOTPEmail = async (email, otp, username) => {
    const safeUsername = escapeHtml(username || 'there');
    const safeOtp = escapeHtml(otp || '');

    const mailOptions = {
        from: `"Daily Task System" <${transporter.options.auth.user}>`,
        to: email,
        subject: 'Verification Code - Daily Task System',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px;background:#f3f4f6;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
                                <tr>
                                    <td style="padding:24px 28px;background:linear-gradient(120deg,#4f46e5,#06b6d4);color:#ffffff;">
                                        <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">Daily Task System</p>
                                        <h2 style="margin:8px 0 0;font-size:24px;line-height:1.2;">Security Verification</h2>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:22px 28px 8px;">
                                        <p style="margin:0 0 10px;font-size:14px;color:#374151;">Hello,</p>
                                        <p style="margin:0;font-size:14px;color:#4b5563;">
                                            Please use the verification code below to complete your request.
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:14px 28px 6px;">
                                        <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:12px;padding:18px;text-align:center;">
                                            <p style="margin:0 0 8px;font-size:12px;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;">Verification Code</p>
                                            <p style="margin:0;font-size:34px;letter-spacing:8px;font-weight:800;color:#4f46e5;font-family:Consolas,'Courier New',monospace;">
                                                ${safeOtp}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 28px 24px;">
                                        <p style="margin:0;font-size:13px;color:#6b7280;">
                                            This code will expire in 10 minutes. If you did not request this, please ignore this email.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `,
        text: [
            'Security Verification Code',
            `Hello,`,
            `Your verification code is: ${otp}`,
            'This code expires in 10 minutes.',
            'If you did not request this, you can safely ignore this email.'
        ].join('\n')
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, null, true);
        console.log('Username recovery OTP email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending username recovery OTP email:', error);
        throw new Error('Failed to send username recovery OTP email');
    }
};

/**
 * Send username recovery email
 * @param {string} email - Recipient email address
 * @param {string} username - The username to recover
 * @returns {Promise<void>}
 */
const sendUsernameEmail = async (email, username) => {
    const mailOptions = {
        from: `"Daily Task System" <${transporter.options.auth.user}>`,
        to: email,
        subject: 'Username Recovery - Daily Task System',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                    .header { background: linear-gradient(135deg, #3b82f6 0%, #9333ea 100%); padding: 30px; text-align: center; color: white; }
                    .header h1 { margin: 0; font-size: 24px; }
                    .content { padding: 40px 30px; }
                    .username-box { background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; padding: 25px; text-align: center; margin: 30px 0; }
                    .username-label { font-size: 14px; color: #6b7280; margin-bottom: 10px; text-transform: uppercase; }
                    .username-value { font-size: 28px; font-weight: 700; color: #3b82f6; }
                    .footer { background: #f9fafb; padding: 20px 30px; text-align: center; color: #6b7280; font-size: 13px; border-top: 1px solid #e5e7eb; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>👤 Username Recovery</h1>
                    </div>
                    <div class="content">
                        <p>We received a request to recover your username for your Daily Task System account.</p>
                        <div class="username-box">
                            <div class="username-label">Your Username</div>
                            <div class="username-value">${username}</div>
                        </div>
                        <p>You can now use this username to log in or reset your password if needed.</p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Daily Task Reporting System. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `Username Recovery\n\nYour username is: ${username}\n\nDaily Task Reporting System`
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, null, true);
        console.log('Username recovery email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending username recovery email:', error);
        throw new Error('Failed to send username recovery email');
    }
};

/**
 * Send leave request notification email to admin
 * @param {string} email - Recipient email address
 * @param {Object} leaveInfo - Leave request details
 * @returns {Promise<void>}
 */
const sendLeaveNotificationEmail = async (email, leaveInfo, senderUser = null) => {
    const { username, department, leaveDates, reason, leaveType, duration, dateRangeStr } = leaveInfo;
    const senderAddress = (transporter && transporter.options && transporter.options.auth && transporter.options.auth.user)
        ? transporter.options.auth.user
        : process.env.SMTP_USER;
    const senderName = String(senderUser?.full_name || senderUser?.username || 'Daily Task System').trim();
    const senderEmail = String(senderUser?.email || '').trim();
    const mailOptions = {
        from: senderEmail ? `"${senderName}" <${senderEmail}>` : `"Daily Task System" <${senderAddress}>`,
        replyTo: senderUser?.email || undefined,
        to: email,
        subject: `🌴 New Leave Request: ${username} (${duration} ${duration > 1 ? 'Days' : 'Day'})`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f7f6; padding: 20px; }
                    .container { max-width: 600px; margin: 0 auto; background: white; padding: 35px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
                    .header { border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 25px; }
                    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0; }
                    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-top: 8px; }
                    .badge-paid { background: #dcfce7; color: #166534; }
                    .badge-unpaid { background: #fee2e2; color: #991b1b; }
                    .info-grid { display: grid; grid-template-columns: 100px 1fr; gap: 12px; margin-bottom: 25px; }
                    .label { color: #64748b; font-size: 13px; font-weight: 600; text-transform: uppercase; }
                    .value { color: #1e293b; font-size: 15px; font-weight: 500; }
                    .reason-box { background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #f1f5f9; color: #334155; font-size: 14px; margin-top: 10px; font-style: italic; }
                    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 30px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 class="title">🌴 New Leave Request</h1>
                        <span class="badge ${leaveType === 'paid' ? 'badge-paid' : 'badge-unpaid'}">
                            ${leaveType} Leave
                        </span>
                    </div>
                    
                    <div class="info-grid">
                        <div class="label">Employee</div>
                        <div class="value">${username} ${department ? `(${department})` : ''}</div>
                        
                        <div class="label">Dates</div>
                        <div class="value">${dateRangeStr}</div>
                        
                        <div class="label">Duration</div>
                        <div class="value">${duration} ${duration > 1 ? 'Days' : 'Day'}</div>
                    </div>

                    <div class="label">Reason</div>
                    <div class="reason-box">
                        "${reason}"
                    </div>

                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Daily Task Reporting System • Automated Notification</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `New Leave Request\n\nEmployee: ${username}\nDepartment: ${department || 'N/A'}\nDates: ${dateRangeStr}\nDuration: ${duration} Days\nType: ${leaveType}\nReason: ${reason}`
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log('Leave notification email sent successfully:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending leave notification email:', error);
        throw new Error('Failed to send leave notification email');
    }
};

/**
 * Send leave resolution notification email to admin
 * @param {string} email - Recipient email address
 * @param {Object} resolutionInfo - Leave resolution details
 * @returns {Promise<void>}
 */
const sendLeaveResolutionNotificationEmail = async (email, resolutionInfo, senderUser = null) => {
    const {
        actorName,
        employeeName,
        status,
        moderatorStatus,
        leaveType,
        dateRangeStr,
        duration
    } = resolutionInfo || {};

    const statusValue = String(status || '').trim().toLowerCase();
    const moderatorStatusValue = String(moderatorStatus || '').trim().toLowerCase();

    let normalizedStatus = 'pending';
    if (statusValue === 'approved') {
        normalizedStatus = 'approved';
    } else if (statusValue === 'rejected' && moderatorStatusValue === 'declined') {
        normalizedStatus = 'declined';
    } else if (statusValue === 'rejected') {
        normalizedStatus = 'rejected';
    } else if (moderatorStatusValue === 'proceeded' || statusValue === 'proceeded' || statusValue === 'pending') {
        normalizedStatus = 'proceeded';
    }

    const subjectStatus = normalizedStatus === 'approved'
        ? 'APPROVED'
        : normalizedStatus === 'declined'
            ? 'DECLINED BY PM'
            : normalizedStatus === 'rejected'
                ? 'REJECTED'
                : normalizedStatus === 'proceeded'
                    ? 'PROCEEDED TO HR'
                    : 'PENDING';
    const statusDisplay = normalizedStatus === 'approved'
        ? 'approved by HR'
        : normalizedStatus === 'declined'
            ? 'declined by Project Manager'
            : normalizedStatus === 'rejected'
                ? 'rejected by HR'
                : normalizedStatus === 'proceeded'
                    ? 'proceeded to HR (waiting final approval)'
                    : 'pending';
    const titleClass = normalizedStatus === 'approved'
        ? 'approved'
        : normalizedStatus === 'proceeded'
            ? 'proceeded'
            : normalizedStatus === 'pending'
                ? 'pending'
                : 'rejected';

    const mailOptions = {
        from: senderUser ? `"${senderUser.full_name || senderUser.username}" <${senderUser.email}>` : `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Leave Request ${subjectStatus}: ${employeeName || 'Employee'}`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; background: #f8fafc; padding: 20px; }
                    .container { max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; padding: 24px; }
                    .title { font-size: 22px; font-weight: 700; margin: 0 0 16px 0; }
                    .approved { color: #166534; }
                    .rejected { color: #991b1b; }
                    .proceeded { color: #1d4ed8; }
                    .pending { color: #475569; }
                    .row { margin: 8px 0; }
                    .label { font-weight: 600; color: #374151; }
                    .value { color: #111827; }
                    .footer { margin-top: 20px; font-size: 12px; color: #6b7280; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 class="title ${titleClass}">Leave Request ${subjectStatus}</h1>
                    <div class="row"><span class="label">Employee:</span> <span class="value">${employeeName || 'Employee'}</span></div>
                    <div class="row"><span class="label">Status:</span> <span class="value">${statusDisplay}</span></div>
                    <div class="row"><span class="label">Action By:</span> <span class="value">${actorName || 'An admin'}</span></div>
                    <div class="row"><span class="label">Type:</span> <span class="value">${leaveType || 'unpaid'}</span></div>
                    <div class="row"><span class="label">Days:</span> <span class="value">${dateRangeStr || 'Unknown'} (${duration || 0} ${Number(duration) === 1 ? 'Day' : 'Days'})</span></div>
                    <div class="footer">Automated notification from Daily Task System.</div>
                </div>
            </body>
            </html>
        `,
        text: [
            `Leave Request ${subjectStatus}`,
            `Employee: ${employeeName || 'Employee'}`,
            `Status: ${statusDisplay}`,
            `Action By: ${actorName || 'An admin'}`,
            `Type: ${leaveType || 'unpaid'}`,
            `Days: ${dateRangeStr || 'Unknown'} (${duration || 0} ${Number(duration) === 1 ? 'Day' : 'Days'})`
        ].join('\n')
    };

    try {
        const info = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log(`Leave resolution email sent to ${email}:`, info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending leave resolution email:', error);
        throw new Error('Failed to send leave resolution email');
    }
};

/**
 * Send onboarding credentials email for newly created users.
 * @param {string} email - Recipient email address
 * @param {Object} info - Credential details
 * @returns {Promise<void>}
 */
const sendNewUserCredentialsEmail = async (email, info, senderUser = null) => {
    const loginEmail = String(info?.loginEmail || email || '').trim().toLowerCase();
    const temporaryPassword = String(info?.temporaryPassword || '').trim();
    const role = String(info?.role || 'employee').trim();
    const department = info?.department ? String(info.department).trim() : '';

    if (!loginEmail || !temporaryPassword) {
        throw new Error('Failed to send credentials email');
    }

    const mailOptions = {
        from: `"Daily Task System" <${process.env.SMTP_USER}>`,
        replyTo: senderUser?.email || undefined,
        to: email,
        subject: 'Your Daily Task System login credentials',
        html: `
            <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.6;max-width:620px;margin:0 auto">
                <h2 style="margin-bottom:10px">Account Created</h2>
                <p>Your account has been created by an administrator.</p>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:18px 0">
                    <p style="margin:0 0 8px"><strong>Login Email:</strong> ${loginEmail}</p>
                    <p style="margin:0 0 8px"><strong>Temporary Password:</strong> ${temporaryPassword}</p>
                    <p style="margin:0 0 8px"><strong>Role:</strong> ${role}</p>
                    <p style="margin:0"><strong>Department:</strong> ${department || 'N/A'}</p>
                </div>
                <p>For security, please sign in and change your password immediately.</p>
                <p style="font-size:12px;color:#64748b">This is an automated message from Daily Task System.</p>
            </div>
        `,
        text: [
            'Account Created',
            '',
            'Your account has been created by an administrator.',
            `Login Email: ${loginEmail}`,
            `Temporary Password: ${temporaryPassword}`,
            `Role: ${role}`,
            `Department: ${department || 'N/A'}`,
            '',
            'For security, please sign in and change your password immediately.'
        ].join('\n')
    };

    try {
        const infoResult = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log(`Credentials email sent to ${loginEmail}:`, infoResult.messageId);
        return infoResult;
    } catch (error) {
        console.error('Error sending credentials email:', error);
        throw new Error('Failed to send credentials email');
    }
};

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const resolveAdminPanelUrl = () => {
    const explicitBase = String(process.env.FRONTEND_URL || process.env.APP_URL || '').trim();
    if (explicitBase) {
        return `${explicitBase.replace(/\/+$/, '')}/admin`;
    }

    const corsOrigins = String(process.env.CORS_ORIGIN || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => /^https?:\/\//i.test(origin));

    if (corsOrigins.length > 0) {
        return `${corsOrigins[0].replace(/\/+$/, '')}/admin`;
    }

    return '';
};

const sendProfileRequestNotificationEmail = async (email, info, senderUser = null) => {
    const {
        requestId,
        employeeName,
        changedFields = [],
        submittedAt = new Date()
    } = info || {};

    const submittedDate = new Date(submittedAt);
    const submittedIso = Number.isNaN(submittedDate.getTime())
        ? new Date().toISOString()
        : submittedDate.toISOString();
    const submittedUtcLabel = Number.isNaN(submittedDate.getTime())
        ? 'Invalid timestamp'
        : submittedDate.toUTCString();

    const adminPanelUrl = resolveAdminPanelUrl();
    const safeEmployee = escapeHtml(employeeName || 'Employee');
    const safeRequestId = escapeHtml(requestId || 'N/A');
    const safeSubmittedAt = escapeHtml(submittedIso);
    const safeSubmittedAtLabel = escapeHtml(submittedUtcLabel);
    const safeAdminPanelUrl = escapeHtml(adminPanelUrl);
    const fields = (Array.isArray(changedFields) ? changedFields : [])
        .map((field) => escapeHtml(field))
        .filter(Boolean);
    const fieldListHtml = fields.length > 0
        ? `<div style="margin-top:6px;">${fields.map((field) => `
                <span style="display:inline-block;margin:4px 6px 0 0;padding:6px 10px;border-radius:999px;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;font-size:12px;font-weight:600;">
                    ${field}
                </span>
            `).join('')}</div>`
        : '<p style="margin:6px 0 0;color:#6b7280;">Field details were not provided.</p>';

    const actionButtonHtml = adminPanelUrl
        ? `
            <tr>
                <td style="padding:22px 28px 8px;">
                    <a href="${safeAdminPanelUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700;font-size:14px;">
                        Review In Admin Panel
                    </a>
                </td>
            </tr>
        `
        : '';

    const actionHintText = adminPanelUrl
        ? `Review this request in admin panel: ${adminPanelUrl}`
        : 'Please review this request in the admin panel.';

    const mailOptions = {
        from: senderUser ? `"${senderUser.full_name || senderUser.username}" <${senderUser.email}>` : `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Profile Update Request from ${employeeName || 'Employee'}`,
        html: `
            <!DOCTYPE html>
            <html>
            <body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
                                <tr>
                                    <td style="padding:24px 28px;background:linear-gradient(120deg,#4f46e5,#06b6d4);color:#ffffff;">
                                        <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">Daily Task System</p>
                                        <h2 style="margin:8px 0 0;font-size:24px;line-height:1.2;">New Profile Update Request</h2>
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:22px 28px 8px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px;">
                                            <tr>
                                                <td style="width:140px;color:#6b7280;font-size:13px;">Employee</td>
                                                <td style="font-size:14px;font-weight:700;color:#111827;">${safeEmployee}</td>
                                            </tr>
                                            <tr>
                                                <td style="width:140px;color:#6b7280;font-size:13px;">Request ID</td>
                                                <td style="font-size:14px;font-weight:700;color:#111827;">#${safeRequestId}</td>
                                            </tr>
                                            <tr>
                                                <td style="width:140px;color:#6b7280;font-size:13px;">Submitted (UTC)</td>
                                                <td style="font-size:14px;color:#111827;">
                                                    <div style="font-weight:700;">${safeSubmittedAtLabel}</div>
                                                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${safeSubmittedAt}</div>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>

                                <tr>
                                    <td style="padding:8px 28px 6px;">
                                        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;">
                                            <p style="margin:0;color:#374151;font-size:13px;font-weight:700;">Changed Fields</p>
                                            ${fieldListHtml}
                                        </div>
                                    </td>
                                </tr>

                                ${actionButtonHtml}

                                <tr>
                                    <td style="padding:4px 28px 24px;">
                                        <p style="margin:0;color:#6b7280;font-size:12px;">
                                            This is an automated notification. Please do not reply to this email.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `,
        text: [
            'New Profile Update Request',
            `Employee: ${employeeName || 'Employee'}`,
            `Request ID: ${requestId || 'N/A'}`,
            `Submitted At (UTC): ${submittedIso}`,
            `Changed Fields: ${fields.length > 0 ? fields.join(', ') : 'Not provided'}`,
            actionHintText
        ].join('\n')
    };

    try {
        const mailInfo = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log(`Profile request email sent to ${email}:`, mailInfo.messageId);
        return mailInfo;
    } catch (error) {
        console.error('Error sending profile request email:', error);
        throw new Error('Failed to send profile request email');
    }
};

const sendProfileResolutionNotificationEmail = async (email, info, senderUser = null) => {
    const {
        requestId,
        employeeName,
        status,
        actorName
    } = info || {};

    const normalizedStatus = status === 'approved' ? 'approved' : 'rejected';
    const isApproved = normalizedStatus === 'approved';
    const statusLabel = isApproved ? 'APPROVED' : 'REJECTED';
    const statusColor = isApproved ? '#15803d' : '#b91c1c';
    const statusBg = isApproved ? '#f0fdf4' : '#fef2f2';
    const statusBorder = isApproved ? '#bbf7d0' : '#fecaca';
    const adminPanelUrl = resolveAdminPanelUrl();
    const safeEmployee = escapeHtml(employeeName || 'Employee');
    const safeRequestId = escapeHtml(requestId || 'N/A');
    const safeActor = escapeHtml(actorName || 'An admin');
    const safeAdminPanelUrl = escapeHtml(adminPanelUrl);

    const actionButtonHtml = adminPanelUrl
        ? `
            <tr>
                <td style="padding:10px 28px 10px;">
                    <a href="${safeAdminPanelUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:10px;font-weight:700;font-size:14px;">
                        Open Admin Panel
                    </a>
                </td>
            </tr>
        `
        : '';

    const mailOptions = {
        from: senderUser ? `"${senderUser.full_name || senderUser.username}" <${senderUser.email}>` : `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Profile Request ${statusLabel}: ${employeeName || 'Employee'}`,
        html: `
            <!DOCTYPE html>
            <html>
            <body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111827;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
                                <tr>
                                    <td style="padding:24px 28px;background:linear-gradient(120deg,#4f46e5,#06b6d4);color:#ffffff;">
                                        <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">Daily Task System</p>
                                        <h2 style="margin:8px 0 0;font-size:24px;line-height:1.2;">Profile Request ${statusLabel}</h2>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:20px 28px 6px;">
                                        <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${statusBg};border:1px solid ${statusBorder};color:${statusColor};font-size:12px;font-weight:700;letter-spacing:0.04em;">
                                            ${statusLabel}
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:10px 28px 6px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px;">
                                            <tr>
                                                <td style="width:140px;color:#6b7280;font-size:13px;">Employee</td>
                                                <td style="font-size:14px;font-weight:700;color:#111827;">${safeEmployee}</td>
                                            </tr>
                                            <tr>
                                                <td style="width:140px;color:#6b7280;font-size:13px;">Request ID</td>
                                                <td style="font-size:14px;font-weight:700;color:#111827;">#${safeRequestId}</td>
                                            </tr>
                                            <tr>
                                                <td style="width:140px;color:#6b7280;font-size:13px;">Handled By</td>
                                                <td style="font-size:14px;font-weight:700;color:#111827;">${safeActor}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                ${actionButtonHtml}
                                <tr>
                                    <td style="padding:8px 28px 24px;">
                                        <p style="margin:0;color:#6b7280;font-size:12px;">
                                            This is an automated notification. Please do not reply to this email.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
        `,
        text: [
            `Profile Request ${statusLabel}`,
            `Employee: ${employeeName || 'Employee'}`,
            `Request ID: ${requestId || 'N/A'}`,
            `Status: ${normalizedStatus}`,
            `Handled By: ${actorName || 'An admin'}`,
            ...(adminPanelUrl ? [`Admin Panel: ${adminPanelUrl}`] : [])
        ].join('\n')
    };

    try {
        const mailInfo = await sendMailWithDomainPolicy(mailOptions, senderUser);
        console.log(`Profile resolution email sent to ${email}:`, mailInfo.messageId);
        return mailInfo;
    } catch (error) {
        console.error('Error sending profile resolution email:', error);
        throw new Error('Failed to send profile resolution email');
    }
};

const sendTrialExpiredEmail = async (email, info = {}) => {
    const companyName = String(info.companyName || 'your company').trim();
    const subject = `Trial expired for ${companyName}`;
    const mailOptions = {
        from: `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject,
        text: `Hello,\n\nYour trial for ${companyName} has expired.\nPlease upgrade your subscription to continue using the dashboard.\n\nThanks,\nDaily Task System`,
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
                <h2 style="margin:0 0 12px;">Trial Expired</h2>
                <p style="margin:0 0 10px;">Your trial for <strong>${companyName}</strong> has expired.</p>
                <p style="margin:0 0 10px;">Please upgrade your subscription to continue using the dashboard.</p>
                <p style="margin:16px 0 0;">Thanks,<br/>Daily Task System</p>
            </div>
        `
    };

    try {
        const mailInfo = await sendMailWithDomainPolicy(mailOptions, null);
        console.log(`Trial expired email sent to ${email}:`, mailInfo.messageId);
        return mailInfo;
    } catch (error) {
        console.error('Error sending trial expired email:', error);
        throw new Error('Failed to send trial expired email');
    }
};

const sendTrialExpiringSoonEmail = async (email, info = {}) => {
    const companyName = String(info.companyName || 'your company').trim();
    const expiresAt = info.expiresAt ? new Date(info.expiresAt) : null;
    const expiresLabel = expiresAt ? expiresAt.toLocaleString() : 'soon';
    const mailOptions = {
        from: `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Trial expiring soon for ${companyName}`,
        text: `Hello,\n\nYour trial for ${companyName} will expire within 1 day (${expiresLabel}).\nPlease upgrade your plan to continue using all features.\n\nThanks,\nDaily Task System`,
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
                <h2 style="margin:0 0 12px;">Trial Expiring Soon</h2>
                <p style="margin:0 0 10px;">Your trial for <strong>${companyName}</strong> will expire within 1 day.</p>
                <p style="margin:0 0 10px;">Expiry time: <strong>${expiresLabel}</strong></p>
                <p style="margin:0 0 10px;">Upgrade your plan to continue without interruption.</p>
                <p style="margin:16px 0 0;">Thanks,<br/>Daily Task System</p>
            </div>
        `
    };
    return sendMailWithDomainPolicy(mailOptions, null);
};

const sendSubscriptionExpiringSoonEmail = async (email, info = {}) => {
    const companyName = String(info.companyName || 'your company').trim();
    const expiresAt = info.expiresAt ? new Date(info.expiresAt) : null;
    const expiresLabel = expiresAt ? expiresAt.toLocaleString() : 'soon';
    const mailOptions = {
        from: `"Daily Task System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Subscription expiring soon for ${companyName}`,
        text: `Hello,\n\nYour subscription for ${companyName} will expire within 3 days (${expiresLabel}).\nPlease renew/upgrade to continue service.\n\nThanks,\nDaily Task System`,
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
                <h2 style="margin:0 0 12px;">Subscription Expiring Soon</h2>
                <p style="margin:0 0 10px;">Your subscription for <strong>${companyName}</strong> will expire within 3 days.</p>
                <p style="margin:0 0 10px;">Expiry time: <strong>${expiresLabel}</strong></p>
                <p style="margin:0 0 10px;">Please renew or upgrade to continue service.</p>
                <p style="margin:16px 0 0;">Thanks,<br/>Daily Task System</p>
            </div>
        `
    };
    return sendMailWithDomainPolicy(mailOptions, null);
};

/**
 * Initialize email service by loading settings from database
 */
const initEmailService = async () => {
    try {
        const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'admin_notification_settings'");
        if (settingsRes.rows.length > 0) {
            const config = JSON.parse(settingsRes.rows[0].value);
            if (config.smtpHost && config.smtpPort && config.smtpUser && config.smtpPass) {
                console.log('[EmailService] Loading SMTP settings from database...');
                configureTransporter({
                    host: config.smtpHost,
                    port: config.smtpPort,
                    user: config.smtpUser,
                    pass: config.smtpPass
                });
            }
        }
    } catch (error) {
        console.error('[EmailService] Failed to load settings from database during init:', error.message);
    }
};

module.exports = {
    initEmailService,
    configureTransporter,
    sendOTPEmail,
    sendUsernameOTPEmail,
    sendDailyReportEmail,
    sendOvertimeAlertEmail,
    sendUsernameEmail,
    sendNewUserCredentialsEmail,
    sendLeaveNotificationEmail,
    sendLeaveResolutionNotificationEmail,
    sendProfileRequestNotificationEmail,
    sendProfileResolutionNotificationEmail,
    sendTrialExpiredEmail,
    sendTrialExpiringSoonEmail,
    sendSubscriptionExpiringSoonEmail
};

