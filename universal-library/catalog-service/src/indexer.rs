use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde::Serialize;
use uuid::Uuid;

use super::{Catalog, RootRecord, now_ms};

const BATCH_SIZE: usize = 500;
const MAX_REPORTED_ISSUES: usize = 100;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ScanOptions {
    pub include_hidden: bool,
    pub include_ignored: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssue {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub root_id: String,
    pub root_path: String,
    pub root_online: bool,
    pub started_at_ms: i64,
    pub completed_at_ms: i64,
    pub complete: bool,
    pub directories_seen: u64,
    pub files_seen: u64,
    pub assets_created: u64,
    pub assets_updated: u64,
    pub locations_created: u64,
    pub locations_moved: u64,
    pub locations_marked_offline: u64,
    pub skipped_entries: u64,
    pub issue_count: u64,
    pub issues: Vec<ScanIssue>,
}

#[derive(Debug)]
struct FileSnapshot {
    path: String,
    relative_path: String,
    name: String,
    extension: Option<String>,
    media_kind: &'static str,
    size_bytes: i64,
    created_at_ns: Option<i64>,
    modified_at_ns: Option<i64>,
    device_id: Option<String>,
    inode: Option<String>,
}

#[derive(Debug)]
struct LocationIdentity {
    id: i64,
    asset_id: String,
    path: String,
}

#[derive(Debug, Default)]
struct ScanCounters {
    directories_seen: u64,
    files_seen: u64,
    assets_created: u64,
    assets_updated: u64,
    locations_created: u64,
    locations_moved: u64,
    locations_marked_offline: u64,
    skipped_entries: u64,
    issue_count: u64,
    issues: Vec<ScanIssue>,
}

impl Catalog {
    pub fn scan_root(&mut self, root_reference: &str, options: ScanOptions) -> Result<ScanReport> {
        let root = resolve_root(&self.connection, root_reference)?;
        let started_at_ms = next_scan_timestamp(&self.connection, &root.id)?;
        let root_path = PathBuf::from(&root.path);
        let mut counters = ScanCounters::default();

        if !root_path.is_dir() {
            let completed_at_ms = now_ms()?;
            let transaction = self.connection.transaction()?;
            transaction.execute("UPDATE roots SET is_online = 0 WHERE id = ?1", [&root.id])?;
            counters.locations_marked_offline = u64::try_from(transaction.execute(
                "UPDATE locations
                 SET is_online = 0,
                     missing_since_ms = COALESCE(missing_since_ms, ?1)
                 WHERE root_id = ?2 AND is_online = 1",
                params![started_at_ms, root.id],
            )?)?;
            transaction.commit()?;
            counters.push_issue(&root.path, "library root is unavailable");
            return Ok(counters.into_report(&root, false, started_at_ms, completed_at_ms, false));
        }

        let catalog_artifacts = catalog_artifact_paths(self.path());
        let mut directories = VecDeque::from([root_path.clone()]);
        let mut batch = Vec::with_capacity(BATCH_SIZE);

        while let Some(directory) = directories.pop_front() {
            counters.directories_seen += 1;
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) => {
                    counters.push_issue(&directory, &format!("cannot read directory: {error}"));
                    continue;
                }
            };

            for entry_result in entries {
                let entry = match entry_result {
                    Ok(entry) => entry,
                    Err(error) => {
                        counters.push_issue(&directory, &format!("cannot read entry: {error}"));
                        continue;
                    }
                };
                let path = entry.path();
                let name = entry.file_name();
                let name_lossy = name.to_string_lossy();

                if !options.include_hidden && is_hidden_name(&name_lossy) {
                    counters.skipped_entries += 1;
                    continue;
                }
                if !options.include_ignored && is_default_ignored_name(&name_lossy) {
                    counters.skipped_entries += 1;
                    continue;
                }
                if is_catalog_artifact(&path, &catalog_artifacts) {
                    counters.skipped_entries += 1;
                    continue;
                }

                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(error) => {
                        counters.push_issue(&path, &format!("cannot read file type: {error}"));
                        continue;
                    }
                };

                if file_type.is_symlink() {
                    counters.skipped_entries += 1;
                    continue;
                }
                if file_type.is_dir() {
                    directories.push_back(path);
                    continue;
                }
                if !file_type.is_file() {
                    counters.skipped_entries += 1;
                    continue;
                }

                let metadata = match entry.metadata() {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        counters.push_issue(&path, &format!("cannot read metadata: {error}"));
                        continue;
                    }
                };
                let snapshot = match snapshot_file(&root_path, &path, &metadata) {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        counters.push_issue(&path, &format!("cannot index file: {error:#}"));
                        continue;
                    }
                };

                counters.files_seen += 1;
                batch.push(snapshot);
                if batch.len() >= BATCH_SIZE {
                    self.apply_scan_batch(&root, started_at_ms, &batch, &mut counters)?;
                    batch.clear();
                }
            }
        }

        if !batch.is_empty() {
            self.apply_scan_batch(&root, started_at_ms, &batch, &mut counters)?;
        }

        let complete = counters.issue_count == 0;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE roots
             SET is_online = 1, last_seen_at_ms = ?1
             WHERE id = ?2",
            params![started_at_ms, root.id],
        )?;
        if complete {
            counters.locations_marked_offline = u64::try_from(transaction.execute(
                "UPDATE locations
                 SET is_online = 0,
                     missing_since_ms = COALESCE(missing_since_ms, ?1)
                 WHERE root_id = ?2
                   AND last_seen_at_ms < ?1
                   AND is_online = 1",
                params![started_at_ms, root.id],
            )?)?;
        }
        transaction.commit()?;

        let completed_at_ms = now_ms()?;
        Ok(counters.into_report(&root, true, started_at_ms, completed_at_ms, complete))
    }

    fn apply_scan_batch(
        &mut self,
        root: &RootRecord,
        scan_timestamp: i64,
        batch: &[FileSnapshot],
        counters: &mut ScanCounters,
    ) -> Result<()> {
        let transaction = self.connection.transaction()?;
        for snapshot in batch {
            upsert_snapshot(&transaction, root, snapshot, scan_timestamp, counters)?;
        }
        transaction.commit()?;
        Ok(())
    }
}

