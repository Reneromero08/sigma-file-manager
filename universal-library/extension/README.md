# Universal Library Sigma extension

This extension is the Sigma interface for the independent Universal Library catalog.

## Current capabilities

- adds a live Universal Library workspace to Sigma's sidebar;
- requests persistent read-only access to selected folders;
- keeps the existing non-destructive path queue and native clipboard actions;
- connects to a user-selected `ulib` executable;
- optionally overrides the default SQLite catalog path;
- reports catalog health inside Sigma;
- registers and recursively indexes every approved folder with progress and cancellation;
- displays real catalog assets, root counts, collections, and tags in an embedded workspace;
- searches names and paths and filters by media type or offline state;
- navigates ordered mixed-media collections;
- persists compact or comfortable card density;
- inspects selected assets and copies them to the native file clipboard for Photoshop, Ableton, Affinity, or another application;
- applies catalog tags from the live workspace or navigator context menu;
- creates collections and adds selected assets without moving source files;
- retains the native list-detail command as an alternate compact asset browser.

The live workspace remains inside Sigma's sandbox. It calls the existing `Universal Library: Browse indexed assets` command with a narrow structured workspace request rather than gaining direct process access.

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
5. Open **Universal Library** in Sigma's sidebar.

The catalog uses its XDG/default database location unless `Universal Library: Choose catalog database` sets an override.

## Live workspace

The workspace toolbar provides:

- **Refresh**: reload catalog assets, tags, collections, and health;
- **Index folders**: run the cancellable root indexer and refresh;
- **Catalog**: select or replace the `ulib` executable;
- **Compact / Comfortable**: switch persistent asset-card density.

The workspace itself provides:

- global search;
- media filters;
- offline visibility control;
- collection navigation;
- asset inspection;
- native file clipboard export;
- reusable tags;
- collection creation and membership.

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
node --check universal-library/extension/src/workspace-provider.js
node --check universal-library/extension/ui/workspace.js
node --test universal-library/extension/tests/*.node.mjs
```

The extension uses plain ESM JavaScript so the bridge and workspace remain inspectable without adding another frontend build system to Sigma's root package.

## Storage boundary

Extension settings store only catalog connection preferences:

- `catalog.executablePath`
- `catalog.databasePath`, when explicitly overridden

Extension storage contains:

- `library-roots`
- `seed-entries`
- `catalog-schema-version`
- `workspace.compact`

Durable asset identities, locations, tags, collections, metadata, and audit records live in the independent SQLite catalog.

## Safety

The extension still does not request `fs.write` permission. The `shell` permission is used only by the trusted host extension runtime to run the executable path explicitly selected by the user with structured `ulib` arguments.

The embedded workspace does not receive direct shell access. It can invoke only same-extension commands permitted by Sigma's embed bridge.

Indexing reads paths and filesystem metadata. Catalog organization mutates SQLite records only. Source files are not moved, renamed, copied, edited, or deleted.
