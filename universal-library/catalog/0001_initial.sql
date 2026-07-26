PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at_ms INTEGER NOT NULL
);

CREATE TABLE roots (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  filesystem_kind TEXT,
  volume_id TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  is_online INTEGER NOT NULL DEFAULT 1 CHECK (is_online IN (0, 1)),
  added_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  identity_version INTEGER NOT NULL DEFAULT 1,
  media_kind TEXT NOT NULL DEFAULT 'unknown',
  canonical_name TEXT NOT NULL,
  extension TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at_ns INTEGER,
  modified_at_ns INTEGER,
  quick_fingerprint TEXT,
  content_hash TEXT,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER,
  CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  root_id TEXT REFERENCES roots(id) ON DELETE SET NULL,
  path TEXT NOT NULL UNIQUE,
  relative_path TEXT,
  device_id TEXT,
  inode TEXT,
  file_index TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  is_online INTEGER NOT NULL DEFAULT 1 CHECK (is_online IN (0, 1)),
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  missing_since_ms INTEGER
);

CREATE UNIQUE INDEX locations_primary_asset_idx
  ON locations(asset_id)
  WHERE is_primary = 1;

CREATE INDEX locations_asset_idx ON locations(asset_id);
CREATE INDEX locations_root_idx ON locations(root_id);
CREATE INDEX locations_filesystem_identity_idx ON locations(device_id, inode);
CREATE INDEX assets_content_hash_idx ON assets(content_hash);
CREATE INDEX assets_quick_fingerprint_idx ON assets(quick_fingerprint);
CREATE INDEX assets_media_kind_idx ON assets(media_kind);
CREATE INDEX assets_modified_idx ON assets(modified_at_ns);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT,
  parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  assigned_at_ms INTEGER NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY (asset_id, tag_id)
);

CREATE INDEX asset_tags_tag_idx ON asset_tags(tag_id);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  collection_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (collection_kind IN ('manual', 'smart', 'temporary')),
  query_json TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX collections_parent_idx ON collections(parent_id);

CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  section_name TEXT,
  note TEXT,
  added_at_ms INTEGER NOT NULL,
  PRIMARY KEY (collection_id, asset_id)
);

CREATE INDEX collection_items_order_idx
  ON collection_items(collection_id, position);

CREATE TABLE asset_metadata (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  confidence REAL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (asset_id, namespace, key),
  CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0))
);

CREATE INDEX asset_metadata_lookup_idx
  ON asset_metadata(namespace, key);

CREATE TABLE asset_relations (
  source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  target_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  relation_kind TEXT NOT NULL,
  metadata_json TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (source_asset_id, target_asset_id, relation_kind),
  CHECK (source_asset_id <> target_asset_id)
);

CREATE INDEX asset_relations_target_idx ON asset_relations(target_asset_id);

CREATE TABLE previews (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  preview_kind TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  cache_path TEXT NOT NULL,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  source_fingerprint TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_accessed_at_ms INTEGER,
  UNIQUE (asset_id, preview_kind, adapter_id)
);

CREATE INDEX previews_asset_idx ON previews(asset_id);

CREATE TABLE saved_queries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  completed_at_ms INTEGER,
  error_text TEXT
);

CREATE INDEX analysis_jobs_queue_idx
  ON analysis_jobs(state, priority DESC, requested_at_ms);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at_ms INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  details_json TEXT
);

CREATE INDEX audit_log_time_idx ON audit_log(occurred_at_ms DESC);

INSERT INTO schema_migrations(version, applied_at_ms)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

PRAGMA user_version = 1;