impl ScanCounters {
    fn push_issue(&mut self, path: impl AsRef<Path>, message: &str) {
        self.issue_count += 1;
        if self.issues.len() < MAX_REPORTED_ISSUES {
            self.issues.push(ScanIssue {
                path: path.as_ref().to_string_lossy().into_owned(),
                message: message.to_owned(),
            });
        }
    }

    fn into_report(
        self,
        root: &RootRecord,
        root_online: bool,
        started_at_ms: i64,
        completed_at_ms: i64,
        complete: bool,
    ) -> ScanReport {
        ScanReport {
            root_id: root.id.clone(),
            root_path: root.path.clone(),
            root_online,
            started_at_ms,
            completed_at_ms,
            complete,
            directories_seen: self.directories_seen,
            files_seen: self.files_seen,
            assets_created: self.assets_created,
            assets_updated: self.assets_updated,
            locations_created: self.locations_created,
            locations_moved: self.locations_moved,
            locations_marked_offline: self.locations_marked_offline,
            skipped_entries: self.skipped_entries,
            issue_count: self.issue_count,
            issues: self.issues,
        }
    }
}

fn upsert_snapshot(
    transaction: &Transaction<'_>,
    root: &RootRecord,
    snapshot: &FileSnapshot,
    scan_timestamp: i64,
    counters: &mut ScanCounters,
) -> Result<()> {
    if let Some(location) = find_location_by_path(transaction, &snapshot.path)? {
        update_asset_and_location(transaction, &location, root, snapshot, scan_timestamp)?;
        counters.assets_updated += 1;
        return Ok(());
    }

    if let Some(location) = find_missing_location_by_filesystem_identity(
        transaction,
        &root.id,
        snapshot.device_id.as_deref(),
        snapshot.inode.as_deref(),
    )? {
        update_asset_and_location(transaction, &location, root, snapshot, scan_timestamp)?;
        counters.assets_updated += 1;
        counters.locations_moved += 1;
        return Ok(());
    }

    let asset_id = Uuid::new_v4().to_string();
    transaction.execute(
        "INSERT INTO assets (
            id, media_kind, canonical_name, extension, size_bytes,
            created_at_ns, modified_at_ns, first_seen_at_ms, last_seen_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            asset_id,
            snapshot.media_kind,
            snapshot.name,
            snapshot.extension,
            snapshot.size_bytes,
            snapshot.created_at_ns,
            snapshot.modified_at_ns,
            scan_timestamp,
        ],
    )?;
    transaction.execute(
        "INSERT INTO locations (
            asset_id, root_id, path, relative_path, device_id, inode,
            is_primary, is_online, first_seen_at_ms, last_seen_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?7)",
        params![
            asset_id,
            root.id,
            snapshot.path,
            snapshot.relative_path,
            snapshot.device_id,
            snapshot.inode,
            scan_timestamp,
        ],
    )?;
    counters.assets_created += 1;
    counters.locations_created += 1;
    Ok(())
}

