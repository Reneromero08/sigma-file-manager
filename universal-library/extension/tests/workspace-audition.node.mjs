import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.src = '';
    this.currentTime = 0;
    this.duration = 12;
    this.volume = 1;
    this.paused = true;
    this.preload = '';
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
    this.dispatch('loadedmetadata');
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

let dom;
let audio;
let commandCalls;

function snapshot() {
  return {
    health: {
      status: 'ok',
      schemaVersion: 1,
      rootCount: 1,
      collectionCount: 0,
    },
    assets: [{
      id: 'audio-1',
      canonicalName: 'dusty_kick.wav',
      mediaKind: 'audio',
      primaryPath: '/library/dusty_kick.wav',
      isOnline: true,
      sizeBytes: 2048,
      modifiedAtNs: 1_700_000_000_000_000_000,
    }],
    audioAnalyses: [{
      assetId: 'audio-1',
      durationMs: 12_000,
      sampleRateHz: 44_100,
      channels: 2,
      peak: 0.9,
      rms: 0.3,
      waveformPoints: [0.1, 0.5, 0.9, 0.3],
    }],
    collections: [],
    tags: [],
    generatedAt: Date.now(),
  };
}

function createSigma() {
  return {
    storage: {
      async get() {
        return false;
      },
      async set() {},
    },
    commands: {
      async executeCommand(commandId, request) {
        commandCalls.push({ commandId, request });
        if (commandId !== 'browse-assets') return undefined;
        if (request.action === 'snapshot') return snapshot();
        if (request.action === 'audio-url') {
          return {
            path: request.path,
            url: `asset://localhost${request.path}`,
          };
        }
        return {};
      },
    },
    ui: {
      button(options) {
        return { type: 'button', ...options };
      },
      renderToolbar() {
        return { unmount() {} };
      },
      showNotification() {},
      async clipboardWriteFiles() {},
    },
  };
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://localhost',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.requestAnimationFrame = callback => callback();
  audio = new FakeAudio();
  commandCalls = [];
});

afterEach(() => {
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Element;
  delete globalThis.HTMLElement;
  delete globalThis.Node;
  delete globalThis.Event;
  delete globalThis.KeyboardEvent;
  delete globalThis.requestAnimationFrame;
});

test('clicking an online audio card toggles one scoped preview', async () => {
  const { mount } = await import(`../ui/workspace.js?audition-click=${Date.now()}`);
  const container = document.getElementById('app');
  const mounted = await mount(container, {
    sigma: createSigma(),
    toolbarContainer: {},
    audioFactory: () => audio,
  });

  container.querySelector('.ul-asset-card').click();
  await tick();

  assert.equal(audio.src, 'asset://localhost/library/dusty_kick.wav');
  assert.equal(audio.playCalls, 1);
  assert.ok(commandCalls.some(call => call.request?.action === 'audio-url'));
  assert.equal(container.querySelector('.ul-asset-card').classList.contains('is-playing'), true);
  assert.match(container.querySelector('[data-action="toggle-audio"]').textContent, /Pause/);

  container.querySelector('.ul-asset-card').click();
  await tick();
  assert.equal(audio.paused, true);
  assert.match(container.querySelector('[data-action="toggle-audio"]').textContent, /Play/);

  mounted.dispose();
});

test('Space toggles the selected sample but does not hijack typing', async () => {
  const { mount } = await import(`../ui/workspace.js?audition-space=${Date.now()}`);
  const container = document.getElementById('app');
  const mounted = await mount(container, {
    sigma: createSigma(),
    toolbarContainer: {},
    audioFactory: () => audio,
  });

  document.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
  }));
  await tick();
  assert.equal(audio.playCalls, 1);

  const search = container.querySelector('[data-role="search"]');
  search.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
  }));
  await tick();
  assert.equal(audio.playCalls, 1);

  mounted.dispose();
});

test('inspector controls seek and volume for the active preview', async () => {
  const { mount } = await import(`../ui/workspace.js?audition-controls=${Date.now()}`);
  const container = document.getElementById('app');
  const mounted = await mount(container, {
    sigma: createSigma(),
    toolbarContainer: {},
    audioFactory: () => audio,
  });

  container.querySelector('[data-action="toggle-audio"]').click();
  await tick();

  const seek = container.querySelector('[data-action="seek-audio"]');
  seek.value = '500';
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(audio.currentTime, 6);

  const volume = container.querySelector('[data-action="volume-audio"]');
  volume.value = '25';
  volume.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(audio.volume, 0.25);

  mounted.dispose();
});
