use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, Row, backup::Backup, params};
use serde::Serialize;
use uuid::Uuid;

const CURRENT_SCHEMA_VERSION: i64 = 1;
const INITIAL_MIGRATION: &str = include_str!("../../catalog/0001_initial.sql");

#[derive(Debug)]
pub struct Catalog {
    connection: Connection,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RootRecord {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub filesystem_kind: Option<String>,
    pub volume_id: Option<String>,
    pub is_enabled: bool,
    pub is_online: bool,
    pub added_at_ms: i64,
    pub last_seen_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRecord {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub cover_asset_id: Option<String>,
    pub collection_kind: String,
    pub query_json: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthRecord {
    pub status: &'static str,
    pub database_path: String,
    pub schema_version: i64,
    pub root_count: i64,
    pub collection_count: i64,
}

impl Catalog {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = non_empty_parent(&path) {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create catalog directory {}", parent.display())
            })?;
        }

        let connection = Connection::open(&path)
            .with_context(|| format!("failed to open catalog {}", path.display()))?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .context("failed to enable SQLite foreign keys")?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .context("failed to configure SQLite busy timeout")?;

        let catalog = Self { connection, path };
        catalog.migrate()?;
        Ok(catalog)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> Result<i64> {
        self.connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .context("failed to read catalog schema version")
    }

    pub fn health(&self) -> Result<HealthRecord> {
        Ok(HealthRecord {
            status: "ok",
            database_path: self.path.to_string_lossy().into_owned(),
            schema_version: self.schema_version()?,
            root_count: self.table_count("roots")?,
            collection_count: self.table_count("collections")?,
        })
    }

    pub fn add_root(
        &self,
        path: impl AsRef<Path>,
        display_name: Option<&str>,
    ) -> Result<RootRecord> {
        let canonical_path = fs::canonicalize(path.as_ref())
            .with_context(|| format!("library root does not exist: {}", path.as_ref().display()))?;
        let metadata = fs::metadata(&canonical_path)
            .with_context(|| format!("failed to inspect root {}", canonical_path.display()))?;
        if !metadata.is_dir() {
            bail!(
                "library root must be a directory: {}",
                canonical_path.display()
            );
        }

        let path_string = canonical_path.to_string_lossy().into_owned();
        let fallback_name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(&path_string);
        let display_name = display_name.unwrap_or(fallback_name).trim();
        if display_name.is_empty() {
            bail!("root display name cannot be empty");
        }

        if let Some(existing) = self.find_root_by_path(&path_string)? {
            let now = now_ms()?;
            self.connection.execute(
                "UPDATE roots
                 SET display_name = ?1, is_enabled = 1, is_online = 1, last_seen_at_ms = ?2
                 WHERE id = ?3",
                params![display_name, now, existing.id],
            )?;
            return self
                .find_root_by_path(&path_string)?
                .context("root disappeared after update");
        }

        let now = now_ms()?;
        let id = Uuid::new_v4().to_string();
        self.connection.execute(
            "INSERT INTO roots (
                id, path, display_name, is_enabled, is_online, added_at_ms, last_seen_at_ms
             ) VALUES (?1, ?2, ?3, 1, 1, ?4, ?4)",
            params![id, path_string, display_name, now],
        )?;

        self.find_root_by_path(&path_string)?
            .context("root was not readable after insert")
    }

