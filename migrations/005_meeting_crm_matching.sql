CREATE TABLE meeting_crm_links (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  crm_account_id TEXT,
  client_id TEXT, contact_id INTEGER, company_id INTEGER, deal_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('unlinked','proposed','confirmed','needs_review')),
  confidence TEXT, candidate_score INTEGER,
  match_method TEXT, confirmed_by_user TEXT, confirmed_at TEXT,
  confirmed_json TEXT, candidates_json TEXT NOT NULL DEFAULT '[]', warning TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX meeting_crm_links_client ON meeting_crm_links(crm_account_id,client_id);
CREATE INDEX meeting_crm_links_deal ON meeting_crm_links(crm_account_id,deal_id);
CREATE TABLE meeting_crm_link_history (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  action TEXT NOT NULL, previous_json TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE meeting_participants ADD COLUMN phone TEXT;
