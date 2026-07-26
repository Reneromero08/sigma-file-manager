export function analysisMap(records) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (record && typeof record.assetId === 'string') {
      map.set(record.assetId, record);
    }
  }
  return map;
}

export function enrichAssetsWithAudio(assets, records) {
  const byAsset = records instanceof Map ? records : analysisMap(records);
  return (Array.isArray(assets) ? assets : []).map(asset => ({
    ...asset,
    audioAnalysis: byAsset.get(asset.id) ?? null,
  }));
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Unknown';
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatSampleRate(sampleRateHz) {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return 'Unknown';
  const kilohertz = sampleRateHz / 1000;
  return `${Number.isInteger(kilohertz) ? kilohertz : kilohertz.toFixed(1)} kHz`;
}

export function waveformPath(points, width = 160, height = 56) {
  const samples = (Array.isArray(points) ? points : [])
    .map(value => Number(value))
    .filter(Number.isFinite)
    .map(value => Math.min(1, Math.max(0, value)));
  if (!samples.length || width <= 0 || height <= 0) return '';

  const center = height / 2;
  const step = samples.length === 1 ? 0 : width / (samples.length - 1);
  const upper = samples.map((value, index) => `${index * step},${center - value * center}`);
  const lower = [...samples]
    .reverse()
    .map((value, reverseIndex) => {
      const index = samples.length - 1 - reverseIndex;
      return `${index * step},${center + value * center}`;
    });
  return `M${upper.join(' L')} L${lower.join(' L')} Z`;
}

export function createWaveformSvg(documentObject, analysis, className = 'ul-waveform') {
  if (!analysis?.waveformPoints?.length) return null;
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = documentObject.createElementNS(namespace, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 160 56');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-label', 'Audio waveform');
  const path = documentObject.createElementNS(namespace, 'path');
  path.setAttribute('d', waveformPath(analysis.waveformPoints));
  svg.append(path);
  return svg;
}
