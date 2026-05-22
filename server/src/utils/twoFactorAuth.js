const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

class TwoFactorAuth {
  constructor() {
    this.issuer = process.env.TWO_FACTOR_ISSUER || 'DailyTaskSystem';
  }

  generateSecret(user) {
    const secret = speakeasy.generateSecret({
      name: `${user.email || user.username}@${this.issuer}`,
      issuer: this.issuer,
      length: 20
    });

    return {
      secret: secret.base32,
      otpauth_url: secret.otpauth_url
    };
  }

  async generateQRCode(otpauthUrl) {
    try {
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
      return qrDataUrl;
    } catch (error) {
      console.error('Error generating QR code:', error);
      return null;
    }
  }

  verifyToken(secret, token) {
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 1
    });
    return verified;
  }

  generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push({
        code,
        used: false,
        usedAt: null
      });
    }
    return codes;
  }

  verifyBackupCode(user, code) {
    const backupCodes = user.backup_codes || [];
    const found = backupCodes.find(
      bc => bc.code === code.toUpperCase() && !bc.used
    );
    
    if (found) {
      found.used = true;
      found.usedAt = new Date().toISOString();
      return { valid: true, remainingCodes: backupCodes.filter(bc => !bc.used).length };
    }
    
    return { valid: false, remainingCodes: backupCodes.filter(bc => !bc.used).length };
  }
}

const twoFactorAuth = new TwoFactorAuth();

module.exports = twoFactorAuth;