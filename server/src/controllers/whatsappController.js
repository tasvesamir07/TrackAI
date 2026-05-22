const whatsappService = require('../utils/whatsappService');
const authController = require('./authController');
const { updateLeaveStatusById, updateLeaveStatusByRequestId } = require('./leaveController');
const db = require('../db');
const {
    buildVirtualAdminUser,
    findUserByPhoneNumber,
    formatRoleLabel,
    getConfiguredWhatsAppAdminLabel,
    isConfiguredWhatsAppAdminNumber
} = require('../utils/adminAccessService');

/**
 * WhatsApp Webhook Verification
 * Twilio does not use a GET verification process like Meta, but keeping the endpoint
 * prevents 404s if pinged.
 */
const verifyWebhook = (req, res) => {
    res.sendStatus(200);
};

/**
 * Find user by phone number
 */
const getUserByPhoneNumber = async (phoneNumber) => {
    if (!phoneNumber) return null;
    const cleaned = whatsappService.cleanPhoneNumber(phoneNumber);
    const res = await db.query(
        `SELECT u.*, t.name as company_name 
         FROM users u 
         LEFT JOIN tenants t ON t.id = u.company_id 
         WHERE u.contact_number = $1`, 
        [cleaned]
    );
    let matchedUser = res.rows[0];
    
    if (!matchedUser) {
        // Try fallback search from findUserByPhoneNumber logic
        matchedUser = await findUserByPhoneNumber(cleaned);
        if (matchedUser) {
            const tenantRes = await db.query('SELECT name FROM tenants WHERE id = $1', [matchedUser.company_id]);
            matchedUser.company_name = tenantRes.rows[0]?.name || null;
        }
    }
    const isHubAdmin = await isConfiguredWhatsAppAdminNumber(cleaned);

    if (matchedUser) {
        if (isHubAdmin && matchedUser.role !== 'admin') {
            return {
                ...matchedUser,
                original_role: matchedUser.role,
                role: 'admin',
                is_communication_hub_admin: true,
                acting_admin_name: (await getConfiguredWhatsAppAdminLabel(cleaned)) || 'Admin'
            };
        }

        return matchedUser;
    }

    if (isHubAdmin) {
        return buildVirtualAdminUser({
            phoneNumber: cleaned,
            actingAdminName: (await getConfiguredWhatsAppAdminLabel(cleaned)) || 'Admin'
        });
    }

    return null;
};

/**
 * Twilio WhatsApp Webhook Message Handler
 */
