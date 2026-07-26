# Universal Library roadmap

Each phase should land as a focused PR into `product`. A phase may be split further when review or testing benefits from a smaller boundary.

## PR 1: Foundation

- establish the independent product boundary;
- add the catalog migration;
- register a Universal Library sidebar page;
- persist user-approved roots;
- add selected files to the seed catalog;
- copy selected files to the native clipboard;
- add validation CI.

Claim ceiling: architecture and extension bootstrap only. No recursive indexer or durable asset reconciliation yet.

## PR 2: Catalog service

- add a small Rust service and CLI;
- create and migrate the SQLite catalog;
- expose health, version, root, collection, and asset commands;
- bind any HTTP transport to loopback only;
- use structured JSON responses;
- include backup and restore commands.

## PR 3: Non-destructive indexer

- recursively scan approved roots;
- implement ignore rules and filesystem boundaries;
- collect location, size, timestamp, and type metadata;
- preserve offline locations;
- add incremental reconciliation;
- test renames, moves, disconnections, and restarts.

## PR 4: Collections and metadata

- mixed-media ordered collections;
- nested collections;
- tags, ratings, colors, status, and descriptions;
- saved queries and smart collections;
- batch operations;
- import existing Sigma tags without making them canonical.

## PR 5: Unified interface

- replace the bootstrap page with the production workspace;
- gallery, list, waveform, filmstrip, and contact-sheet views;
- inspector panel;
- keyboard navigation and multi-select;
- collection editing and manual ordering;
- direct clipboard transfer into native applications.

## PR 6: Standard preview adapters

- common images;
- audio waveform and audition;
- video poster frame and playback proxy;
- PDF page preview and text extraction;
- font specimen;
- archive manifest;
- code and text preview.

## PR 7: Creative project adapters

- PSD and PSB composite preview;
- Affinity embedded preview;
- Krita merged preview;
- Blender saved thumbnail or controlled generation;
- Ableton project card, tempo, tracks, references, and missing dependencies.

## PR 8: Audio intelligence

- BPM, key, loudness, duration, channel, and sample-rate extraction;
- loop versus one-shot classification;
- duplicate and near-duplicate detection;
- similarity search;
- drag and clipboard workflows into Ableton.

## PR 9: Generic Sigma provider hooks

Only after the independent workspace proves the data model:

- thumbnail provider API;
- Quick View provider API;
- metadata provider API;
- virtual-location provider API;
- search provider API.

Adapters remain outside Sigma core.

## PR 10: Agent interface

- local CLI and stable command schema;
- read-only search and inspection commands first;
- explicit mutation commands for metadata and collections;
- least-privilege access tokens;
- audit log;
- optional MCP adapter.

## Acceptance criteria across all phases

- no source file mutation during indexing or preview generation;
- no metadata sidecars in indexed roots;
- no silent loss when a drive is unavailable;
- catalog migrations are forward-only, testable, and backed up;
- operations are cancellable where practical;
- large-library work remains responsive;
- Linux is the primary test platform;
- upstream Sigma integration remains a small, reviewable patch stack.