fn update_asset_and_location(
    transaction: &Transaction<'_>,
    location: &LocationIdentity,
    root: &RootRecord,
    snapshot: &FileSnapshot,
    scan_timestamp: i64,
) -> Result<()> {
    transaction.execute(
        "UPDATE assets
         SET media_kind = ?1,
             canonical_name = ?2,
             extension = ?3,
             size_bytes = ?4,
             created_at_ns = ?5,
             modified_at_ns = ?6,
             last_seen_at_ms = ?7,
             deleted_at_ms = NULL
         WHERE id = ?8",
        params![
            snapshot.media_kind,
            snapshot.name,
            snapshot.extension,
            snapshot.size_bytes,
            snapshot.created_at_ns,
            snapshot.modified_at_ns,
            scan_timestamp,
            location.asset_id,
        ],
    )?;
    transaction.execute(
        "UPDATE locations
         SET root_id = ?1,
             path = ?2,
             relative_path = ?3,
             device_id = ?4,
             inode = ?5,
             is_online = 1,
             last_seen_at_ms = ?6,
             missing_since_ms = NULL
         WHERE id = ?7",
        params![
            root.id,
            snapshot.path,
            snapshot.relative_path,
            snapshot.device_id,
            snapshot.inode,
            scan_timestamp,
            location.id,
        ],
    )?;
    Ok(())
}

fn find_location_by_path(
    transaction: &Transaction<'_>,
    path: &str,
) -> Result<Option<LocationIdentity>> {
    transaction
        .query_row(
            "SELECT id, asset_id, path FROM locations WHERE path = ?1",
            [path],
            location_identity_from_row,
        )
        .optional()
        .context("failed to find location by path")
}

