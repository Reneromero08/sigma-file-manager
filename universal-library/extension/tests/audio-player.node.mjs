import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuditionController } from '../ui/audio-player.js';

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.src = '';
    this.currentTime = 0;
    this.duration = 12;
    this.volume = 1;
    this.paused = true;
    this.preload = '';
    this.error = null;
    this.loadCalls = 0;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target: this });
    }
  }

  load() {
    this.loadCalls += 1;
  }

  async play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatch('play');
  }

  pause() {
    this.pauseCalls += 1;
    const wasPaused = this.paused;
    this.paused = true;
    if (!wasPaused) this.dispatch('pause');
  }

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
}

function asset(id = 'asset-1', path = '/library/kick.wav') {
  return {
    id,
    primaryPath: path,
    audioAnalysis: { durationMs: 12_000 },
  };
}

test('streams one active audio asset and toggles play and pause', async () => {
  const audio = new FakeAudio();
  const changes = [];
  const controller = createAuditionController({
    resolveUrl: async value => ({ url: `asset://localhost${value.primaryPath}` }),
    createAudio: () => audio,
    onChange: state => changes.push(state),
  });

  await controller.toggle(asset());
  assert.equal(audio.src, 'asset://localhost/library/kick.wav');
  assert.equal(audio.preload, 'metadata');
  assert.equal(audio.playCalls, 1);
  assert.equal(controller.snapshot().status, 'playing');

  await controller.toggle(asset());
  assert.equal(audio.pauseCalls >= 1, true);
  assert.equal(controller.snapshot().status, 'paused');
  assert.ok(changes.some(change => change.status === 'loading'));
});

test('switches assets and ignores stale URL resolutions', async () => {
  const audio = new FakeAudio();
  const pending = new Map();
  const controller = createAuditionController({
    resolveUrl: value => new Promise((resolve) => {
      pending.set(value.id, resolve);
    }),
    createAudio: () => audio,
  });

  const first = controller.toggle(asset('one', '/one.wav'));
  const second = controller.toggle(asset('two', '/two.wav'));
  pending.get('one')({ url: 'asset://localhost/one.wav' });
  await first;
  assert.notEqual(audio.src, 'asset://localhost/one.wav');

  pending.get('two')({ url: 'asset://localhost/two.wav' });
  await second;
  assert.equal(audio.src, 'asset://localhost/two.wav');
  assert.equal(controller.snapshot().assetId, 'two');
});

test('tracks metadata, progress, seeking, volume, and ending', async () => {
  const audio = new FakeAudio();
  const controller = createAuditionController({
    resolveUrl: async () => 'asset://localhost/kick.wav',
    createAudio: () => audio,
  });

  await controller.toggle(asset());
  audio.duration = 20;
  audio.currentTime = 5;
  audio.dispatch('loadedmetadata');
  audio.dispatch('timeupdate');
  assert.equal(controller.snapshot().duration, 20);
  assert.equal(controller.snapshot().currentTime, 5);

  controller.seekRatio(0.5);
  assert.equal(audio.currentTime, 10);
  controller.setVolume(3);
  assert.equal(audio.volume, 1);
  controller.setVolume(-2);
  assert.equal(audio.volume, 0);

  audio.dispatch('ended');
  assert.equal(controller.snapshot().status, 'ended');
  assert.equal(controller.snapshot().currentTime, 20);
});

test('reports playback failures and validates online assets', async () => {
  const audio = new FakeAudio();
  audio.play = async () => {
    throw new Error('autoplay denied');
  };
  const controller = createAuditionController({
    resolveUrl: async () => 'asset://localhost/kick.wav',
    createAudio: () => audio,
  });

  await assert.rejects(controller.toggle(asset()), /autoplay denied/);
  assert.equal(controller.snapshot().status, 'error');
  assert.match(controller.snapshot().error, /autoplay denied/);
  await assert.rejects(controller.toggle({ id: 'offline', primaryPath: null }), /online audio asset/);
});

test('stops and disposes the current preview', async () => {
  const audio = new FakeAudio();
  const controller = createAuditionController({
    resolveUrl: async () => 'asset://localhost/kick.wav',
    createAudio: () => audio,
  });
  await controller.toggle(asset());
  controller.stop();
  assert.equal(audio.src, '');
  assert.equal(controller.snapshot().status, 'idle');
  assert.equal(controller.snapshot().assetId, null);
  assert.doesNotThrow(() => controller.dispose());
});