const handleWebhook = async (req, res) => {
    try {
        const body = req.body;

        // Twilio sends form data directly in the body
        if (!body.From || !body.Body) {
            return res.sendStatus(400); // Invalid Twilio request
        }

        // Acknowledge ASAP
        res.sendStatus(200);

        const messageId = body.MessageSid;
        if (!global.waProcessedIds) global.waProcessedIds = new Map();
        const nowMs = Date.now();

        if (messageId && global.waProcessedIds.has(messageId)) return;
        if (messageId) global.waProcessedIds.set(messageId, nowMs);

        // Twilio format: "whatsapp:+123456789"
        let from = body.From;
        if (from.startsWith('whatsapp:')) {
            from = from.replace('whatsapp:', '');
        }

        let messageBody = body.Body.trim().toLowerCase();
        let buttonId = '';

        // Check if message corresponds to a button/list choice via numerical or text input
        if (messageBody.includes('sign in') || messageBody === '1' || messageBody === '1.') {
            buttonId = 'btn_signin';
        } else if (messageBody.includes('sign out') || messageBody === '3' || messageBody === '3.') {
            buttonId = 'btn_signout';
        } else if (messageBody.includes('break') || messageBody === '2' || messageBody === '2.') {
            buttonId = 'btn_break';
        } else if (messageBody.includes('status')) {
            buttonId = 'btn_status';
        }

        // Check for leave action fallbacks via text
        if (messageBody.startsWith('leave_action_')) {
            buttonId = messageBody;
        }

        // 1. Authenticate User
        const user = await getUserByPhoneNumber(from);
        if (!global.userStates) global.userStates = new Map();

        if (!user) {
            await whatsappService.sendText(from, "That phone number is not registered with this company. Please create an account on our website first.");
            return;
        }

        const io = req.app.get('io');
        const messengerHandler = require('../utils/messengerHandler');

        const platform = {
            sendText: (to, text) => whatsappService.sendText(to, text),
            sendButtons: (to, text, buttons) => whatsappService.sendInteractiveMessage(to, text, buttons.map(b => ({ id: b.id, title: b.text }))),
            sendList: (to, text, buttonText, sections) => whatsappService.sendListMessage(to, text, buttonText, sections),
            formatBold: (text) => `*${text}*`,
            formatItalic: (text) => `_${text}_`,
            formatDivider: () => `━━━━━━━━━━━━━━━`
        };

        // 2. Delegate to Unified Handler (Sign In, Out, Break, Status)
        const handled = await messengerHandler.handleEmployeeMessage({
            user,
            identifier: from,
            platform,
            stateMap: global.userStates,
            messageBody: body.Body.trim(),
            buttonId,
            io,
            authController
        });

        if (handled) return;

        // 3. Handle Other Commands
        if (messageBody === '/option' || messageBody === 'menu') {
            const rows = [
                { id: 'btn_signin', title: 'Sign In' },
                { id: 'btn_break', title: 'Break' },
                { id: 'btn_signout', title: 'Sign Out' }
            ];
            if (user.status === 'break') rows[1] = { id: 'btn_resume', title: 'Resume' };

            const sections = [
                { title: "My Status", rows: [{ id: 'btn_status', title: 'Status' }] },
                { title: "Actions", rows: rows }
            ];
            await whatsappService.sendListMessage(from, `Hello ${user.username} (${formatRoleLabel(user.role)}), please select an option:`, "Menu", sections);
            return;
        }

        // 4. Admin Logic (Leave Approval, Profile Updates)
        if (buttonId.startsWith('leave_action_')) {
            if (user.role !== 'admin') {
                await whatsappService.sendText(from, 'Only admins can approve or reject leave requests.');
                return;
            }

            const parts = buttonId.split('_');
            const action = parts[2];
            const leaveId = parts[3];
            if (['approve', 'reject'].includes(action) && leaveId) {
                const newStatus = action === 'approve' ? 'approved' : 'rejected';
                const isBatch = leaveId.includes('-');
                try {
                    const result = isBatch
                        ? await updateLeaveStatusByRequestId({
                            requestId: leaveId,
                            status: newStatus,
                            io,
                            actedByUserId: user.id || null,
                            actedByName: user.acting_admin_name || user.username || 'Admin',
                            excludeWhatsAppNumbers: [from]
                        })
                        : await updateLeaveStatusById({
                            leaveId,
                            status: newStatus,
                            io,
                            actedByUserId: user.id || null,
                            actedByName: user.acting_admin_name || user.username || 'Admin',
                            excludeWhatsAppNumbers: [from]
                        });

                    await whatsappService.sendText(from, result.summary.plainText);
                } catch (err) {
                    await whatsappService.sendText(
                        from,
                        err.summary?.plainText || (err.statusCode ? err.message : 'Failed to update leave request')
                    );
                }
            }
        } else if (buttonId.startsWith('profile_action_')) {
            if (user.role !== 'admin') {
                await whatsappService.sendText(from, 'Only admins can approve or reject profile requests.');
                return;
            }

            const parts = buttonId.split('_');
            const action = parts[2];
            const requestId = parts[3];
            if (['approve', 'reject'].includes(action) && requestId) {
                const newStatus = action === 'approve' ? 'approved' : 'rejected';
                const requestIdNumber = Number.parseInt(requestId, 10);
                if (!Number.isInteger(requestIdNumber) || requestIdNumber <= 0) {
                    await whatsappService.sendText(from, `Invalid profile request id: ${requestId}`);
                    return;
                }

                const adminController = require('./adminController');
                let responseCode = 200;
                let responseBody = null;
                const reqMock = {
                    params: { requestId: requestIdNumber },
                    body: { status: newStatus },
                    user: {
                        id: user.id || null,
                        username: user.acting_admin_name || user.username || 'Admin',
                        acting_admin_name: user.acting_admin_name || null,
                        email: user.email || null,
                        contact_number: user.contact_number || from || null
                    },
                    app: req.app
                };
                const resMock = {
                    status(code) {
                        responseCode = code;
                        return this;
                    },
                    json(payload) {
                        responseBody = payload;
                        return payload;
                    }
                };

                await adminController.handleProfileRequest(reqMock, resMock);
                if (responseCode >= 400 || responseBody?.error) {
                    await whatsappService.sendText(from, `Failed to process profile request: ${responseBody?.error || 'Unknown error'}`);
                    return;
                }

                await whatsappService.sendText(from, responseBody?.message || `Profile update handled: ${newStatus}`);
            }
        }

        if (messageBody === '/update' && (user.role === 'admin' || user.role === 'moderator')) {
            const { generateFinalReport, getLogicalDate } = require('../utils/reportService');
            const reportText = await generateFinalReport(getLogicalDate());
            await whatsappService.sendText(from, `Real-time Update:\n\n${reportText}`);
        }

    } catch (error) {
        console.error('WHATSAPP_WEBHOOK_ERROR:', error);
    }
};

module.exports = { verifyWebhook, handleWebhook };
