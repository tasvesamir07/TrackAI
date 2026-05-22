-- Referral Program

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_company_id UUID REFERENCES tenants(id),
  referred_company_id UUID REFERENCES tenants(id),
  reward_months INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_company_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_company_id);

-- Add referral_code to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code TEXT;

-- Generate referral codes for existing companies
UPDATE tenants SET referral_code = encode(gen_random_bytes(8), 'hex') WHERE referral_code IS NULL;