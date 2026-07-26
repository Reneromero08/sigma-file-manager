use std::fs;

use rusqlite::Connection;
use tempfile::tempdir;
use universal_library_catalog::{Catalog, ScanOptions};

#[test]
fn indexes_mixed_creative_files_without_mutating_sources() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let state = directory.path().join("State");
    let database = state.join("catalog.sqlite3");
    fs::create_dir_all(root.join("Projects")).expect("create projects");
    fs::create_dir_all(root.join("node_modules")).expect("create ignored directory");

    let sample = root.join("kick.wav");
    let image = root.join("cover.psd");
    let project = root.join("Projects").join("album.als");
    fs::write(&sample, b"sample bytes").expect("write sample");
    fs::write(&image, b"design bytes").expect("write design");
    fs::write(&project, b"project bytes").expect("write project");
    fs::write(root.join(".private.txt"), b"hidden").expect("write hidden file");
    fs::write(root.join("node_modules").join("package.js"), b"ignored")
        .expect("write ignored file");
    let original_sample = fs::read(&sample).expect("read original sample");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    let report = catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan root");

    assert!(report.complete);
    assert!(report.root_online);
    assert_eq!(report.issue_count, 0);
    assert_eq!(report.files_seen, 3);
    assert_eq!(report.assets_created, 3);
    assert_eq!(report.locations_created, 3);
    assert!(report.skipped_entries >= 2);
    assert_eq!(fs::read(&sample).expect("re-read sample"), original_sample);

    let connection = Connection::open(&database).expect("open database for assertions");
    let asset_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
        .expect("count assets");
    let kinds: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT media_kind FROM assets ORDER BY media_kind")
            .expect("prepare kinds");
        statement
            .query_map([], |row| row.get(0))
            .expect("query kinds")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect kinds")
    };
    assert_eq!(asset_count, 3);
    assert_eq!(kinds, vec!["audio", "design", "project"]);
}

#[test]
fn explicit_options_include_hidden_and_default_ignored_entries() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir_all(root.join("build")).expect("create build directory");
    fs::write(root.join(".reference.png"), b"hidden").expect("write hidden file");
    fs::write(root.join("build").join("render.mov"), b"build output")
        .expect("write build file");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    let report = catalog
        .scan_root(
            &registered.id,
            ScanOptions {
                include_hidden: true,
                include_ignored: true,
            },
        )
        .expect("scan root");

    assert!(report.complete);
    assert_eq!(report.files_seen, 2);
    assert_eq!(report.assets_created, 2);

    let connection = Connection::open(&database).expect("open database for assertions");
    let online: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM locations WHERE is_online = 1",
            [],
            |row| row.get(0),
        )
        .expect("count online locations");
    assert_eq!(online, 2);
}

#[test]
fn missing_files_are_marked_offline_without_deleting_assets() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    let keep = root.join("keep.wav");
    let remove = root.join("remove.wav");
    fs::write(&keep, b"keep").expect("write keep file");
    fs::write(&remove, b"remove").expect("write remove file");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("initial scan");
    fs::remove_file(&remove).expect("remove indexed file");

    let report = catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("reconcile scan");
    assert!(report.complete);
    assert_eq!(report.locations_marked_offline, 1);
    assert_eq!(report.assets_created, 0);
    assert_eq!(report.assets_updated, 1);

    let connection = Connection::open(&database).expect("open database for assertions");
    let asset_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
        .expect("count assets");
    let offline_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM locations WHERE is_online = 0 AND missing_since_ms IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .expect("count offline locations");
    assert_eq!(asset_count, 2);
    assert_eq!(offline_count, 1);
}

#[cfg(unix)]
#[test]
fn rename_preserves_asset_identity_on_unix() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    let original = root.join("original.wav");
    let renamed = root.join("renamed.wav");
    fs::write(&original, b"sample").expect("write sample");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("initial scan");
    fs::rename(&original, &renamed).expect("rename sample");

    let report = catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("rename scan");
    assert!(report.complete);
    assert_eq!(report.assets_created, 0);
    assert_eq!(report.assets_updated, 1);
    assert_eq!(report.locations_moved, 1);
    assert_eq!(report.locations_marked_offline, 0);

    let connection = Connection::open(&database).expect("open database for assertions");
    let asset_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
        .expect("count assets");
    let stored_path: String = connection
        .query_row("SELECT path FROM locations", [], |row| row.get(0))
        .expect("read location path");
    assert_eq!(asset_count, 1);
    assert_eq!(stored_path, renamed.to_string_lossy());
}

#[test]
fn disconnected_roots_preserve_catalog_records() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    fs::write(root.join("only.wav"), b"sample").expect("write sample");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("initial scan");
    fs::remove_dir_all(&root).expect("disconnect root");

    let report = catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("offline scan");
    assert!(!report.complete);
    assert!(!report.root_online);
    assert_eq!(report.issue_count, 1);
    assert_eq!(report.locations_marked_offline, 1);

    let connection = Connection::open(&database).expect("open database for assertions");
    let asset_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
        .expect("count assets");
    let root_online: i64 = connection
        .query_row(
            "SELECT is_online FROM roots WHERE id = ?1",
            [&registered.id],
            |row| row.get(0),
        )
        .expect("read root state");
    assert_eq!(asset_count, 1);
    assert_eq!(root_online, 0);
}
