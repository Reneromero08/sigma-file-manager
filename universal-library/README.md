# Universal Library

Universal Library is the long-term content layer for the `Reneromero08/sigma-file-manager` fork.

It is designed to turn Sigma into one machine-wide, type-aware browser for ordinary files, design assets, audio samples, music projects, video, fonts, documents, archives, and future media types.

## Non-negotiable rules

- Files stay in their existing filesystem locations.
- Indexing is read-only by default.
- The catalog never creates sidecars inside indexed folders.
- Collections contain references, never copied assets.
- Metadata belongs to the Universal Library catalog, not Sigma's path-based tag store.
- Sigma remains a replaceable interface shell. The catalog format and adapters remain independently usable.
- `main` remains an upstream-tracking branch. Product work lands through PRs into `product`.
- Core Sigma patches must expose generic extension points rather than hard-code support for a specific creative application.

## Initial slice

This directory currently establishes:

- a Sigma API extension that registers the Universal Library workspace;
- persistent, user-approved library roots;
- commands for adding roots and selected files;
- clipboard transfer for selected files;
- the durable SQLite catalog schema;
- architecture and staged implementation plans;
- CI checks for the extension entry point, manifest, and database migration.

The first slice does not move, rename, edit, hash, thumbnail, or analyze user files.

## Directory layout

```text
universal-library/
├── extension/              Sigma extension and interface
├── catalog/                Durable schema and migrations
├── ARCHITECTURE.md         Product and integration boundaries
└── ROADMAP.md              PR-sized implementation sequence
```

A separate local daemon will be added after the catalog contract is reviewed. It will own recursive watching, reconciliation, metadata extraction, preview generation, and agent-facing APIs.