    pub fn list_roots(&self) -> Result<Vec<RootRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, path, display_name, filesystem_kind, volume_id,
                    is_enabled, is_online, added_at_ms, last_seen_at_ms
             FROM roots
             ORDER BY display_name COLLATE NOCASE, path COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], root_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to read library roots")
    }

    pub fn create_collection(&self, name: &str, kind: &str) -> Result<CollectionRecord> {
        let name = name.trim();
        if name.is_empty() {
            bail!("collection name cannot be empty");
        }
        if !matches!(kind, "manual" | "smart" | "temporary") {
            bail!("collection kind must be manual, smart, or temporary");
        }

        let id = Uuid::new_v4().to_string();
        let now = now_ms()?;
        self.connection.execute(
            "INSERT INTO collections (
                id, name, collection_kind, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, name, kind, now],
        )?;

        self.find_collection(&id)?
            .context("collection was not readable after insert")
    }

    pub fn list_collections(&self) -> Result<Vec<CollectionRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT id, parent_id, name, description, cover_asset_id,
                    collection_kind, query_json, created_at_ms, updated_at_ms
             FROM collections
             ORDER BY name COLLATE NOCASE, created_at_ms",
        )?;
        let rows = statement.query_map([], collection_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to read collections")
    }

    pub fn backup(&self, output: impl AsRef<Path>) -> Result<PathBuf> {
        let output = output.as_ref();
        if output == self.path {
            bail!("backup destination must differ from the active catalog");
        }
        if output.exists() {
            bail!("backup destination already exists: {}", output.display());
        }
        if let Some(parent) = non_empty_parent(output) {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create backup directory {}", parent.display())
            })?;
        }

        let mut destination = Connection::open(output)
            .with_context(|| format!("failed to create backup {}", output.display()))?;
        let backup = Backup::new(&self.connection, &mut destination)
            .context("failed to initialize SQLite backup")?;
        backup
            .run_to_completion(128, Duration::from_millis(10), None)
            .context("failed to complete SQLite backup")?;

        Ok(output.to_path_buf())
    }

    fn migrate(&self) -> Result<()> {
        let version = self.schema_version()?;
        match version {
            0 => self
                .connection
                .execute_batch(INITIAL_MIGRATION)
                .context("failed to apply catalog migration 1"),
            CURRENT_SCHEMA_VERSION => Ok(()),
            value if value > CURRENT_SCHEMA_VERSION => bail!(
                "catalog schema {value} is newer than supported schema {CURRENT_SCHEMA_VERSION}"
            ),
            value => bail!("catalog schema {value} has no registered migration path"),
        }
    }

    fn table_count(&self, table: &str) -> Result<i64> {
        if !matches!(table, "roots" | "collections") {
            bail!("unsupported count table: {table}");
        }
        self.connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .with_context(|| format!("failed to count {table}"))
    }

    fn find_root_by_path(&self, path: &str) -> Result<Option<RootRecord>> {
        self.connection
            .query_row(
                "SELECT id, path, display_name, filesystem_kind, volume_id,
                        is_enabled, is_online, added_at_ms, last_seen_at_ms
                 FROM roots WHERE path = ?1",
                [path],
                root_from_row,
            )
            .optional()
            .context("failed to look up root")
    }

    fn find_collection(&self, id: &str) -> Result<Option<CollectionRecord>> {
        self.connection
            .query_row(
                "SELECT id, parent_id, name, description, cover_asset_id,
                        collection_kind, query_json, created_at_ms, updated_at_ms
                 FROM collections WHERE id = ?1",
                [id],
                collection_from_row,
            )
            .optional()
            .context("failed to look up collection")
    }
}

pub fn default_database_path() -> Result<PathBuf> {
    if let Some(path) = env::var_os("ULIB_DATABASE") {
        return Ok(PathBuf::from(path));
    }
    if let Some(path) = env::var_os("XDG_DATA_HOME") {
        return Ok(PathBuf::from(path)
            .join("universal-library")
            .join("catalog.sqlite3"));
    }
    let home = env::var_os("HOME")
        .context("cannot resolve catalog path: set ULIB_DATABASE or provide HOME/XDG_DATA_HOME")?;
    Ok(PathBuf::from(home)
        .join(".local")
        .join("share")
        .join("universal-library")
        .join("catalog.sqlite3"))
}

fn root_from_row(row: &Row<'_>) -> rusqlite::Result<RootRecord> {
    Ok(RootRecord {
        id: row.get(0)?,
        path: row.get(1)?,
        display_name: row.get(2)?,
        filesystem_kind: row.get(3)?,
        volume_id: row.get(4)?,
        is_enabled: row.get::<_, i64>(5)? != 0,
        is_online: row.get::<_, i64>(6)? != 0,
        added_at_ms: row.get(7)?,
        last_seen_at_ms: row.get(8)?,
    })
}

fn collection_from_row(row: &Row<'_>) -> rusqlite::Result<CollectionRecord> {
    Ok(CollectionRecord {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        cover_asset_id: row.get(4)?,
        collection_kind: row.get(5)?,
        query_json: row.get(6)?,
        created_at_ms: row.get(7)?,
        updated_at_ms: row.get(8)?,
    })
}

fn non_empty_parent(path: &Path) -> Option<&Path> {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
}

#[cfg(test)]
mod tests {
    use super::non_empty_parent;
    use std::path::Path;

    #[test]
    fn relative_catalog_paths_do_not_require_an_empty_directory() {
        assert_eq!(non_empty_parent(Path::new("catalog.sqlite3")), None);
        assert_eq!(
            non_empty_parent(Path::new("state/catalog.sqlite3")),
            Some(Path::new("state"))
        );
    }
}

fn now_ms() -> Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before the Unix epoch")?;
    i64::try_from(duration.as_millis()).context("timestamp exceeds SQLite integer range")
}
