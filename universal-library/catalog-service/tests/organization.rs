use std::fs;

use rusqlite::Connection;
use tempfile::tempdir;
use universal_library_catalog::{AssetQuery, Catalog, ScanOptions};

#[test]
fn searches_assets_by_kind_name_path_and_online_state() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir_all(root.join("Artwork")).expect("create root");
    let sample = root.join("dusty_kick.wav");
    let artwork = root.join("Artwork").join("cover.psd");
    fs::write(&sample, b"sample").expect("write sample");
    fs::write(&artwork, b"artwork").expect("write artwork");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan root");

    let audio = catalog
        .query_assets(AssetQuery {
            media_kind: Some("audio".into()),
            ..AssetQuery::default()
        })
        .expect("query audio");
    assert_eq!(audio.len(), 1);
    assert_eq!(audio[0].canonical_name, "dusty_kick.wav");
    assert!(audio[0].is_online);

    let cover = catalog
        .query_assets(AssetQuery {
            text: Some("Artwork/cover".into()),
            ..AssetQuery::default()
        })
        .expect("query path");
    assert_eq!(cover.len(), 1);
    assert_eq!(cover[0].media_kind, "design");

    fs::remove_file(&sample).expect("remove sample");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("reconcile root");

    let online = catalog
        .query_assets(AssetQuery::default())
        .expect("query online assets");
    assert_eq!(online.len(), 1);
    let all = catalog
        .query_assets(AssetQuery {
            include_offline: true,
            ..AssetQuery::default()
        })
        .expect("query all assets");
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|asset| !asset.is_online));
}

#[test]
fn tags_are_idempotent_and_assignable_by_asset_path() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    let sample = root.join("texture.wav");
    fs::write(&sample, b"sample").expect("write sample");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan root");

    let first = catalog
        .create_tag("Dark", Some("#101010"))
        .expect("create tag");
    let second = catalog
        .create_tag("dark", Some("#202020"))
        .expect("update tag");
    assert_eq!(first.id, second.id);
    assert_eq!(second.color.as_deref(), Some("#202020"));
    assert_eq!(catalog.list_tags().expect("list tags").len(), 1);

    let assignment = catalog
        .assign_tag(sample.to_string_lossy().as_ref(), "DARK")
        .expect("assign tag");
    catalog
        .assign_tag(sample.to_string_lossy().as_ref(), &first.id)
        .expect("repeat assignment");
    let tags = catalog
        .list_asset_tags(sample.to_string_lossy().as_ref())
        .expect("list asset tags");
    assert_eq!(tags.len(), 1);
    assert_eq!(assignment.tag_id, first.id);

    let removal = catalog
        .remove_tag_from_asset(sample.to_string_lossy().as_ref(), "dark")
        .expect("remove tag");
    assert!(removal.removed);
    assert!(
        catalog
            .list_asset_tags(sample.to_string_lossy().as_ref())
            .expect("list empty tags")
            .is_empty()
    );
}

#[test]
fn collections_behave_like_ordered_mixed_media_playlists() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    let sample = root.join("kick.wav");
    let artwork = root.join("cover.psd");
    fs::write(&sample, b"sample").expect("write sample");
    fs::write(&artwork, b"artwork").expect("write artwork");
    let sample_before = fs::read(&sample).expect("read sample before organization");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan root");
    let collection = catalog
        .create_collection("Album 03", "manual")
        .expect("create collection");

    catalog
        .add_collection_item(
            &collection.id,
            artwork.to_string_lossy().as_ref(),
            Some(20.0),
            Some("Visual"),
            Some("Primary cover direction"),
        )
        .expect("add artwork");
    catalog
        .add_collection_item(
            "Album 03",
            sample.to_string_lossy().as_ref(),
            Some(10.0),
            Some("Audio"),
            None,
        )
        .expect("add sample");

    let ordered = catalog
        .list_collection_items(&collection.id)
        .expect("list collection");
    assert_eq!(ordered.len(), 2);
    assert_eq!(ordered[0].canonical_name, "kick.wav");
    assert_eq!(ordered[1].canonical_name, "cover.psd");

    catalog
        .add_collection_item(
            &collection.id,
            artwork.to_string_lossy().as_ref(),
            Some(5.0),
            Some("Visual"),
            None,
        )
        .expect("reposition artwork");
    let reordered = catalog
        .list_collection_items("Album 03")
        .expect("list reordered collection");
    assert_eq!(reordered[0].canonical_name, "cover.psd");
    assert_eq!(reordered[1].canonical_name, "kick.wav");

    let removal = catalog
        .remove_collection_item("Album 03", sample.to_string_lossy().as_ref())
        .expect("remove sample from collection");
    assert!(removal.removed);
    assert_eq!(
        catalog
            .list_collection_items(&collection.id)
            .expect("list final collection")
            .len(),
        1
    );
    assert_eq!(
        fs::read(&sample).expect("read sample after organization"),
        sample_before
    );
}

#[test]
fn custom_metadata_is_validated_normalized_and_audited() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    let sample = root.join("loop.wav");
    fs::write(&sample, b"sample").expect("write sample");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan root");

    let first = catalog
        .set_asset_metadata(
            sample.to_string_lossy().as_ref(),
            "audio",
            "analysis",
            r#"{ "bpm": 104, "key": "C minor" }"#,
            "test-agent",
        )
        .expect("set metadata");
    assert_eq!(first.value_json, r#"{"bpm":104,"key":"C minor"}"#);
    assert_eq!(first.source, "test-agent");

    catalog
        .set_asset_metadata(
            sample.to_string_lossy().as_ref(),
            "audio",
            "analysis",
            r#"{"bpm":105}"#,
            "test-agent",
        )
        .expect("update metadata");
    let metadata = catalog
        .list_asset_metadata(sample.to_string_lossy().as_ref())
        .expect("list metadata");
    assert_eq!(metadata.len(), 1);
    assert_eq!(metadata[0].value_json, r#"{"bpm":105}"#);
    assert!(
        catalog
            .set_asset_metadata(
                sample.to_string_lossy().as_ref(),
                "audio",
                "broken",
                "not-json",
                "test-agent",
            )
            .is_err()
    );

    let connection = Connection::open(&database).expect("open database for assertions");
    let audit_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
        .expect("count audit records");
    assert!(audit_count >= 2);
}
