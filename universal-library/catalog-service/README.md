# Universal Library catalog service

`ulib` is the independent local catalog CLI for Universal Library.

It owns durable metadata and remains usable even if the Sigma interface is later replaced.

## Current commands

```bash
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- init
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- health
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- root add ~/Samples --name "Sample Library"
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- root list
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- root scan <root-id-or-path>
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- collection create "Album 03"
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- collection list
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- backup --output ~/Backups/universal-library.sqlite3
```

Every successful command emits a JSON envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Errors are emitted to standard error as:

```json
{
  "ok": false,
  "error": {
    "message": "..."
  }
}
```

## Database location

Resolution order:

1. `--database <path>`
2. `ULIB_DATABASE`
3. `$XDG_DATA_HOME/universal-library/catalog.sqlite3`
4. `$HOME/.local/share/universal-library/catalog.sqlite3`

## Root scanning

`root scan` recursively reads directory entries and filesystem metadata, then upserts durable asset and location records in batches of 500.

It does not read file contents in this phase. Media classification is based on file extensions.

Default behavior:

- skips symlinks rather than following them;
- skips dot-prefixed entries;
- skips VCS, dependency, cache, virtual-environment, and common build directories;
- skips the active catalog database and its SQLite WAL/SHM files;
- preserves missing assets and marks only their locations offline;
- preserves existing online/offline state when any directory or metadata read fails, preventing an incomplete scan from falsely declaring files missing;
- uses Linux device and inode identity to preserve an asset across renames when the old path no longer exists.

Optional switches:

```bash
ulib root scan <root> --include-hidden
ulib root scan <root> --include-ignored
```

The scan report includes counts for discovered files, created and updated assets, created and moved locations, offline locations, skipped entries, and bounded error details.

## Safety boundary

The service creates or updates only its own SQLite catalog and explicit backup destinations.

`root add` requires an existing directory and records its canonical path. `root scan` reads paths and metadata but does not move, rename, tag, hash, preview, or otherwise modify source files.

Backups refuse to overwrite an existing destination.

## Development

```bash
cargo fmt --manifest-path universal-library/catalog-service/Cargo.toml -- --check
cargo clippy --manifest-path universal-library/catalog-service/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path universal-library/catalog-service/Cargo.toml
```
