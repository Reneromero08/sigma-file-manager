# Universal Library Sigma extension

This extension is the first interface layer for Universal Library.

## Current capabilities

- adds a Universal Library workspace to Sigma's sidebar;
- requests persistent read-only access to selected folders;
- records selected files and folders in extension-owned storage without moving them;
- exposes the registered roots through the command palette;
- copies selected paths through Sigma's native file clipboard;
- adds an `Add to Universal Library` context-menu action.

The workspace page is currently a visual product preview. It intentionally labels its example assets as interface direction rather than indexed data.

## Commands

- `Universal Library: Add folder`
- `Universal Library: Show folders`
- `Universal Library: Add selected items`
- `Universal Library: Copy selected items`

## Development check

```bash
node --check universal-library/extension/src/index.js
```

The extension uses plain ESM JavaScript for the bootstrap so it can be inspected and loaded without adding another build system to Sigma's root package.

## Storage boundary

Bootstrap state is stored through `sigma.storage` under these keys:

- `library-roots`
- `seed-entries`
- `catalog-schema-version`

This is temporary bootstrap state. The future daemon-backed SQLite catalog defined in `../catalog/0001_initial.sql` becomes canonical once the catalog service is implemented.

## Safety

The extension requests read permission only. It does not recursively scan, hash, thumbnail, edit, move, rename, or delete source files in this phase.
