-- Phase 6: conversations discovered through the official amoCRM Talks API (metadata only, no message bodies).
CREATE TABLE IF NOT EXISTS crm_talks (
  account_id TEXT NOT NULL,
  talk_id INTEGER NOT NULL,
  chat_id TEXT,
  contact_id INTEGER,
  entity_id INTEGER,
  entity_type TEXT,
  origin TEXT,
  source_id INTEGER,
  status TEXT,
  is_in_work INTEGER NOT NULL DEFAULT 0,
  is_read INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER,
  last_seen_at TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY(account_id, talk_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_talks_contact ON crm_talks(account_id, contact_id);
