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

Published releases additionally contain:

- `SHA256SUMS`
- `release-manifest.json`

The aggregate manifest is intended to become the source for Sigma's managed-binary declaration. A later integration can consume it without inventing checksums or archive names.

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

Three versions must match exactly:

1. `[package].version` in `Cargo.toml`;
2. the text in `RELEASE_VERSION`;
3. the `ulib-v*` tag suffix, when a tag initiates the workflow.

The release job fails closed when any present version differs.

### Reviewed product release

Changing `RELEASE_VERSION` in a pull request is the normal release authorization. Once the reviewed marker reaches `product`, the workflow:

1. builds Linux and Windows binaries from that exact product commit;
2. creates the tag `ulib-v<version>` when it does not exist;
3. publishes or updates the matching GitHub release.

For the first release, `RELEASE_VERSION` contains:

```text
0.1.0
```

Future catalog releases must update `Cargo.toml`, `Cargo.lock` when needed, and `RELEASE_VERSION` in the same reviewed change.

### Existing tag release

An existing matching tag can also be pushed directly:

```bash
git tag ulib-v0.1.0
git push origin ulib-v0.1.0
```

For either release path the job:

1. downloads the independently built Linux and Windows artifacts;
2. generates `SHA256SUMS`;
3. aggregates platform metadata into `release-manifest.json`;
4. creates the GitHub release, or replaces assets when rerunning the same version.

## Determinism

`package_release.py` normalizes archive metadata:

- archive entry name;
- modification time;
- owner and group identifiers;
- executable mode;
- ZIP timestamp;
- JSON key ordering.

The packager tests create each format twice and require byte-identical output.

The Rust compiler output itself is not claimed to be reproducible across arbitrary toolchains. `Cargo.lock`, the workflow runner, the product commit, and release metadata provide the build custody for a given release.

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

The release workflow has read-only repository permissions during build jobs. `contents: write` is granted only to the push-gated release job after both platform builds succeed.

No release workflow modifies the Universal Library catalog or any indexed user files.
