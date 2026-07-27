import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.src = '';
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1;
    this.paused = true;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  pause() {
    this.paused = true;
  }

  load() {}

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
}

let dom;
let assetUrlCalls;

function createSnapshot() {
  return {
    health: {
      status: 'ok',
      schemaVersion: 1,
      rootCount: 1,
      collectionCount: 0,
    },
    assets: [
      {
        id: 'image-1',
        canonicalName: 'poster.webp',
        mediaKind: 'image',
        primaryPath: '/library/poster.webp',
        isOnline: true,
        sizeBytes: 4096,
        modifiedAtNs: 1_700_000_000_000_000_000,
      },
      {
        id: 'image-2',
        canonicalName: 'scan.tiff',
        mediaKind: 'image',
        primaryPath: '/library/scan.tiff',
        isOnline: true,
        sizeBytes: 8192,
        modifiedAtNs: 1_700_000_000_000_000_000,
      },
    ],
    audioAnalyses: [],
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
        assert.equal(commandId, 'browse-assets');
        if (request.action === 'snapshot') return createSnapshot();
        if (request.action === 'asset-url') {
          assetUrlCalls.push(request.path);
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
  assetUrlCalls = [];
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

test('loads one cached scoped URL into card and inspector previews', async () => {
  const { mount } = await import(`../ui/workspace.js?image-preview=${Date.now()}`);
  const container = document.getElementById('app');
  const mounted = await mount(container, {
    sigma: createSigma(),
    toolbarContainer: {},
    audioFactory: () => new FakeAudio(),
  });
  await tick();

  const cardImage = container.querySelector('.ul-image-preview');
  const inspectorImage = container.querySelector('.ul-inspector-image');
  assert.ok(cardImage);
  assert.ok(inspectorImage);
  assert.equal(cardImage.src, 'asset://localhost/library/poster.webp');
  assert.equal(inspectorImage.src, 'asset://localhost/library/poster.webp');
  assert.deepEqual(assetUrlCalls, ['/library/poster.webp']);

  cardImage.dispatchEvent(new Event('load'));
  inspectorImage.dispatchEvent(new Event('load'));
  assert.equal(cardImage.classList.contains('is-loaded'), true);
  assert.equal(inspectorImage.classList.contains('is-loaded'), true);

  const cards = container.querySelectorAll('.ul-asset-card');
  assert.equal(cards.length, 2);
  assert.equal(cards[1].querySelector('.ul-image-preview'), null);
  assert.ok(cards[1].querySelector('.ul-kind-glyph'));

  mounted.dispose();
});
