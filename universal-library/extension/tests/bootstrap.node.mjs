import assert from 'node:assert/strict';
import test from 'node:test';

const stored = new Map();
const commands = new Map();
const contextMenus = new Map();
const pages = [];
const notifications = [];
const dialogs = [];
const clipboardWrites = [];
let requestedDirectory = {
  granted: true,
  path: '/home/raul/Samples',
  permissions: ['read'],
};
let selectedEntries = [];

function disposable() {
  return { dispose() {} };
}

globalThis.sigma = {
  i18n: {
    async mergeFromPath() {},
    extensionT(_key, _params, fallback) {
      return fallback;
    },
  },
  platform: {
    pathSeparator: '/',
    joinPath: (...segments) => segments.join('/'),
  },
  path: {
    basename: path => path.split('/').filter(Boolean).at(-1) ?? '',
  },
  storage: {
    async get(key) {
      return stored.get(key);
    },
    async set(key, value) {
      stored.set(key, structuredClone(value));
    },
  },
  fs: {
    scoped: {
      async requestDirectoryAccess() {
        return requestedDirectory;
      },
      async getDirectories() {
        return [...(stored.get('library-roots') ?? [])].map(root => ({
          path: root.path,
          permissions: ['read'],
          grantedAt: root.addedAt,
        }));
      },
    },
  },
  ui: {
    showNotification(notification) {
      notifications.push(notification);
    },
    async showDialog(dialog) {
      dialogs.push(dialog);
      return { confirmed: true };
    },
    async clipboardWriteFiles(paths, operation) {
      clipboardWrites.push({ paths, operation });
    },
    async showModal() {
      return null;
    },
    alert(options) {
      return { type: 'alert', ...options };
    },
    checkbox(options) {
      return { type: 'checkbox', ...options };
    },
    select(options) {
      return { type: 'select', ...options };
    },
  },
  context: {
    getSelectedEntries() {
      return selectedEntries;
    },
  },
  sidebar: {
    registerPage(page) {
      pages.push(page);
      return disposable();
    },
  },
  commands: {
    registerCommand(command, handler) {
      commands.set(command.id, { command, handler });
      return disposable();
    },
  },
  contextMenu: {
    registerItem(item, handler) {
      contextMenus.set(item.id, { item, handler });
      return disposable();
    },
  },
};

const extension = await import('../src/index.js');

await test('activation registers the live workspace and managed catalog bridge without filesystem write access', async () => {
  await extension.activate();

  assert.equal(stored.get('catalog-schema-version'), 1);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'ui/workspace.js');
  assert.deepEqual(
    [...commands.keys()].sort(),
    [
      'add-root',
      'add-selected',
      'add-selected-to-collection',
      'auto-refresh-status',
      'browse-assets',
      'catalog-health',
      'configure-auto-refresh',
      'configure-catalog',
      'configure-database',
      'copy-selected',
      'run-auto-refresh-now',
      'scan-roots',
      'show-roots',
      'tag-selected',
      'use-default-database',
      'use-managed-catalog',
    ],
  );
  assert.deepEqual(
    [...contextMenus.keys()].sort(),
    ['add-selected', 'add-selected-to-collection', 'tag-selected'],
  );
});

await test('adding a root is read-only and idempotent', async () => {
  await commands.get('add-root').handler();
  await commands.get('add-root').handler();

  const roots = stored.get('library-roots');
  assert.equal(roots.length, 1);
  assert.equal(roots[0].path, '/home/raul/Samples');
  assert.deepEqual(roots[0].permissions, ['read']);
  assert.equal(notifications.at(-1).type, 'info');
});

await test('selected entries are recorded without duplicate paths', async () => {
  selectedEntries = [
    {
      path: '/home/raul/Samples/kick.wav',
      name: 'kick.wav',
      isDirectory: false,
      extension: 'wav',
      size: 1024,
      createdAt: 10,
      modifiedAt: 20,
    },
  ];

  await commands.get('add-selected').handler();
  await commands.get('add-selected').handler();

  const entries = stored.get('seed-entries');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, '/home/raul/Samples/kick.wav');
  assert.equal(entries[0].extension, 'wav');
});

await test('copy selected uses the native file clipboard', async () => {
  await commands.get('copy-selected').handler();

  assert.deepEqual(clipboardWrites.at(-1), {
    paths: ['/home/raul/Samples/kick.wav'],
    operation: 'copy',
  });
});

await test('context menu forwards the concrete Sigma selection', async () => {
  const handler = contextMenus.get('add-selected').handler;
  await handler({
    selectedEntries: [
      {
        path: '/home/raul/Design/cover.psd',
        name: 'cover.psd',
        isDirectory: false,
        extension: 'psd',
        size: 2048,
      },
    ],
  });

  const paths = stored.get('seed-entries').map(entry => entry.path);
  assert.deepEqual(paths.sort(), [
    '/home/raul/Design/cover.psd',
    '/home/raul/Samples/kick.wav',
  ]);
});

await test('show roots emits a readable dialog', async () => {
  await commands.get('show-roots').handler();
  assert.match(dialogs.at(-1).message, /Samples/);
  assert.match(dialogs.at(-1).message, /granted/);
});

await test('deactivation disposes registrations safely', () => {
  assert.doesNotThrow(() => extension.deactivate());
});
