import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const settings = new Map();
const storage = new Map();
const notifications = [];
const clipboardWrites = [];
const shellCalls = [];
const progressReports = [];
let selectedEntries = [];
let openFileSelection = null;
let saveFileSelection = null;
let dialogResponse = { confirmed: false };
let modalResponse = null;
let commandResponder = () => ({ ok: true, data: {} });
let modalHarness = null;

function disposable() {
  return { dispose() {} };
}

function shellResult(payload, code = 0) {
  return code === 0
    ? { code, stdout: JSON.stringify(payload), stderr: '' }
    : { code, stdout: '', stderr: JSON.stringify(payload) };
}

function formatMessage(template, params = {}) {
  return Object.entries(params).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

globalThis.sigma = {
  i18n: {
    extensionT(_key, params, fallback) {
      return formatMessage(fallback, params);
    },
  },
  settings: {
    async get(key) {
      return settings.get(key);
    },
    async set(key, value) {
      settings.set(key, value);
    },
    async reset(key) {
      settings.delete(key);
    },
  },
  storage: {
    async get(key) {
      return storage.get(key);
    },
  },
  dialog: {
    async openFile() {
      return openFileSelection;
    },
    async saveFile() {
      return saveFileSelection;
    },
  },
  shell: {
    async run(commandPath, args) {
      shellCalls.push({ mode: 'run', commandPath, args });
      const payload = commandResponder(args);
      return shellResult(payload, payload.ok === false ? 1 : 0);
    },
    async runWithProgress(commandPath, args, onProgress) {
      shellCalls.push({ mode: 'progress', commandPath, args });
      onProgress?.({ taskId: 'scan-task', line: 'scan', isStderr: false });
      const payload = commandResponder(args);
      return {
        taskId: 'scan-task',
        cancel: async () => {},
        result: Promise.resolve(shellResult(payload, payload.ok === false ? 1 : 0)),
      };
    },
  },
  context: {
    getSelectedEntries() {
      return selectedEntries;
    },
  },
  path: {
    basename(path) {
      return path.split('/').filter(Boolean).at(-1) ?? '';
    },
  },
  ui: {
    showNotification(value) {
      notifications.push(value);
    },
    async showDialog() {
      return dialogResponse;
    },
    async showModal() {
      return modalResponse;
    },
    select(options) {
      return { type: 'select', ...options };
    },
    async clipboardWriteFiles(paths, operation) {
      clipboardWrites.push({ paths, operation });
    },
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return disposable();
        },
      };
      return task({ report: value => progressReports.push(value) }, token);
    },
    createModal(options) {
      const callbacks = {};
      const harness = {
        options,
        callbacks,
        closed: false,
        state: structuredClone(options.listDetail),
      };
      modalHarness = harness;
      return {
        onSubmit(callback) {
          callbacks.submit = callback;
        },
        onClose(callback) {
          callbacks.close = callback;
        },
        onValueChange(callback) {
          callbacks.value = callback;
        },
        onSelectionChange(callback) {
          callbacks.selection = callback;
        },
        onSearchChange(callback) {
          callbacks.search = callback;
        },
        onFilterChange(callback) {
          callbacks.filter = callback;
        },
        close() {
          harness.closed = true;
        },
        updateElement() {},
        setContent() {},
        setButtons() {},
        async setListDetail(updates) {
          harness.state = { ...harness.state, ...structuredClone(updates) };
        },
        getListDetail() {
          return harness.state;
        },
        getValues() {
          return {};
        },
      };
    },
  },
};

const client = await import('../src/catalog-client.js');
const bridge = await import('../src/catalog-bridge.js');

beforeEach(() => {
  settings.clear();
  settings.set(client.EXECUTABLE_SETTING, '/opt/ulib');
  storage.clear();
  notifications.length = 0;
  clipboardWrites.length = 0;
  shellCalls.length = 0;
  progressReports.length = 0;
  selectedEntries = [];
  openFileSelection = null;
  saveFileSelection = null;
  dialogResponse = { confirmed: false };
  modalResponse = null;
  modalHarness = null;
  commandResponder = () => ({ ok: true, data: {} });
});

