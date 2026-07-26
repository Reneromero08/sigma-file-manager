use std::fs;

use tempfile::tempdir;
use universal_library_catalog::Catalog;

#[test]
fn opens_and_migrates_a_new_catalog() {
    let directory = tempdir().expect("temp directory");
    let database = directory.path().join("catalog.sqlite3");

    let catalog = Catalog::open(&database).expect("open catalog");
    let health = catalog.health().expect("catalog health");

    assert_eq!(health.status, "ok");
    assert_eq!(health.schema_version, 1);
    assert_eq!(health.root_count, 0);
    assert_eq!(health.collection_count, 0);
    assert_eq!(catalog.path(), database);
}

#[test]
fn adding_the_same_root_is_idempotent() {
    let directory = tempdir().expect("temp directory");
    let database = directory.path().join("catalog.sqlite3");
    let samples = directory.path().join("Samples");
    fs::create_dir(&samples).expect("create sample root");
    let catalog = Catalog::open(database).expect("open catalog");

    let first = catalog
        .add_root(&samples, Some("Sample Library"))
        .expect("add root");
    let second = catalog
        .add_root(&samples, Some("Samples"))
        .expect("update root");
    let roots = catalog.list_roots().expect("list roots");

    assert_eq!(first.id, second.id);
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].display_name, "Samples");
    assert!(roots[0].is_online);
    assert!(roots[0].is_enabled);
}

#[test]
fn roots_must_exist_and_be_directories() {
    let directory = tempdir().expect("temp directory");
    let catalog = Catalog::open(directory.path().join("catalog.sqlite3"))
        .expect("open catalog");

    let missing = catalog.add_root(directory.path().join("missing"), None);
    assert!(missing.is_err());

    let file = directory.path().join("not-a-directory.txt");
    fs::write(&file, b"not a root").expect("write fixture");
    let not_directory = catalog.add_root(file, None);
    assert!(not_directory.is_err());
}

#[test]
fn creates_virtual_collections_without_filesystem_changes() {
    let directory = tempdir().expect("temp directory");
    let catalog = Catalog::open(directory.path().join("catalog.sqlite3"))
        .expect("open catalog");

    let album = catalog
        .create_collection("Album 03", "manual")
        .expect("create collection");
    let smart = catalog
        .create_collection("Dark percussion", "smart")
        .expect("create smart collection");
    let collections = catalog.list_collections().expect("list collections");

    assert_eq!(album.collection_kind, "manual");
    assert_eq!(smart.collection_kind, "smart");
    assert_eq!(collections.len(), 2);
    assert!(catalog.create_collection("Bad", "folder").is_err());
}

#[test]
fn creates_a_consistent_backup() {
    let directory = tempdir().expect("temp directory");
    let database = directory.path().join("catalog.sqlite3");
    let backup = directory.path().join("backups").join("catalog.sqlite3");
    let samples = directory.path().join("Samples");
    fs::create_dir(&samples).expect("create sample root");

    let catalog = Catalog::open(&database).expect("open catalog");
    catalog.add_root(samples, None).expect("add root");
    catalog
        .create_collection("Favorites", "manual")
        .expect("create collection");
    catalog.backup(&backup).expect("backup catalog");

    let restored = Catalog::open(&backup).expect("open backup");
    let health = restored.health().expect("backup health");
    assert_eq!(health.schema_version, 1);
    assert_eq!(health.root_count, 1);
    assert_eq!(health.collection_count, 1);
    assert!(catalog.backup(&backup).is_err(), "existing backups are not overwritten");
}
