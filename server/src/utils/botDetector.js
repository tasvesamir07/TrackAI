const BOT_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i,
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i,
  /yandex/i, /baidu/i, /sogou/i,
  /headless/i, /puppeteer/i, /selenium/i, /playwright/i,
  /python-requests/i, /curl/i, /wget/i, /httpclient/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /amazonaws/i, /cloudflare/i,
];

const SUSPICIOUS_PATTERNS = [
  /\\x00/, /\0/, /%00/,
  /\\x/, /%2e%2e/,
  /\.\.\//,
  /union.*select/i, /select.*from/i,
  /<script/i, /javascript:/i,
  /\$__/,
];

class BotDetector {
  constructor() {
    this.requestCounts = new Map();
    this.cleanupInterval = null;
  }

  start() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.requestCounts) {
        if (now - data.lastRequest > 60000) {
          this.requestCounts.delete(ip);
        }
      }
    }, 60000);
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  analyze(req) {
    let score = 0;
    const reasons = [];
    const userAgent = req.get('user-agent') || '';
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    if (BOT_PATTERNS.some(p => p.test(userAgent))) {
      score += 40;
      reasons.push('Known bot user-agent');
    }

    if (!req.get('accept-language')) {
      score += 10;
      reasons.push('Missing Accept-Language header');
    }

    if (!req.get('accept')) {
      score += 5;
      reasons.push('Missing Accept header');
    }

    if (req.headers['webdriver'] || req.headers['x-browser']) {
      score += 30;
      reasons.push('Headless browser detected');
    }

    if (req.headers['x-requested-with'] === 'XMLHttpRequest' && !req.get('referer')) {
      score += 15;
      reasons.push('AJAX without referer');
    }

    const userAgentLower = userAgent.toLowerCase();
    if (userAgentLower.includes('python') || userAgentLower.includes('curl') || userAgentLower.includes('wget')) {
      score += 35;
      reasons.push('Programming HTTP library');
    }

    const requestCount = this.getRequestCount(ip);
    if (requestCount > 100) {
      score += 30;
      reasons.push(`High request frequency: ${requestCount}/min`);
    }
    if (requestCount > 1000) {
      score += 50;
      reasons.push(`Very high request frequency: ${requestCount}/min`);
    }

    const referer = req.get('referer') || '';
    if (!referer && req.method !== 'GET') {
      score += 10;
      reasons.push('POST without referer');
    }

    const url = req.originalUrl || req.url || '';
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(url) || pattern.test(userAgent)) {
        score += 20;
        reasons.push('Suspicious URL pattern');
      }
    }

    if (req.get('cache-control') === 'no-cache' && !userAgent) {
      score += 15;
      reasons.push('Cache control with no user agent');
    }

    const accept = req.get('accept') || '';
    if (!accept.includes('text/html') && !accept.includes('application/json')) {
      score += 10;
      reasons.push('Unusual Accept header');
    }

    const isBot = score > 70;
    const confidence = Math.min(score, 100);

    return {
      isBot,
      score,
      confidence,
      reasons,
      userAgent,
      ip,
    };
  }

  getRequestCount(ip) {
    const now = Date.now();
    let data = this.requestCounts.get(ip);
    
    if (!data) {
      data = { count: 0, lastRequest: now };
      this.requestCounts.set(ip, data);
    }

    if (now - data.lastRequest > 60000) {
      data.count = 0;
    }

    data.count++;
    data.lastRequest = now;

    return data.count;
  }

  async logDetection(req, result) {
    try {
      const db = require('../db');
      await db.query(
        `INSERT INTO bot_logs (ip_address, user_agent, score, blocked, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.ip, result.userAgent, result.score, result.isBot, result.reasons.join(', ')]
      );
    } catch (error) {
      console.error('Failed to log bot detection:', error);
    }
  }
}

const botDetector = new BotDetector();

module.exports = botDetector;