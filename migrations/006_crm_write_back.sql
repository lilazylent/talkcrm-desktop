-- Phase 5: audit of user-initiated amoCRM mutations and a cache of amoCRM history events.
-- No CRM entity is duplicated: entity state stays in crm_entities and is reconciled from amoCRM after each write.
CREATE TABLE IF NOT EXISTS crm_operations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_external_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sending','confirmed','failed','needs_refresh','conflict')),
  request_fingerprint TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL DEFAULT '[]',
  result_external_id INTEGER,
  remote_updated_at INTEGER,
  error_category TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_operations_entity ON crm_operations(account_id, entity_type, entity_external_id, created_at);
CREATE INDEX IF NOT EXISTS idx_crm_operations_result ON crm_operations(account_id, operation_type, result_external_id);

CREATE TABLE IF NOT EXISTS crm_events (
  account_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_events_entity ON crm_events(account_id, entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS crm_event_loads (
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  loaded_at TEXT NOT NULL,
  error TEXT,
  PRIMARY KEY(account_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS crm_field_groups (
  account_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id, entity, group_id)
);
