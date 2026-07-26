# Universal Library catalog service

`ulib` is the independent local catalog CLI for Universal Library.

It owns durable metadata and remains usable even if the Sigma interface is later replaced.

## Current commands

```bash
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- init
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- health
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- root add ~/Samples --name "Sample Library"
cargo run --manifest-path universal-library/catalog-service/Cargo.toml -- root list
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

## Safety boundary

The service currently creates or updates only its own SQLite catalog and explicit backup destinations.

`root add` requires an existing directory and records its canonical path. It does not scan, move, rename, tag, hash, preview, or otherwise modify files inside that directory.

Backups refuse to overwrite an existing destination.

## Development

```bash
cargo fmt --manifest-path universal-library/catalog-service/Cargo.toml -- --check
cargo clippy --manifest-path universal-library/catalog-service/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path universal-library/catalog-service/Cargo.toml
```
