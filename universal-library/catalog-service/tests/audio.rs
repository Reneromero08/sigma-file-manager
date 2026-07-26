use std::{f32::consts::TAU, fs, io::Write, path::Path};

use tempfile::tempdir;
use universal_library_catalog::{Catalog, ScanOptions};

#[test]
fn analyzes_and_persists_a_waveform_without_mutating_audio() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Samples");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create sample root");
    let sample = root.join("sine.wav");
    write_test_wav(&sample, 8_000, 800);
    let original = fs::read(&sample).expect("read original audio");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan audio root");

    let analysis = catalog
        .analyze_audio(sample.to_string_lossy().as_ref(), 64)
        .expect("analyze audio");
    assert_eq!(analysis.sample_rate_hz, 8_000);
    assert_eq!(analysis.channels, 1);
    assert_eq!(analysis.frames, 800);
    assert_eq!(analysis.duration_ms, 100);
    assert!((0.45..=0.51).contains(&analysis.peak));
    assert!((0.30..=0.38).contains(&analysis.rms));
    assert!(!analysis.waveform_points.is_empty());
    assert!(analysis.waveform_points.len() <= 64);
    assert!(
        analysis
            .waveform_points
            .iter()
            .all(|value| (0.0..=1.0).contains(value))
    );
    assert_eq!(fs::read(&sample).expect("re-read audio"), original);

    let stored = catalog
        .get_audio_analysis(&analysis.asset_id)
        .expect("read stored analysis")
        .expect("stored analysis exists");
    let canonical_sample = fs::canonicalize(&sample).expect("canonical sample path");
    assert_eq!(stored.asset_id, analysis.asset_id);
    assert_eq!(Path::new(&stored.path), canonical_sample);

    let listed = catalog.list_audio_analyses(100).expect("list analyses");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].asset_id, analysis.asset_id);
}

#[test]
fn batch_analysis_only_processes_missing_online_audio() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Samples");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create sample root");
    write_test_wav(&root.join("one.wav"), 8_000, 160);
    write_test_wav(&root.join("two.wav"), 8_000, 320);

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan audio root");

    let first = catalog
        .analyze_missing_audio(100, 32)
        .expect("analyze missing audio");
    assert_eq!(first.attempted, 2);
    assert_eq!(first.analyzed, 2);
    assert!(first.issues.is_empty());

    let second = catalog
        .analyze_missing_audio(100, 32)
        .expect("repeat missing analysis");
    assert_eq!(second.attempted, 0);
    assert_eq!(second.analyzed, 0);
}

#[test]
fn rejects_non_audio_assets() {
    let directory = tempdir().expect("temp directory");
    let root = directory.path().join("Library");
    let database = directory.path().join("State").join("catalog.sqlite3");
    fs::create_dir(&root).expect("create root");
    let design = root.join("cover.psd");
    fs::write(&design, b"design").expect("write design fixture");

    let mut catalog = Catalog::open(&database).expect("open catalog");
    let registered = catalog.add_root(&root, None).expect("add root");
    catalog
        .scan_root(&registered.id, ScanOptions::default())
        .expect("scan root");

    let error = catalog
        .analyze_audio(design.to_string_lossy().as_ref(), 64)
        .expect_err("design asset must be rejected");
    assert!(format!("{error:#}").contains("not classified as audio"));
}

fn write_test_wav(path: &Path, sample_rate: u32, frames: u32) {
    let channels = 1_u16;
    let bits_per_sample = 16_u16;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * u32::from(block_align);
    let data_size = frames * u32::from(block_align);
    let riff_size = 36 + data_size;
    let mut file = fs::File::create(path).expect("create WAV fixture");

    file.write_all(b"RIFF").expect("write RIFF");
    file.write_all(&riff_size.to_le_bytes())
        .expect("write RIFF size");
    file.write_all(b"WAVEfmt ").expect("write WAVE format");
    file.write_all(&16_u32.to_le_bytes())
        .expect("write fmt size");
    file.write_all(&1_u16.to_le_bytes())
        .expect("write PCM format");
    file.write_all(&channels.to_le_bytes())
        .expect("write channels");
    file.write_all(&sample_rate.to_le_bytes())
        .expect("write sample rate");
    file.write_all(&byte_rate.to_le_bytes())
        .expect("write byte rate");
    file.write_all(&block_align.to_le_bytes())
        .expect("write block align");
    file.write_all(&bits_per_sample.to_le_bytes())
        .expect("write bit depth");
    file.write_all(b"data").expect("write data marker");
    file.write_all(&data_size.to_le_bytes())
        .expect("write data size");

    for frame in 0..frames {
        let phase = frame as f32 / sample_rate as f32 * 440.0 * TAU;
        let sample = (phase.sin() * 0.5 * f32::from(i16::MAX)) as i16;
        file.write_all(&sample.to_le_bytes()).expect("write sample");
    }
}
