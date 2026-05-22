const twilio = require('twilio');

/**
 * WhatsApp Service - International Phone Number Support
 */

const cleanPhoneNumber = (phone) => {
    if (!phone) return '';
    let cleaned = phone.trim();

    if (cleaned.startsWith('whatsapp:')) {
        cleaned = cleaned.replace('whatsapp:', '');
    }

    if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1).replace(/\D/g, '');
    } else {
        cleaned = cleaned.replace(/\D/g, '');
    }

    // Handle Bangladesh local format
    if (cleaned.startsWith('0') && cleaned.length === 11) {
        cleaned = '88' + cleaned;
    }

    return '+' + cleaned;
};

const getTwilioClient = () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        throw new Error('Twilio credentials missing in environment variables.');
    }
    return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
};

const sendMessage = async (to, messageData) => {
    const client = getTwilioClient();
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';
    
    if (!fromNumber) {
        throw new Error('TWILIO_WHATSAPP_NUMBER missing in environment variables.');
    }

    const formattedTo = cleanPhoneNumber(to);
    console.log(`[TwilioService] Attempting to send to: ${to} (Formatted: ${formattedTo})`);

    const params = {
        from: `whatsapp:${fromNumber}`,
        to: `whatsapp:${formattedTo}`,
        ...messageData
    };

    return client.messages.create(params);
};

const sendTemplate = (to, templateName = 'hello_world', languageCode = 'en_US') => {
    // Twilio requires pre-approved Content Templates using Content API
    // or just sending the exact text body. For basic testing, fallback to text.
    return sendMessage(to, { body: `[Template: ${templateName}]` });
};

const sendText = (to, text) => {
    return sendMessage(to, { body: text });
};

const sendImage = (to, imageUrl, caption = '') => {
    return sendMessage(to, { mediaUrl: [imageUrl], body: caption });
};

const sendVideo = (to, videoUrl, caption = '') => {
    return sendMessage(to, { mediaUrl: [videoUrl], body: caption });
};

const sendDocument = (to, documentUrl, filename = '', caption = '') => {
    // Twilio mediaUrl supports documents
    return sendMessage(to, { mediaUrl: [documentUrl], body: caption });
};

module.exports = {
    sendMessage,
    sendTemplate,
    sendText,
    sendImage,
    sendVideo,
    sendDocument,
    sendInteractiveMessage: (to, bodyText, buttons) => {
        let text = bodyText + '\n\n';
        buttons.forEach((btn, index) => {
            text += `${index + 1}. ${btn.title}\n`;
        });
        text += '\n(Reply with the number or exact button title)';
        return sendText(to, text);
    },
    sendListMessage: (to, bodyText, buttonText, sections) => {
        let text = bodyText + '\n\n';
        sections.forEach(sec => {
            text += `*${sec.title}*\n`;
            sec.rows.forEach(row => {
                text += `- ${row.title}\n`;
            });
            text += '\n';
        });
        text += '(Reply with your choice)';
        return sendText(to, text);
    },
    cleanPhoneNumber
};
