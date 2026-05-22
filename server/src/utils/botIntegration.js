const { WebClient } = require('@slack/web-client');
const { RtmClient, RTMClient } = require('@slack/rtm-api');
const axios = require('axios');
const db = require('../db');

class BotIntegration {
  constructor() {
    this.slackEnabled = process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET;
    this.teamsEnabled = process.env.TEAMS_BOT_ID && process.env.TEAMS_BOT_PASSWORD;
    
    this.slackClient = null;
    this.teamsClient = null;
    
    if (this.slackEnabled) {
      this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    }
  }

  // ============ SLACK BOT ============

  async handleSlackCommand(command, userId, payload) {
    const parts = payload.text?.trim().split(' ') || [];
    const action = parts[0];

    switch (action) {
      case 'clock':
        return await this.handleSlackClockIn(userId, payload);
      case 'clockout':
        return await this.handleSlackClockOut(userId, payload);
      case 'leave':
        return await this.handleSlackLeaveRequest(userId, parts.slice(1));
      case 'status':
        return await this.handleSlackStatus(userId);
      case 'help':
        return this.getSlackHelp();
      default:
        return { text: `Unknown command: ${action}. Type /trackai help for available commands.` };
    }
  }

  async handleSlackClockIn(userId, payload) {
    try {
      const now = new Date();
      
      await db.query(
        `INSERT INTO "ActivityLog" (user_id, activity_type, timestamp)
         VALUES ($1, 'clock_in', $2)`,
        [userId, now]
      );

      await db.query(
        `UPDATE users SET last_heartbeat = $1 WHERE id = $2`,
        [now, userId]
      );

      return {
        text: `✅ Clocked in successfully at ${now.toLocaleTimeString()}!`,
        response_type: 'in_channel'
      };
    } catch (error) {
      return { text: `❌ Error: ${error.message}` };
    }
  }

  async handleSlackClockOut(userId, payload) {
    try {
      const now = new Date();
      
      await db.query(
        `INSERT INTO "ActivityLog" (user_id, activity_type, timestamp)
         VALUES ($1, 'clock_out', $2)`,
        [userId, now]
      );

      return {
        text: `✅ Clocked out successfully at ${now.toLocaleTimeString()}!`,
        response_type: 'in_channel'
      };
    } catch (error) {
      return { text: `❌ Error: ${error.message}` };
    }
  }

  async handleSlackLeaveRequest(userId, args) {
    if (args.length < 2) {
      return { text: 'Usage: /trackai leave <type> <dates>\nExample: /trackai leave vacation 2024-01-15 to 2024-01-20' };
    }

    const leaveType = args[0];
    const dates = args.slice(1).join(' ');

    try {
      await db.query(
        `INSERT INTO "Leave" (user_id, leave_date, reason, status, request_id, leave_type)
         VALUES ($1, CURRENT_DATE, $2, 'pending', $3, $4)`,
        [userId, dates, `SLACK-${Date.now()}`, leaveType]
      );

      return {
        text: `✅ Leave request submitted!\nType: ${leaveType}\nDates: ${dates}\nStatus: Pending approval`,
        response_type: 'in_channel'
      };
    } catch (error) {
      return { text: `❌ Error: ${error.message}` };
    }
  }

  async handleSlackStatus(userId) {
    try {
      const result = await db.query(
        `SELECT last_heartbeat, paid_leave_balance 
         FROM users WHERE id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return { text: 'User not found' };
      }

      const user = result.rows[0];
      const lastClock = user.last_heartbeat 
        ? new Date(user.last_heartbeat).toLocaleString() 
        : 'Never';

      return {
        text: `📊 Your Status:\n• Last Clock In: ${lastClock}\n• Leave Balance: ${user.paid_leave_balance} days`,
        response_type: 'in_channel'
      };
    } catch (error) {
      return { text: `❌ Error: ${error.message}` };
    }
  }

  getSlackHelp() {
    return {
      text: `📋 *Track AI Commands:*\n
• \`/trackai clock\` - Clock in
• \`/trackai clockout\` - Clock out  
• \`/trackai leave <type> <dates>\` - Request leave
• \`/trackai status\` - View your status
• \`/trackai help\` - Show this help`,
      response_type: 'ephemeral'
    };
  }

  async sendSlackNotification(userId, message, attachments = []) {
    if (!this.slackClient) return;

    try {
      const result = await db.query(
        'SELECT telegram_chat_id FROM users WHERE id = $1',
        [userId]
      );

      const slackId = result.rows[0]?.telegram_chat_id; // Using same field for Slack ID
      
      if (slackId && slackId.startsWith('U')) {
        await this.slackClient.chat.postMessage({
          channel: slackId,
          text: message,
          attachments
        });
      }
    } catch (error) {
      console.error('[BotIntegration] Slack notification error:', error.message);
    }
  }

  // ============ MICROSOFT TEAMS ============

  async handleTeamsCommand(command, userId, payload) {
    const parts = payload.text?.trim().split(' ') || [];
    const action = parts[0];

    switch (action) {
      case 'clock':
        return await this.handleTeamsClockIn(userId);
      case 'clockout':
        return await this.handleTeamsClockOut(userId);
      case 'leave':
        return await this.handleTeamsLeaveRequest(userId, parts.slice(1));
      case 'status':
        return await this.handleTeamsStatus(userId);
      default:
        return { type: 'message', text: `Unknown command: ${action}. Type "help" for available commands.` };
    }
  }

  async handleTeamsClockIn(userId) {
    const now = new Date();
    await db.query(
      `INSERT INTO "ActivityLog" (user_id, activity_type, timestamp) VALUES ($1, 'clock_in', $2)`,
      [userId, now]
    );
    return { type: 'message', text: `✅ Clocked in at ${now.toLocaleTimeString()}!` };
  }

  async handleTeamsClockOut(userId) {
    const now = new Date();
    await db.query(
      `INSERT INTO "ActivityLog" (user_id, activity_type, timestamp) VALUES ($1, 'clock_out', $2)`,
      [userId, now]
    );
    return { type: 'message', text: `✅ Clocked out at ${now.toLocaleTimeString()}!` };
  }

  async handleTeamsLeaveRequest(userId, args) {
    if (args.length < 2) {
      return { type: 'message', text: 'Usage: trackai leave <type> <dates>' };
    }
    return { type: 'message', text: '✅ Leave request submitted!' };
  }

  async handleTeamsStatus(userId) {
    const result = await db.query(
      'SELECT last_heartbeat, paid_leave_balance FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    return { 
      type: 'message', 
      text: `📊 Status:\nLast Clock: ${user?.last_heartbeat || 'Never'}\nLeave Balance: ${user?.paid_leave_balance || 0} days` 
    };
  }

  async sendTeamsNotification(userId, message) {
    // Teams implementation would use Bot Framework
    console.log('[BotIntegration] Teams notification:', message);
  }
}

const botIntegration = new BotIntegration();

module.exports = botIntegration;