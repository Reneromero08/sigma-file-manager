# Universal Library architecture

## Goal

Create one polished interface for the entire machine while preserving the ordinary filesystem as the source of truth.

A folder, search result, manually ordered collection, smart collection, sample library, design workspace, and project workspace should all present the same asset objects through different views.

## System boundary

```text
Real files and attached storage
             │
             ▼
Universal Library daemon
├── root registry and recursive watchers
├── identity and path reconciliation
├── SQLite catalog
├── metadata adapters
├── preview generation
├── audio analysis
├── search
└── local CLI / API
             │
             ▼
Sigma Universal Library extension
├── filesystem navigation
├── mixed-media collections
├── smart collections
├── gallery and contact sheet
├── waveform browser
├── inspector
└── agent-triggered actions
```

Sigma is the current presentation shell. The daemon and catalog must not depend on Sigma internals.

## File custody

Universal Library must be non-destructive unless the user explicitly invokes a file operation.

Indexing may read:

- paths and directory entries;
- filesystem identity where available;
- timestamps and sizes;
- enough bytes to generate fingerprints and previews;
- embedded metadata;
- project manifests and dependency references.

Indexing must not:

- move or rename files;
- rewrite source documents;
- create sidecars beside files;
- duplicate files into a managed library;
- modify application project structures;
- silently delete catalog records when a drive is temporarily offline.

## Identity model

Paths are mutable locations, not asset identity.

The catalog will reconcile multiple signals:

1. filesystem identity, such as device plus inode on Linux;
2. current and historical paths;
3. size and modification time;
4. a fast partial fingerprint;
5. a full content hash when duplication or cross-volume reconciliation requires it.

An asset may have multiple locations. A temporarily missing location remains recorded and marked offline. A confirmed copy can either become another location for identical content or a separate logical asset, depending on future user policy.

## Metadata model

All assets share common fields:

- tags;
- rating;
- color label;
- status;
- description;
- collections;
- relationships;
- timestamps;
- usage history.

Adapters add type-specific fields without changing the common model. Examples include BPM and key for audio, dimensions and color profile for images, and dependency state for Ableton projects.

Metadata is stored centrally under the user's application data directory. The database path must be configurable and independently backed up.

## Collections

Collections store asset references rather than files. They support:

- mixed media;
- manual ordering;
- nested collections;
- covers and descriptions;
- the same asset in multiple collections;
- smart collections backed by saved queries;
- temporary agent-generated collections.

Collection membership never changes the underlying filesystem path.

## Preview architecture

Preview adapters produce cacheable representations:

- image thumbnails and composites;
- audio waveforms and short audition proxies;
- video poster frames and scrub proxies;
- PDF pages;
- font specimens;
- project cards for non-renderable formats;
- text extraction for search.

The cache is disposable. Catalog metadata must remain valid when previews are deleted and regenerated.

## Sigma integration policy

Prefer the public extension API first. Core changes are allowed only for generic capabilities that benefit arbitrary extensions.

Expected future provider APIs:

```ts
sigma.previews.registerThumbnailProvider(...)
sigma.previews.registerQuickViewProvider(...)
sigma.metadata.registerProvider(...)
sigma.locations.registerVirtualLocationProvider(...)
sigma.search.registerProvider(...)
```

Do not embed PSD, Ableton, Affinity, or audio-analysis logic directly into Sigma core.

## Upstream maintenance

- `main` mirrors upstream Sigma.
- `product` is the integration target for the custom build.
- each feature is developed on a focused branch and merged through a PR into `product`;
- upstream releases are merged into temporary `integration/<version>` branches;
- recurring conflict resolutions should be recorded with Git `rerere`;
- the independent catalog and extension should absorb most product changes, keeping the Sigma patch stack small.

## Security and privacy

- all indexing and analysis are local by default;
- directory access is user-approved and scoped;
- external network access requires an explicit feature and permission;
- local APIs bind to loopback and require an authentication token once write operations are introduced;
- agents receive least-privilege commands rather than unrestricted filesystem access through the catalog service.
