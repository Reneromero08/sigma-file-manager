from pathlib import Path

root = Path(__file__).resolve().parent

lib = root / "src" / "lib.rs"
text = lib.read_text()
old = """mod indexer;

pub use indexer::{ScanIssue, ScanOptions, ScanReport};
"""
new = """mod indexer;
mod organize;

pub use indexer::{ScanIssue, ScanOptions, ScanReport};
pub use organize::{
    AssetMetadataRecord, AssetQuery, AssetRecord, AssetTagRecord, CollectionItemRecord,
    RemovalRecord, TagRecord,
};
"""
if old not in text:
    raise SystemExit("lib module marker was not found")
lib.write_text(text.replace(old, new, 1))

organize = root / "src" / "organize.rs"
text = organize.read_text()
text = text.replace(
    "use std::{path::Path, time::SystemTime};",
    "use std::path::Path;",
    1,
)
text = text.replace(
    '#[derive(Debug, Clone, Serialize, PartialEq, Eq)]\n#[serde(rename_all = "camelCase")]\npub struct AssetMetadataRecord',
    '#[derive(Debug, Clone, Serialize, PartialEq)]\n#[serde(rename_all = "camelCase")]\npub struct AssetMetadataRecord',
    1,
)
text = text.replace(
    "pub confidence: Option<String>,",
    "pub confidence: Option<f64>,",
    1,
)
text = text.replace(
    "CAST(confidence AS TEXT), updated_at_ms",
    "confidence, updated_at_ms",
)
dummy = """
    #[test]
    fn system_time_import_remains_used_for_future_metadata_expansion() {
        let _ = SystemTime::UNIX_EPOCH;
    }
"""
if dummy not in text:
    raise SystemExit("temporary SystemTime test was not found")
organize.write_text(text.replace(dummy, "", 1))
