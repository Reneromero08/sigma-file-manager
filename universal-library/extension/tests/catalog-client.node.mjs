import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const settings = new Map();
let managedExecutablePath = null;
let requestedBinaryId = null;
let openFileSelection = null;
let saveFileSelection = null;
let lastRun = null;
let lastProgressRun = null;
let runResult = {
  code: 0,
  stdout: JSON.stringify({ ok: true, data: { status: 'ok' } }),
  stderr: '',
};

globalThis.sigma = {
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
  binary: {
    async getPath(id) {
      requestedBinaryId = id;
      return managedExecutablePath;
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
      lastRun = { commandPath, args };
      return runResult;
    },
    async runWithProgress(commandPath, args, onProgress) {
      lastProgressRun = { commandPath, args };
      onProgress?.({ taskId: 'task-1', line: 'working', isStderr: false });
      return {
        taskId: 'task-1',
        cancel: async () => {},
        result: Promise.resolve(runResult),
      };
    },
  },
};

const client = await import('../src/catalog-client.js');

beforeEach(() => {
  settings.clear();
  managedExecutablePath = null;
  requestedBinaryId = null;
  openFileSelection = null;
  saveFileSelection = null;
  lastRun = null;
  lastProgressRun = null;
  runResult = {
    code: 0,
    stdout: JSON.stringify({ ok: true, data: { status: 'ok' } }),
    stderr: '',
  };
});

test('reports custom, managed, and database configuration explicitly', async () => {
  managedExecutablePath = '/managed/ulib';
  openFileSelection = '/home/raul/bin/ulib';
  saveFileSelection = '/home/raul/.local/share/universal-library/catalog.sqlite3';

  assert.equal(await client.configureCatalogExecutable(), openFileSelection);
  assert.equal(await client.configureCatalogDatabase(), saveFileSelection);
  assert.deepEqual(await client.getCatalogConfiguration(), {
    executablePath: openFileSelection,
    executableSource: 'custom',
    configuredExecutablePath: openFileSelection,
    managedExecutablePath,
    databasePath: saveFileSelection,
  });
  assert.equal(requestedBinaryId, client.CATALOG_BINARY_ID);

  await client.clearCatalogDatabaseOverride();
  assert.equal((await client.getCatalogConfiguration()).databasePath, null);
});

test('uses the Sigma-managed binary automatically when no custom override exists', async () => {
  managedExecutablePath = '/managed/bin/ulib';

  const data = await client.runCatalog(['health']);

  assert.deepEqual(data, { status: 'ok' });
  assert.deepEqual(lastRun, {
    commandPath: managedExecutablePath,
    args: ['health'],
  });
  assert.equal(openFileSelection, null);
  assert.deepEqual(await client.getCatalogConfiguration(), {
    executablePath: managedExecutablePath,
    executableSource: 'managed',
    configuredExecutablePath: null,
    managedExecutablePath,
    databasePath: null,
  });
});

test('custom executable override wins over the managed binary', async () => {
  managedExecutablePath = '/managed/bin/ulib';
  settings.set(client.EXECUTABLE_SETTING, '/custom/ulib');
  settings.set(client.DATABASE_SETTING, '/state/catalog.sqlite3');
  runResult = {
    code: 0,
    stdout: '{\n  "ok": true,\n  "data": {"rootCount": 3}\n}\n',
    stderr: '',
  };

  const data = await client.runCatalog(['health']);
  assert.deepEqual(data, { rootCount: 3 });
  assert.deepEqual(lastRun, {
    commandPath: '/custom/ulib',
    args: ['--database', '/state/catalog.sqlite3', 'health'],
  });
});

test('clearing the custom override returns to the managed binary', async () => {
  managedExecutablePath = '/managed/bin/ulib';
  settings.set(client.EXECUTABLE_SETTING, '/custom/ulib');

  assert.equal(await client.clearCatalogExecutableOverride(), managedExecutablePath);
  assert.equal(settings.has(client.EXECUTABLE_SETTING), false);
  assert.equal(await client.resolveCatalogExecutable({ promptForExecutable: false }), managedExecutablePath);
});

test('prompts for a custom executable only when no managed binary exists', async () => {
  openFileSelection = '/usr/local/bin/ulib';

  await client.runCatalog(['health']);

  assert.equal(settings.get(client.EXECUTABLE_SETTING), openFileSelection);
  assert.equal(lastRun.commandPath, openFileSelection);
});

test('fails clearly when neither managed nor custom executable is available', async () => {
  await assert.rejects(
    client.resolveCatalogExecutable({ promptForExecutable: false }),
    /managed catalog or choose a custom executable/,
  );
});

test('returns cancellable progress tasks and parses their final envelope', async () => {
  managedExecutablePath = '/managed/bin/ulib';
  const progressLines = [];
  runResult = {
    code: 0,
    stdout: JSON.stringify({ ok: true, data: { filesSeen: 42 } }),
    stderr: '',
  };

  const task = await client.startCatalog(
    ['root', 'scan', '/library'],
    { onProgress: payload => progressLines.push(payload.line) },
  );

  assert.equal(task.taskId, 'task-1');
  assert.deepEqual(await task.result, { filesSeen: 42 });
  assert.deepEqual(progressLines, ['working']);
  assert.deepEqual(lastProgressRun, {
    commandPath: managedExecutablePath,
    args: ['root', 'scan', '/library'],
  });
});

test('surfaces structured catalog errors', () => {
  assert.throws(
    () => client.parseCatalogResult({
      code: 2,
      stdout: '',
      stderr: JSON.stringify({ ok: false, error: { message: 'unknown asset' } }),
    }),
    /unknown asset/,
  );
});

test('rejects invalid successful output instead of guessing', () => {
  assert.throws(
    () => client.parseCatalogResult({ code: 0, stdout: 'not json', stderr: '' }),
    /invalid JSON response/,
  );
});
