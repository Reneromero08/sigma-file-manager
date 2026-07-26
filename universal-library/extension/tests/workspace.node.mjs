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
        assert.equal(commandId, 'browse-assets');
        if (request.action === 'snapshot') return snapshot();
        if (request.action === 'collection-items') {
          return [{
            assetId: 'asset-3',
            canonicalName: 'album_master.als',
            mediaKind: 'project',
            primaryPath: '/library/album_master.als',
            position: 10,
          }];
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

test('mounts a live catalog workspace with assets, stats, collections, and tags', async () => {
  const { mount } = await import(`../ui/workspace.js?test=${Date.now()}`);
  const container = document.getElementById('app');

  await mount(container, { sigma: createSigma(), toolbarContainer: {} });

  assert.equal(container.querySelectorAll('.ul-asset-card').length, 2);
  assert.equal(container.querySelector('[data-stat="roots"]').textContent, '2');
  assert.equal(container.querySelector('[data-stat="collections"]').textContent, '1');
  assert.match(container.querySelector('[data-role="collections"]').textContent, /Album 03/);
  assert.match(container.querySelector('[data-role="tags"]').textContent, /#dark/);
  assert.match(container.querySelector('[data-role="inspector"]').textContent, /dusty_kick.wav/);
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

test('loads ordered collection contents from the catalog provider', async () => {
  const { mount } = await import(`../ui/workspace.js?collection=${Date.now()}`);
  const container = document.getElementById('app');
  await mount(container, { sigma: createSigma(), toolbarContainer: {} });

  container.querySelector('[data-collection="collection-1"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(container.querySelectorAll('.ul-asset-card').length, 1);
  assert.match(container.querySelector('[data-role="content"]').textContent, /album_master.als/);
  assert.ok(commandCalls.some(call => call.request.action === 'collection-items'));
});

test('uses the existing command palette actions for refresh, indexing, and configuration', async () => {
  const sigma = createSigma();
  const originalExecute = sigma.commands.executeCommand;
  sigma.commands.executeCommand = async (commandId, request) => {
    commandCalls.push({ commandId, request });
    if (commandId === 'browse-assets') return snapshot();
    return originalExecute(commandId, request);
  };
  const { mount } = await import(`../ui/workspace.js?toolbar=${Date.now()}`);
  await mount(document.getElementById('app'), { sigma, toolbarContainer: {} });

  await toolbarHandler('index');
  await toolbarHandler('configure');

  assert.ok(commandCalls.some(call => call.commandId === 'scan-roots'));
  assert.ok(commandCalls.some(call => call.commandId === 'configure-catalog'));
});
