# Releasing Universal Library catalog binaries

The `Universal Library catalog binaries` workflow builds portable `ulib` archives for Sigma and direct CLI use.

## Supported artifacts

| Platform | Architecture | Archive | Executable inside |
| --- | --- | --- | --- |
| Linux | x64 | `ulib-linux-x64.tar.gz` | `ulib` |
| Windows | x64 | `ulib-windows-x64.zip` | `ulib.exe` |

Each archive is accompanied by a JSON metadata file:

- `ulib-linux-x64.tar.gz.json`
- `ulib-windows-x64.zip.json`

Metadata schema v1 contains:

- catalog version;
- Sigma platform and architecture names;
- archive file name;
- executable name inside the archive;
- SHA-256 digest;
- archive size.

Tagged releases additionally contain:

- `SHA256SUMS`
- `release-manifest.json`

The aggregate manifest is intended to become the source for Sigma's managed-binary declaration. A later integration PR can consume it without inventing checksums or archive names.

## Validation on pull requests

Changes to the catalog service, packager, or binary workflow build both platforms and run:

1. deterministic packager tests;
2. `cargo test --locked`;
3. `cargo build --locked --release`;
4. the built binary's `--version` command;
5. archive packaging;
6. artifact upload.

Pull-request and manual-dispatch runs never create GitHub releases.

## Creating a release

The crate version in `Cargo.toml` is authoritative. For version `0.1.0`:

```bash
git tag ulib-v0.1.0
git push origin ulib-v0.1.0
```

The release job fails closed when the tag suffix does not exactly match the crate version.

For a matching tag it:

1. downloads the independently built Linux and Windows artifacts;
2. generates `SHA256SUMS`;
3. aggregates platform metadata into `release-manifest.json`;
4. creates the GitHub release, or replaces assets when rerunning the same tag.

## Determinism

`package_release.py` normalizes archive metadata:

- archive entry name;
- modification time;
- owner and group identifiers;
- executable mode;
- ZIP timestamp;
- JSON key ordering.

The packager tests create each format twice and require byte-identical output.

The Rust compiler output itself is not claimed to be reproducible across arbitrary toolchains. `Cargo.lock`, the workflow runner, and the release tag provide the build custody for a given release.

## Local packaging test

```bash
python universal-library/catalog-service/scripts/test_package_release.py
```

Example Linux package command:

```bash
python universal-library/catalog-service/scripts/package_release.py \
  --executable universal-library/catalog-service/target/release/ulib \
  --output dist/ulib-linux-x64.tar.gz \
  --format tar.gz \
  --platform linux \
  --arch x64 \
  --version 0.1.0 \
  --archive-name ulib
```

## Safety

The release workflow has read-only repository permissions during build jobs. `contents: write` is granted only to the tag-gated release job.

No release workflow modifies the Universal Library catalog or any indexed user files.
