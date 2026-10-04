ALTER TABLE deals ADD COLUMN source TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'demo';
CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, external_id INTEGER NOT NULL, domain TEXT NOT NULL UNIQUE, name TEXT NOT NULL, current_user_id INTEGER NOT NULL, authorized INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_sync_at TEXT, state TEXT NOT NULL, error TEXT, currency TEXT);
CREATE TABLE crm_entities (account_id TEXT NOT NULL REFERENCES crm_accounts(id), kind TEXT NOT NULL, external_id INTEGER NOT NULL, local_id TEXT NOT NULL, payload_json TEXT NOT NULL, external_updated_at INTEGER, last_seen_at TEXT NOT NULL, availability TEXT NOT NULL DEFAULT 'active', PRIMARY KEY(account_id,kind,external_id));
CREATE UNIQUE INDEX idx_crm_identity ON crm_entities(account_id,kind,local_id);
CREATE TABLE crm_relations (account_id TEXT NOT NULL REFERENCES crm_accounts(id), lead_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, is_primary INTEGER NOT NULL, PRIMARY KEY(account_id,lead_id,entity_type,entity_id));
CREATE TABLE crm_fields (account_id TEXT NOT NULL REFERENCES crm_accounts(id), entity TEXT NOT NULL, external_id INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(account_id,entity,external_id));
CREATE TABLE sync_runs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES crm_accounts(id), started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL, warnings_json TEXT NOT NULL DEFAULT '[]', counts_json TEXT NOT NULL DEFAULT '{}');
INSERT INTO app_settings(key,value) VALUES ('data_mode','demo');