test('configures the executable and verifies catalog health', async () => {
  settings.clear();
  openFileSelection = '/home/raul/bin/ulib';
  commandResponder = (args) => {
    assert.deepEqual(args, ['health']);
    return {
      ok: true,
      data: {
        status: 'ok',
        schemaVersion: 1,
        databasePath: '/state/catalog.sqlite3',
      },
    };
  };

  await bridge.configureCatalog();

  assert.equal(settings.get(client.EXECUTABLE_SETTING), openFileSelection);
  assert.equal(notifications.at(-1).type, 'success');
  assert.match(notifications.at(-1).description, /Schema 1/);
});

test('registers and scans every read-only root with progress', async () => {
  storage.set('library-roots', [
    { path: '/library/Samples', displayName: 'Samples' },
    { path: '/library/Design', displayName: 'Design' },
  ]);
  commandResponder = (args) => {
    if (args[0] === 'root' && args[1] === 'scan') {
      return {
        ok: true,
        data: { filesSeen: args[2].includes('Samples') ? 20 : 5, issueCount: 0 },
      };
    }
    return { ok: true, data: { id: 'root' } };
  };

  await bridge.scanLibraryRoots();

  assert.deepEqual(
    shellCalls.map(call => call.args.slice(0, 2)),
    [
      ['root', 'add'],
      ['root', 'scan'],
      ['root', 'add'],
      ['root', 'scan'],
    ],
  );
  assert.equal(progressReports.at(-1).value, 100);
  assert.match(notifications.at(-1).description, /25 file/);
  assert.equal(notifications.at(-1).type, 'success');
});

test('renders indexed assets in a native list-detail modal and copies the selected file', async () => {
  commandResponder = (args) => {
    assert.deepEqual(args, ['asset', 'list', '--limit', '200']);
    return {
      ok: true,
      data: [
        {
          id: 'asset-1',
          canonicalName: 'dusty_kick.wav',
          mediaKind: 'audio',
          sizeBytes: 2048,
          isOnline: true,
          primaryPath: '/library/dusty_kick.wav',
        },
        {
          id: 'asset-2',
          canonicalName: 'cover.psd',
          mediaKind: 'design',
          sizeBytes: 4096,
          isOnline: false,
          primaryPath: null,
        },
      ],
    };
  };

  await bridge.showCatalogBrowser();

  assert.equal(modalHarness.state.items.length, 2);
  assert.equal(modalHarness.state.selectedItemId, 'asset-1');
  assert.deepEqual(modalHarness.state.detail.filePaths, ['/library/dusty_kick.wav']);

  await modalHarness.callbacks.submit({}, 'copy');
  assert.deepEqual(clipboardWrites.at(-1), {
    paths: ['/library/dusty_kick.wav'],
    operation: 'copy',
  });
});

test('creates and assigns a tag to every selected indexed file', async () => {
  selectedEntries = [
    { path: '/library/kick.wav', name: 'kick.wav', isDirectory: false },
    { path: '/library/cover.psd', name: 'cover.psd', isDirectory: false },
  ];
  dialogResponse = { confirmed: true, value: 'dark' };
  commandResponder = () => ({ ok: true, data: {} });

  await bridge.tagSelectedEntries();

  assert.deepEqual(
    shellCalls.map(call => call.args),
    [
      ['tag', 'create', 'dark'],
      ['tag', 'add', '/library/kick.wav', 'dark'],
      ['tag', 'add', '/library/cover.psd', 'dark'],
    ],
  );
  assert.equal(notifications.at(-1).type, 'success');
});

test('adds selected files to the chosen playlist collection', async () => {
  selectedEntries = [
    { path: '/library/kick.wav', name: 'kick.wav', isDirectory: false },
  ];
  modalResponse = { collection: 'collection-1' };
  commandResponder = (args) => {
    if (args[0] === 'collection' && args[1] === 'list') {
      return {
        ok: true,
        data: [{ id: 'collection-1', name: 'Album 03' }],
      };
    }
    return { ok: true, data: {} };
  };

  await bridge.addSelectedEntriesToCollection();

  assert.deepEqual(shellCalls.map(call => call.args), [
    ['collection', 'list'],
    ['collection', 'add', 'collection-1', '/library/kick.wav'],
  ]);
  assert.match(notifications.at(-1).description, /Album 03/);
});
