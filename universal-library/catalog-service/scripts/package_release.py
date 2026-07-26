#!/usr/bin/env python3
"""Create deterministic Universal Library catalog release archives and metadata."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import tarfile
import zipfile

ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_tar_gz(executable: Path, output: Path, archive_name: str) -> None:
    payload = executable.read_bytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw_output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_output, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as archive:
                info = tarfile.TarInfo(archive_name)
                info.size = len(payload)
                info.mode = 0o755
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                info.mtime = 0
                archive.addfile(info, fileobj=_BytesReader(payload))


def package_zip(executable: Path, output: Path, archive_name: str) -> None:
    payload = executable.read_bytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    info = zipfile.ZipInfo(archive_name, ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o755 << 16
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(info, payload, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


class _BytesReader:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload
        self._offset = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = len(self._payload) - self._offset
        start = self._offset
        end = min(len(self._payload), start + size)
        self._offset = end
        return self._payload[start:end]


def write_metadata(
    output: Path,
    *,
    archive: Path,
    version: str,
    platform: str,
    arch: str,
    executable_name: str,
) -> Path:
    metadata_path = output.with_suffix(output.suffix + ".json")
    metadata = {
        "schemaVersion": 1,
        "version": version,
        "platform": platform,
        "arch": arch,
        "archive": archive.name,
        "executable": executable_name,
        "sha256": sha256(archive),
        "sizeBytes": archive.stat().st_size,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--format", choices=("tar.gz", "zip"), required=True)
    parser.add_argument("--platform", choices=("linux", "windows", "macos"), required=True)
    parser.add_argument("--arch", choices=("x64", "arm64"), required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--archive-name", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    executable = args.executable.resolve()
    output = args.output.resolve()
    if not executable.is_file():
        raise SystemExit(f"Executable does not exist: {executable}")
    if not args.version.strip():
        raise SystemExit("Version must not be empty")

    if args.format == "tar.gz":
        package_tar_gz(executable, output, args.archive_name)
    else:
        package_zip(executable, output, args.archive_name)

    metadata_path = write_metadata(
        output,
        archive=output,
        version=args.version.strip(),
        platform=args.platform,
        arch=args.arch,
        executable_name=args.archive_name,
    )
    print(
        json.dumps(
            {
                "archive": os.fspath(output),
                "metadata": os.fspath(metadata_path),
                "sha256": sha256(output),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
