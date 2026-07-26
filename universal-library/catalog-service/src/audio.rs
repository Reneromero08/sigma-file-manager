use std::{fs::File, path::Path};

use anyhow::{Context, Result, bail};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use symphonia::{
    core::{
        audio::sample::Sample,
        codecs::audio::AudioDecoderOptions,
        errors::Error as SymphoniaError,
        formats::{FormatOptions, TrackType, probe::Hint},
        io::MediaSourceStream,
        meta::MetadataOptions,
    },
    default::{get_codecs, get_probe},
};

use super::{Catalog, now_ms};

const MIN_WAVEFORM_POINTS: usize = 32;
const MAX_WAVEFORM_POINTS: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysisRecord {
    pub asset_id: String,
    pub path: String,
    pub extension: Option<String>,
    pub sample_rate_hz: u32,
    pub channels: usize,
    pub frames: u64,
    pub duration_ms: u64,
    pub peak: f32,
    pub rms: f32,
    pub waveform_points: Vec<f32>,
    pub analyzed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysisIssue {
    pub asset_id: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioBatchAnalysisReport {
    pub attempted: usize,
    pub analyzed: usize,
    pub issues: Vec<AudioAnalysisIssue>,
}

#[derive(Debug)]
struct AudioAsset {
    id: String,
    media_kind: String,
    path: String,
    extension: Option<String>,
}

#[derive(Debug)]
struct DecodedSummary {
    sample_rate_hz: u32,
    channels: usize,
    frames: u64,
    peak: f32,
    rms: f32,
    waveform_points: Vec<f32>,
}

impl Catalog {
    pub fn analyze_audio(
        &mut self,
        asset_reference: &str,
        waveform_points: usize,
    ) -> Result<AudioAnalysisRecord> {
        let asset = resolve_audio_asset(self, asset_reference)?;
        if asset.media_kind != "audio" {
            bail!("asset is not classified as audio: {}", asset.path);
        }

        let decoded = decode_audio_file(
            Path::new(&asset.path),
            waveform_points.clamp(MIN_WAVEFORM_POINTS, MAX_WAVEFORM_POINTS),
        )?;
        let record = AudioAnalysisRecord {
            asset_id: asset.id.clone(),
            path: asset.path,
            extension: asset.extension,
            sample_rate_hz: decoded.sample_rate_hz,
            channels: decoded.channels,
            frames: decoded.frames,
            duration_ms: duration_ms(decoded.frames, decoded.sample_rate_hz),
            peak: decoded.peak,
            rms: decoded.rms,
            waveform_points: decoded.waveform_points,
            analyzed_at_ms: now_ms()?,
        };
        let value_json = serde_json::to_string(&record)?;
        self.set_asset_metadata(&asset.id, "audio", "analysis", &value_json, "ulib.audio")?;
        Ok(record)
    }

    pub fn get_audio_analysis(&self, asset_reference: &str) -> Result<Option<AudioAnalysisRecord>> {
        let asset = resolve_audio_asset(self, asset_reference)?;
        let value_json = self
            .connection
            .query_row(
                "SELECT value_json FROM asset_metadata
                 WHERE asset_id = ?1 AND namespace = 'audio' AND key = 'analysis'",
                [&asset.id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .context("failed to read audio analysis")?;

        value_json
            .map(|value| parse_analysis(&value, &asset.path))
            .transpose()
    }

    pub fn list_audio_analyses(&self, limit: u32) -> Result<Vec<AudioAnalysisRecord>> {
        let mut statement = self.connection.prepare(
            "SELECT m.value_json,
                    COALESCE((
                        SELECT preferred.path FROM locations preferred
                        WHERE preferred.asset_id = m.asset_id
                        ORDER BY preferred.is_online DESC, preferred.is_primary DESC,
                                 preferred.last_seen_at_ms DESC
                        LIMIT 1
                    ), '') AS current_path
             FROM asset_metadata m
             JOIN assets a ON a.id = m.asset_id
             WHERE m.namespace = 'audio' AND m.key = 'analysis'
               AND a.deleted_at_ms IS NULL
             ORDER BY a.modified_at_ns DESC, a.canonical_name COLLATE NOCASE
             LIMIT ?1",
        )?;
        let rows = statement.query_map([i64::from(limit.clamp(1, 10_000))], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let values = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to read stored audio analyses")?;
        values
            .into_iter()
            .map(|(value_json, current_path)| parse_analysis(&value_json, &current_path))
            .collect()
    }

    pub fn analyze_missing_audio(
        &mut self,
        limit: u32,
        waveform_points: usize,
    ) -> Result<AudioBatchAnalysisReport> {
        let candidates = {
            let mut statement = self.connection.prepare(
                "SELECT a.id,
                        COALESCE((
                            SELECT preferred.path FROM locations preferred
                            WHERE preferred.asset_id = a.id AND preferred.is_online = 1
                            ORDER BY preferred.is_primary DESC, preferred.last_seen_at_ms DESC
                            LIMIT 1
                        ), '') AS path
                 FROM assets a
                 WHERE a.media_kind = 'audio'
                   AND a.deleted_at_ms IS NULL
                   AND EXISTS(
                       SELECT 1 FROM locations online
                       WHERE online.asset_id = a.id AND online.is_online = 1
                   )
                   AND NOT EXISTS(
                       SELECT 1 FROM asset_metadata m
                       WHERE m.asset_id = a.id
                         AND m.namespace = 'audio'
                         AND m.key = 'analysis'
                   )
                 ORDER BY a.modified_at_ns DESC, a.canonical_name COLLATE NOCASE
                 LIMIT ?1",
            )?;
            statement
                .query_map([i64::from(limit.clamp(1, 10_000))], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };

        let mut report = AudioBatchAnalysisReport {
            attempted: candidates.len(),
            analyzed: 0,
            issues: Vec::new(),
        };
        for (asset_id, path) in candidates {
            match self.analyze_audio(&asset_id, waveform_points) {
                Ok(_) => report.analyzed += 1,
                Err(error) => report.issues.push(AudioAnalysisIssue {
                    asset_id,
                    path,
                    message: format!("{error:#}"),
                }),
            }
        }
        Ok(report)
    }
}

fn resolve_audio_asset(catalog: &Catalog, reference: &str) -> Result<AudioAsset> {
    let read = |candidate: &str| -> Result<Option<AudioAsset>> {
        catalog
            .connection
            .query_row(
                "SELECT a.id, a.media_kind,
                        COALESCE((
                            SELECT preferred.path FROM locations preferred
                            WHERE preferred.asset_id = a.id
                            ORDER BY preferred.is_online DESC, preferred.is_primary DESC,
                                     preferred.last_seen_at_ms DESC
                            LIMIT 1
                        ), '') AS primary_path,
                        a.extension
                 FROM assets a
                 WHERE a.id = ?1 OR EXISTS(
                     SELECT 1 FROM locations exact_path
                     WHERE exact_path.asset_id = a.id AND exact_path.path = ?1
                 )
                 ORDER BY CASE WHEN a.id = ?1 THEN 0 ELSE 1 END
                 LIMIT 1",
                [candidate],
                |row| {
                    Ok(AudioAsset {
                        id: row.get(0)?,
                        media_kind: row.get(1)?,
                        path: row.get(2)?,
                        extension: row.get(3)?,
                    })
                },
            )
            .optional()
            .context("failed to resolve audio asset")
    };

    if let Some(asset) = read(reference)? {
        if asset.path.is_empty() {
            bail!("audio asset has no indexed location: {reference}");
        }
        return Ok(asset);
    }
    if Path::new(reference).exists() {
        let canonical = std::fs::canonicalize(reference)?;
        if let Some(asset) = read(canonical.to_string_lossy().as_ref())? {
            return Ok(asset);
        }
    }
    bail!("unknown audio asset ID or path: {reference}")
}

fn parse_analysis(value_json: &str, current_path: &str) -> Result<AudioAnalysisRecord> {
    let mut record: AudioAnalysisRecord =
        serde_json::from_str(value_json).context("stored audio analysis is invalid")?;
    if !current_path.is_empty() {
        record.path = current_path.to_owned();
    }
    Ok(record)
}

fn decode_audio_file(path: &Path, target_points: usize) -> Result<DecodedSummary> {
    let file = Box::new(
        File::open(path)
            .with_context(|| format!("failed to open audio file {}", path.display()))?,
    );
    let stream = MediaSourceStream::new(file, Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let mut format = get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .with_context(|| format!("unsupported or unreadable audio format: {}", path.display()))?;
    let track = format
        .default_track(TrackType::Audio)
        .context("audio file contains no audio track")?;
    let audio_params = track
        .codec_params
        .as_ref()
        .context("audio track is missing codec parameters")?
        .audio()
        .context("track codec parameters are not audio")?;
    let mut decoder = get_codecs()
        .make_audio_decoder(audio_params, &AudioDecoderOptions::default())
        .context("audio codec is not supported")?;
    let track_id = track.id;

    let mut samples = Vec::<f32>::new();
    let mut sample_rate_hz = None;
    let mut channels = None;
    let mut frames = 0_u64;
    let mut peak = 0.0_f32;
    let mut sum_squares = 0.0_f64;
    let mut sample_count = 0_u64;
    let mut waveform = WaveformAccumulator::new(target_points);

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => {
                bail!("audio stream changed format during decoding")
            }
            Err(error) => return Err(error).context("failed to read audio packet"),
        };
        if packet.track_id != track_id {
            continue;
        }

        let audio = match decoder.decode(&packet) {
            Ok(audio) => audio,
            Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
            Err(SymphoniaError::ResetRequired) => {
                bail!("audio decoder requested a format reset")
            }
            Err(error) => return Err(error).context("failed to decode audio packet"),
        };
        let spec = audio.spec();
        let packet_channels = spec.channels().count();
        if packet_channels == 0 {
            continue;
        }
        match (sample_rate_hz, channels) {
            (None, None) => {
                sample_rate_hz = Some(spec.rate());
                channels = Some(packet_channels);
            }
            (Some(rate), Some(channel_count))
                if rate != spec.rate() || channel_count != packet_channels =>
            {
                bail!("audio specification changed during decoding")
            }
            _ => {}
        }

        samples.resize(audio.samples_interleaved(), f32::MID);
        audio.copy_to_slice_interleaved(&mut samples);
        for frame in samples.chunks_exact(packet_channels) {
            let mut frame_peak = 0.0_f32;
            for sample in frame {
                let value = if sample.is_finite() { *sample } else { 0.0 };
                let magnitude = value.abs();
                peak = peak.max(magnitude);
                frame_peak = frame_peak.max(magnitude);
                sum_squares += f64::from(value) * f64::from(value);
                sample_count += 1;
            }
            waveform.push(frame_peak.min(1.0));
            frames += 1;
        }
    }

    let sample_rate_hz = sample_rate_hz.context("audio decoder produced no samples")?;
    let channels = channels.context("audio decoder produced no channel specification")?;
    if frames == 0 || sample_count == 0 {
        bail!("audio decoder produced no playable frames");
    }

    Ok(DecodedSummary {
        sample_rate_hz,
        channels,
        frames,
        peak,
        rms: (sum_squares / sample_count as f64).sqrt() as f32,
        waveform_points: waveform.finish(),
    })
}

fn duration_ms(frames: u64, sample_rate_hz: u32) -> u64 {
    frames.saturating_mul(1000) / u64::from(sample_rate_hz.max(1))
}

#[derive(Debug)]
struct WaveformAccumulator {
    target_points: usize,
    bucket_size: u64,
    bucket_frames: u64,
    bucket_peak: f32,
    points: Vec<f32>,
}

impl WaveformAccumulator {
    fn new(target_points: usize) -> Self {
        Self {
            target_points,
            bucket_size: 1,
            bucket_frames: 0,
            bucket_peak: 0.0,
            points: Vec::with_capacity(target_points.saturating_mul(2)),
        }
    }

    fn push(&mut self, value: f32) {
        self.bucket_peak = self.bucket_peak.max(value);
        self.bucket_frames += 1;
        if self.bucket_frames < self.bucket_size {
            return;
        }

        self.points.push(self.bucket_peak);
        self.bucket_frames = 0;
        self.bucket_peak = 0.0;
        if self.points.len() >= self.target_points.saturating_mul(2) {
            self.compact();
        }
    }

    fn compact(&mut self) {
        let mut compacted = Vec::with_capacity(self.points.len().div_ceil(2));
        for pair in self.points.chunks(2) {
            compacted.push(pair.iter().copied().fold(0.0_f32, f32::max));
        }
        self.points = compacted;
        self.bucket_size = self.bucket_size.saturating_mul(2);
    }

    fn finish(mut self) -> Vec<f32> {
        if self.bucket_frames > 0 {
            self.points.push(self.bucket_peak);
        }
        while self.points.len() > self.target_points {
            self.compact();
        }
        self.points
    }
}

#[cfg(test)]
mod tests {
    use super::{WaveformAccumulator, duration_ms};

    #[test]
    fn waveform_accumulator_remains_bounded() {
        let mut waveform = WaveformAccumulator::new(64);
        for index in 0..100_000 {
            waveform.push((index % 100) as f32 / 100.0);
        }
        let points = waveform.finish();
        assert!(!points.is_empty());
        assert!(points.len() <= 64);
        assert!(points.iter().all(|value| (0.0..=1.0).contains(value)));
    }

    #[test]
    fn duration_uses_decoded_frames() {
        assert_eq!(duration_ms(44_100, 44_100), 1000);
        assert_eq!(duration_ms(800, 8_000), 100);
    }
}
