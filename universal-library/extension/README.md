# Universal Library Sigma extension

This extension is the Sigma interface for the independent Universal Library catalog.

## Current capabilities

- adds a Universal Library workspace to Sigma's sidebar;
- requests persistent read-only access to selected folders;
- keeps the existing non-destructive path queue and native clipboard actions;
- connects to a user-selected `ulib` executable;
- optionally overrides the default SQLite catalog path;
- reports catalog health inside Sigma;
- registers and recursively indexes every approved folder with progress and cancellation;
- opens indexed assets in Sigma's native searchable list-detail interface;
- copies an indexed asset to the native file clipboard for Photoshop, Ableton, Affinity, or another application;
- applies catalog tags to selected indexed files;
- adds selected indexed files to ordered mixed-media collections.

The sidebar workspace page remains a visual product preview while the real catalog interface is currently exposed through Sigma's command palette and native modals.

## Setup

Build the catalog executable:

```bash
cargo build --release --manifest-path universal-library/catalog-service/Cargo.toml
```

Then run:

1. `Universal Library: Configure catalog executable`
2. Select `universal-library/catalog-service/target/release/ulib` on Linux or `ulib.exe` on Windows.
3. Add one or more folders with `Universal Library: Add folder`.
4. Run `Universal Library: Index all folders`.
5. Open `Universal Library: Browse indexed assets`.

The catalog uses its XDG/default database location unless `Universal Library: Choose catalog database` sets an override.

## Commands

### Bootstrap and clipboard

- `Universal Library: Add folder`
- `Universal Library: Show folders`
- `Universal Library: Add selected items`
- `Universal Library: Copy selected items`

### Catalog connection

- `Universal Library: Configure catalog executable`
- `Universal Library: Choose catalog database`
- `Universal Library: Use default catalog database`
- `Universal Library: Show catalog status`

### Catalog operations

- `Universal Library: Index all folders`
- `Universal Library: Browse indexed assets`
- `Universal Library: Tag selected files`
- `Universal Library: Add selected files to collection`

## Development checks

```bash
node --check universal-library/extension/src/index.js
node --check universal-library/extension/src/catalog-client.js
node --check universal-library/extension/src/catalog-bridge.js
node --test universal-library/extension/tests/*.node.mjs
```

The extension uses plain ESM JavaScript so the bridge remains inspectable without adding another build system to Sigma's root package.

## Storage boundary

Extension settings store only catalog connection preferences:

- `catalog.executablePath`
- `catalog.databasePath`, when explicitly overridden

Bootstrap state remains under:

- `library-roots`
- `seed-entries`
- `catalog-schema-version`

Durable asset identities, locations, tags, collections, metadata, and audit records live in the independent SQLite catalog.

## Safety

The extension still does not request `fs.write` permission. The `shell` permission is used only to run the executable path explicitly selected by the user with structured `ulib` arguments.

Indexing reads paths and filesystem metadata. Catalog organization mutates SQLite records only. Source files are not moved, renamed, copied, edited, or deleted.
