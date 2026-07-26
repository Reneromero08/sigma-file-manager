# Universal Library Sigma extension

This extension is the Sigma interface for the independent Universal Library catalog.

## Current capabilities

- adds a live Universal Library workspace to Sigma's sidebar;
- requests persistent read-only access to selected folders;
- installs and resolves the matching `ulib` catalog binary through Sigma's managed-binary system;
- allows a custom executable override for development or recovery;
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

The custom Sigma build bundles this extension and offers to install it through Sigma's normal extension flow on first launch. Accepting the managed dependency prompt downloads the checksum-verified `ulib` release for the current platform. Cancelling leaves Sigma usable and does not claim bundled ownership.

Bundled extension updates follow the same validation, rollback, activation, and managed-dependency paths as a local extension refresh. A manually installed same-ID development copy is not overwritten, a disabled bundled extension remains disabled, and an intentionally uninstalled bundled extension stays uninstalled.

For supported Linux x64 and Windows x64 installations, Sigma downloads, checksum-verifies, extracts, and reuses the managed `ulib` binary declared by the extension.

Then:

1. Add one or more folders with `Universal Library: Add folder`.
2. Run `Universal Library: Index all folders`.
3. Open **Universal Library** in Sigma's sidebar.

The catalog uses its XDG/default database location unless `Universal Library: Choose catalog database` sets an override.

### Custom executable fallback

`Universal Library: Choose custom catalog executable` can override the managed binary for local development or recovery.

`Universal Library: Use managed catalog executable` removes that override and returns to Sigma's verified managed binary.

A local development binary can be built with:

```bash
cargo build --release --manifest-path universal-library/catalog-service/Cargo.toml
```

## Live workspace

The workspace toolbar provides:

- **Refresh**: reload catalog assets, tags, collections, and health;
- **Index folders**: run the cancellable root indexer and refresh;
- **Catalog**: show current catalog status and executable source;
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

- `Universal Library: Show catalog status`
- `Universal Library: Use managed catalog executable`
- `Universal Library: Choose custom catalog executable`
- `Universal Library: Choose catalog database`
- `Universal Library: Use default catalog database`

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

Extension settings store only optional catalog overrides:

- `catalog.executablePath`, only when a custom executable is selected;
- `catalog.databasePath`, only when the database path is overridden.

Extension storage contains:

- `library-roots`
- `seed-entries`
- `catalog-schema-version`
- `workspace.compact`

Durable asset identities, locations, tags, collections, metadata, and audit records live in the independent SQLite catalog.

## Safety

The extension does not request `fs.write` permission. Sigma verifies the managed archive SHA-256 before extraction. The `shell` permission is used only by the trusted host extension runtime to run the managed or explicitly selected `ulib` executable with structured arguments.

The embedded workspace does not receive direct shell access. It can invoke only same-extension commands permitted by Sigma's embed bridge.

Indexing reads paths and filesystem metadata. Catalog organization mutates SQLite records only. Source files are not moved, renamed, copied, edited, or deleted.
