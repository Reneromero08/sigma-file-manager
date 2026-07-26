import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  analysisMap,
  createWaveformSvg,
  enrichAssetsWithAudio,
  formatDuration,
  formatSampleRate,
  waveformPath,
} from '../ui/audio-ui.js';

test('indexes audio analyses by durable asset id and enriches cards', () => {
  const records = [{ assetId: 'asset-1', durationMs: 1000, waveformPoints: [0.1, 0.8] }];
  const map = analysisMap(records);
  const assets = enrichAssetsWithAudio([
    { id: 'asset-1', canonicalName: 'kick.wav' },
    { id: 'asset-2', canonicalName: 'cover.psd' },
  ], map);

  assert.equal(map.get('asset-1').durationMs, 1000);
  assert.equal(assets[0].audioAnalysis.assetId, 'asset-1');
  assert.equal(assets[1].audioAnalysis, null);
});

test('formats practical audio facts', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(61_000), '1:01');
  assert.equal(formatDuration(null), 'Unknown');
  assert.equal(formatSampleRate(44_100), '44.1 kHz');
  assert.equal(formatSampleRate(48_000), '48 kHz');
});

test('creates a clamped symmetric waveform path', () => {
  const path = waveformPath([-1, 0.5, 5], 100, 40);
  assert.match(path, /^M/);
  assert.match(path, /Z$/);
  assert.equal(path.includes('NaN'), false);
  assert.equal(waveformPath([]), '');
});

test('renders an accessible SVG without injecting source content', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const svg = createWaveformSvg(dom.window.document, {
    waveformPoints: [0.1, 0.5, 1],
  });

  assert.equal(svg.tagName.toLowerCase(), 'svg');
  assert.equal(svg.getAttribute('aria-label'), 'Audio waveform');
  assert.match(svg.querySelector('path').getAttribute('d'), /^M/);
  assert.equal(createWaveformSvg(dom.window.document, null), null);
});
