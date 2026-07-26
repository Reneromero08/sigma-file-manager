import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';

let dom;
let clipboardWrites;
let notifications;
let commandCalls;
let toolbarHandler;

function snapshot() {
  return {
    health: {
      status: 'ok',
      schemaVersion: 1,
      rootCount: 2,
      collectionCount: 1,
    },
    assets: [
      {
        id: 'asset-1',
        canonicalName: 'dusty_kick.wav',
        mediaKind: 'audio',
        primaryPath: '/library/dusty_kick.wav',
        isOnline: true,
        sizeBytes: 2048,
        modifiedAtNs: 1_700_000_000_000_000_000,
      },
      {
        id: 'asset-2',
        canonicalName: 'cover.psd',
        mediaKind: 'design',
        primaryPath: null,
        isOnline: false,
        sizeBytes: 4096,
        modifiedAtNs: 1_700_000_000_000_000_000,
      },
    ],
    audioAnalyses: [{
      assetId: 'asset-1',
      durationMs: 12_300,
      sampleRateHz: 44_100,
      channels: 2,
      peak: 0.92,
      rms: 0.31,
      waveformPoints: [0.1, 0.5, 0.9, 0.3],
    }],
    collections: [{ id: 'collection-1', name: 'Album 03' }],
    tags: [{ id: 'tag-1', name: 'dark', color: '#9c7cff' }],
    generatedAt: Date.now(),
  };
}

function createSigma() {
  const stored = new Map();
  return {
    storage: {
      async get(key) {
        return stored.get(key);
      },
      async set(key, value) {
        stored.set(key, value);
      },
    },
    commands: {
      async executeCommand(commandId, request) {
        commandCalls.push({ commandId, request });
        if (commandId !== 'browse-assets') return undefined;
        if (request.action === 'snapshot') return snapshot();
        if (request.action === 'collection-items') {
          return [{
            assetId: 'asset-1',
            canonicalName: 'dusty_kick.wav',
            mediaKind: 'audio',
            primaryPath: '/library/dusty_kick.wav',
            position: 10,
          }];
        }
        if (request.action === 'analyze-missing-audio') {
          return { attempted: 2, analyzed: 2, issues: [] };
        }
        if (request.action === 'analyze-audio') {
          return snapshot().audioAnalyses[0];
        }
        return {};
      },
    },
    ui: {
      button(options) {
        return { type: 'button', ...options };
      },
      renderToolbar(_container, _elements, handler) {
        toolbarHandler = handler;
        return { unmount() {} };
      },
      async clipboardWriteFiles(paths, operation) {
        clipboardWrites.push({ paths, operation });
      },
      showNotification(value) {
        notifications.push(value);
      },
    },
  };
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
  globalThis.requestAnimationFrame = callback => callback();
  clipboardWrites = [];
  notifications = [];
  commandCalls = [];
  toolbarHandler = null;
});

afterEach(() => {
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Element;
  delete globalThis.HTMLElement;
  delete globalThis.Node;
  delete globalThis.requestAnimationFrame;
});

test('mounts a live catalog workspace with waveform cards and audio facts', async () => {
  const { mount } = await import(`../ui/workspace.js?test=${Date.now()}`);
  const container = document.getElementById('app');

  await mount(container, { sigma: createSigma(), toolbarContainer: {} });

  assert.equal(container.querySelectorAll('.ul-asset-card').length, 2);
  assert.equal(container.querySelectorAll('.ul-waveform').length, 1);
  assert.equal(container.querySelector('[data-stat="roots"]').textContent, '2');
  assert.equal(container.querySelector('[data-stat="collections"]').textContent, '1');
  assert.match(container.querySelector('[data-role="collections"]').textContent, /Album 03/);
  assert.match(container.querySelector('[data-role="tags"]').textContent, /#dark/);
  assert.match(container.querySelector('[data-role="inspector"]').textContent, /dusty_kick.wav/);
  assert.match(container.querySelector('[data-role="inspector"]').textContent, /44.1 kHz/);
  assert.match(container.querySelector('[data-role="inspector"]').textContent, /0:12/);
  assert.equal(typeof toolbarHandler, 'function');
});

test('copies the selected online asset to the native file clipboard', async () => {
  const { mount } = await import(`../ui/workspace.js?copy=${Date.now()}`);
  const container = document.getElementById('app');
  await mount(container, { sigma: createSigma(), toolbarContainer: {} });

  container.querySelector('[data-action="copy-asset"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(clipboardWrites, [{
    paths: ['/library/dusty_kick.wav'],
    operation: 'copy',
  }]);
  assert.equal(notifications.at(-1).type, 'success');
});

test('loads ordered collection contents and keeps matching waveforms', async () => {
  const { mount } = await import(`../ui/workspace.js?collection=${Date.now()}`);
  const container = document.getElementById('app');
  await mount(container, { sigma: createSigma(), toolbarContainer: {} });

  container.querySelector('[data-collection="collection-1"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(container.querySelectorAll('.ul-asset-card').length, 1);
  assert.equal(container.querySelectorAll('.ul-waveform').length, 1);
  assert.match(container.querySelector('[data-role="content"]').textContent, /dusty_kick.wav/);
  assert.ok(commandCalls.some(call => call.request.action === 'collection-items'));
});

test('analyzes selected audio and reloads its waveform', async () => {
  const { mount } = await import(`../ui/workspace.js?analyze=${Date.now()}`);
  const container = document.getElementById('app');
  await mount(container, { sigma: createSigma(), toolbarContainer: {} });

  container.querySelector('[data-action="analyze-audio"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(commandCalls.some(call => (
    call.request?.action === 'analyze-audio'
    && call.request.asset === '/library/dusty_kick.wav'
  )));
  assert.equal(notifications.at(-1).type, 'success');
});

test('uses toolbar actions for indexing, bounded audio analysis, and catalog status', async () => {
  const sigma = createSigma();
  const { mount } = await import(`../ui/workspace.js?toolbar=${Date.now()}`);
  await mount(document.getElementById('app'), { sigma, toolbarContainer: {} });

  await toolbarHandler('index');
  await toolbarHandler('analyze-audio');
  await toolbarHandler('configure');

  assert.ok(commandCalls.some(call => call.commandId === 'scan-roots'));
  assert.ok(commandCalls.some(call => call.request?.action === 'analyze-missing-audio'));
  assert.ok(commandCalls.some(call => call.commandId === 'catalog-health'));
  assert.equal(notifications.at(-1).type, 'success');
});
