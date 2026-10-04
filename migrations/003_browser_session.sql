ALTER TABLE crm_accounts ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'oauth' CHECK(auth_mode IN ('oauth','browser'));