fn find_missing_location_by_filesystem_identity(
    transaction: &Transaction<'_>,
    root_id: &str,
    device_id: Option<&str>,
    inode: Option<&str>,
) -> Result<Option<LocationIdentity>> {
    let (Some(device_id), Some(inode)) = (device_id, inode) else {
        return Ok(None);
    };
    let mut statement = transaction.prepare(
        "SELECT id, asset_id, path
         FROM locations
         WHERE root_id = ?1 AND device_id = ?2 AND inode = ?3
         ORDER BY is_online ASC, last_seen_at_ms ASC",
    )?;
    let candidates = statement.query_map(
        params![root_id, device_id, inode],
        location_identity_from_row,
    )?;
    for candidate in candidates {
        let candidate = candidate?;
        if !Path::new(&candidate.path).exists() {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

fn resolve_root(connection: &rusqlite::Connection, reference: &str) -> Result<RootRecord> {
    let direct = connection
        .query_row(
            "SELECT id, path, display_name, filesystem_kind, volume_id,
                    is_enabled, is_online, added_at_ms, last_seen_at_ms
             FROM roots WHERE id = ?1 OR path = ?1
             ORDER BY CASE WHEN id = ?1 THEN 0 ELSE 1 END
             LIMIT 1",
            [reference],
            root_from_row,
        )
        .optional()?;
    if let Some(root) = direct {
        return Ok(root);
    }

    let canonical = fs::canonicalize(reference).ok();
    if let Some(canonical) = canonical {
        let path = canonical.to_string_lossy();
        if let Some(root) = connection
            .query_row(
                "SELECT id, path, display_name, filesystem_kind, volume_id,
                        is_enabled, is_online, added_at_ms, last_seen_at_ms
                 FROM roots WHERE path = ?1",
                [path.as_ref()],
                root_from_row,
            )
            .optional()?
        {
            return Ok(root);
        }
    }

    bail!("unknown library root: {reference}")
}

fn next_scan_timestamp(connection: &rusqlite::Connection, root_id: &str) -> Result<i64> {
    let previous: Option<i64> = connection.query_row(
        "SELECT MAX(last_seen_at_ms) FROM locations WHERE root_id = ?1",
        [root_id],
        |row| row.get(0),
    )?;
    let now = now_ms()?;
    Ok(previous.map_or(now, |value| now.max(value.saturating_add(1))))
}

fn snapshot_file(root: &Path, path: &Path, metadata: &fs::Metadata) -> Result<FileSnapshot> {
    let relative_path = path
        .strip_prefix(root)
        .with_context(|| format!("{} is outside {}", path.display(), root.display()))?;
    let name = path
        .file_name()
        .context("file has no name")?
        .to_string_lossy()
        .into_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let size_bytes = i64::try_from(metadata.len()).context("file size exceeds SQLite range")?;
    let (device_id, inode) = filesystem_identity(metadata);

    Ok(FileSnapshot {
        path: path.to_string_lossy().into_owned(),
        relative_path: relative_path.to_string_lossy().into_owned(),
        name,
        media_kind: classify_media_kind(extension.as_deref()),
        extension,
        size_bytes,
        created_at_ns: metadata.created().ok().and_then(system_time_to_ns),
        modified_at_ns: metadata.modified().ok().and_then(system_time_to_ns),
        device_id,
        inode,
    })
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

fn location_identity_from_row(row: &Row<'_>) -> rusqlite::Result<LocationIdentity> {
    Ok(LocationIdentity {
        id: row.get(0)?,
        asset_id: row.get(1)?,
        path: row.get(2)?,
    })
}

fn system_time_to_ns(value: SystemTime) -> Option<i64> {
    let duration = value.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_nanos()).ok()
}

#[cfg(unix)]
fn filesystem_identity(metadata: &fs::Metadata) -> (Option<String>, Option<String>) {
    use std::os::unix::fs::MetadataExt;
    (
        Some(metadata.dev().to_string()),
        Some(metadata.ino().to_string()),
    )
}

#[cfg(not(unix))]
fn filesystem_identity(_metadata: &fs::Metadata) -> (Option<String>, Option<String>) {
    (None, None)
}

fn catalog_artifact_paths(database_path: &Path) -> Vec<PathBuf> {
    let absolute = fs::canonicalize(database_path).unwrap_or_else(|_| database_path.to_path_buf());
    let mut artifacts = vec![absolute.clone()];
    if let Some(name) = absolute.file_name().and_then(|value| value.to_str()) {
        artifacts.push(absolute.with_file_name(format!("{name}-wal")));
        artifacts.push(absolute.with_file_name(format!("{name}-shm")));
    }
    artifacts
}

fn is_catalog_artifact(path: &Path, artifacts: &[PathBuf]) -> bool {
    artifacts.iter().any(|artifact| artifact == path)
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

fn is_default_ignored_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git"
            | ".hg"
            | ".svn"
            | ".cache"
            | ".trash"
            | ".trash-1000"
            | "__pycache__"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".venv"
            | "venv"
    )
}

fn classify_media_kind(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or_default() {
        "wav" | "wave" | "aif" | "aiff" | "flac" | "mp3" | "ogg" | "opus" | "m4a" | "aac" => {
            "audio"
        }
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "tif" | "tiff" | "bmp" | "svg" | "avif"
        | "heic" | "heif" | "dng" | "cr2" | "nef" | "arw" => "image",
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "mxf" => "video",
        "psd" | "psb" | "ai" | "eps" | "afdesign" | "afphoto" | "afpub" | "kra" | "clip" | "xd"
        | "sketch" => "design",
        "als" | "flp" | "logicx" | "blend" | "blend1" | "aep" | "prproj" | "drp" => "project",
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "epub" => "document",
        "ttf" | "otf" | "woff" | "woff2" => "font",
        "zip" | "7z" | "rar" | "tar" | "gz" | "bz2" | "xz" => "archive",
        "rs" | "js" | "jsx" | "ts" | "tsx" | "vue" | "py" | "go" | "c" | "h" | "cpp" | "hpp"
        | "java" | "kt" | "swift" | "html" | "css" | "scss" | "json" | "yaml" | "yml" | "toml"
        | "xml" | "sql" | "sh" => "code",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_media_kind, is_default_ignored_name, is_hidden_name};

    #[test]
    fn classifies_representative_creative_files() {
        assert_eq!(classify_media_kind(Some("wav")), "audio");
        assert_eq!(classify_media_kind(Some("psd")), "design");
        assert_eq!(classify_media_kind(Some("als")), "project");
        assert_eq!(classify_media_kind(Some("ttf")), "font");
        assert_eq!(classify_media_kind(Some("nope")), "unknown");
    }

    #[test]
    fn recognizes_hidden_and_ignored_entries() {
        assert!(is_hidden_name(".secret"));
        assert!(is_default_ignored_name("node_modules"));
        assert!(is_default_ignored_name("TARGET"));
        assert!(!is_default_ignored_name("Samples"));
    }
}
