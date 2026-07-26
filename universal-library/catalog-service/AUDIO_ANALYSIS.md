# Universal Library audio analysis

`ulib 0.2.0` adds read-only audio decoding and durable waveform metadata for indexed audio assets.

## Commands

```bash
ulib audio analyze <asset-id-or-path> --points 256
ulib audio get <asset-id-or-path>
ulib audio list --limit 1000
ulib audio analyze-missing --limit 500 --points 256
```

`--points` is clamped between 32 and 2048. The decoder streams packets and compacts peak buckets while reading, so waveform memory remains bounded by the requested resolution rather than file duration.

## Stored record

Analysis is stored in the existing `asset_metadata` table:

```text
namespace: audio
key:       analysis
source:    ulib.audio
```

The JSON record includes:

- asset ID and current indexed path;
- extension;
- sample rate;
- channel count;
- decoded frame count;
- duration in milliseconds;
- absolute peak;
- RMS amplitude;
- normalized waveform peak points;
- analysis timestamp.

No schema migration is required. Existing catalogs remain compatible, and the normal metadata audit path records each analysis update.

## Supported decoding

The catalog uses pure-Rust Symphonia 0.6 with the stable WAV/RIFF, AIFF, FLAC, OGG/Vorbis, and MP3 components enabled. Unsupported or damaged files are reported per asset by `analyze-missing` without aborting the remaining batch.

## Safety

Audio source files are opened read-only. Analysis writes only to the central SQLite catalog and never rewrites, normalizes, copies, moves, or deletes source audio.
