#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("package_release.py")
PAYLOAD = b"universal-library-catalog-test-binary\n"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReleasePackagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.executable = self.root / "ulib"
        self.executable.write_bytes(PAYLOAD)
        self.executable.chmod(0o755)

    def run_packager(self, output: Path, archive_format: str, archive_name: str) -> dict[str, object]:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--executable",
                str(self.executable),
                "--output",
                str(output),
                "--format",
                archive_format,
                "--platform",
                "linux" if archive_format == "tar.gz" else "windows",
                "--arch",
                "x64",
                "--version",
                "0.1.0",
                "--archive-name",
                archive_name,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout)

    def assert_metadata(self, output: Path, *, platform: str, executable: str) -> None:
        metadata_path = output.with_suffix(output.suffix + ".json")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.assertEqual(metadata["schemaVersion"], 1)
        self.assertEqual(metadata["version"], "0.1.0")
        self.assertEqual(metadata["platform"], platform)
        self.assertEqual(metadata["arch"], "x64")
        self.assertEqual(metadata["archive"], output.name)
        self.assertEqual(metadata["executable"], executable)
        self.assertEqual(metadata["sha256"], digest(output))
        self.assertEqual(metadata["sizeBytes"], output.stat().st_size)

    def test_tar_gz_is_deterministic_and_preserves_executable_mode(self) -> None:
        first = self.root / "first.tar.gz"
        second = self.root / "second.tar.gz"
        self.run_packager(first, "tar.gz", "ulib")
        self.run_packager(second, "tar.gz", "ulib")

        self.assertEqual(first.read_bytes(), second.read_bytes())
        with tarfile.open(first, "r:gz") as archive:
            members = archive.getmembers()
            self.assertEqual([member.name for member in members], ["ulib"])
            self.assertEqual(members[0].mode, 0o755)
            extracted = archive.extractfile(members[0])
            self.assertIsNotNone(extracted)
            self.assertEqual(extracted.read(), PAYLOAD)
        self.assert_metadata(first, platform="linux", executable="ulib")

    def test_zip_is_deterministic_and_contains_the_windows_executable(self) -> None:
        first = self.root / "first.zip"
        second = self.root / "second.zip"
        self.run_packager(first, "zip", "ulib.exe")
        self.run_packager(second, "zip", "ulib.exe")

        self.assertEqual(first.read_bytes(), second.read_bytes())
        with zipfile.ZipFile(first) as archive:
            self.assertEqual(archive.namelist(), ["ulib.exe"])
            info = archive.getinfo("ulib.exe")
            self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
            self.assertEqual(archive.read("ulib.exe"), PAYLOAD)
        self.assert_metadata(first, platform="windows", executable="ulib.exe")

    def test_missing_executable_fails_closed(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--executable",
                str(self.root / "missing"),
                "--output",
                str(self.root / "missing.tar.gz"),
                "--format",
                "tar.gz",
                "--platform",
                "linux",
                "--arch",
                "x64",
                "--version",
                "0.1.0",
                "--archive-name",
                "ulib",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Executable does not exist", result.stderr)


if __name__ == "__main__":
    unittest.main()
