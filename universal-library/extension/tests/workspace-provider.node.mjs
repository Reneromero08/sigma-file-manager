import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const settings = new Map([['catalog.executablePath', '/opt/ulib']]);
const calls = [];
let responder = () => ({ ok: true, data: {} });

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
  dialog: {
    async openFile() {
      return null;
    },
    async saveFile() {
      return null;
    },
  },
  shell: {
    async run(commandPath, args) {
      calls.push({ commandPath, args });
      const payload = responder(args);
      return payload.ok === false
        ? { code: 1, stdout: '', stderr: JSON.stringify(payload) }
        : { code: 0, stdout: JSON.stringify(payload), stderr: '' };
    },
    async runWithProgress() {
      throw new Error('not used');
    },
  },
};

const { handleWorkspaceRequest } = await import('../src/workspace-provider.js');

beforeEach(() => {
  calls.length = 0;
  responder = () => ({ ok: true, data: {} });
});

test('builds a complete workspace snapshot with bounded asset and audio queries', async () => {
  responder = (args) => {
    const command = args.join(' ');
    if (command === 'health') return { ok: true, data: { status: 'ok', rootCount: 2 } };
    if (command.startsWith('asset list')) return { ok: true, data: [{ id: 'asset-1' }] };
    if (command === 'collection list') return { ok: true, data: [{ id: 'collection-1' }] };
    if (command === 'tag list') return { ok: true, data: [{ id: 'tag-1' }] };
    if (command === 'audio list --limit 10000') {
      return { ok: true, data: [{ assetId: 'asset-1', durationMs: 1000, waveformPoints: [0.2, 0.8] }] };
    }
    throw new Error(`unexpected command: ${command}`);
  };

  const snapshot = await handleWorkspaceRequest({
    action: 'snapshot',
    query: 'kick',
    kind: 'audio',
    includeOffline: true,
    limit: 5000,
  });

  assert.equal(snapshot.health.rootCount, 2);
  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.collections.length, 1);
  assert.equal(snapshot.tags.length, 1);
  assert.equal(snapshot.audioAnalyses.length, 1);
  assert.equal(typeof snapshot.generatedAt, 'number');
  assert.ok(calls.some(call => call.args.join(' ') === 'asset list --limit 1000 --query kick --kind audio --include-offline'));
  assert.ok(calls.some(call => call.args.join(' ') === 'audio list --limit 10000'));
});

test('keeps snapshots usable with an older custom catalog binary', async () => {
  responder = (args) => {
    const command = args.join(' ');
    if (command === 'health') return { ok: true, data: { status: 'ok' } };
    if (command === 'asset list --limit 300') return { ok: true, data: [] };
    if (command === 'collection list' || command === 'tag list') return { ok: true, data: [] };
    if (command === 'audio list --limit 10000') {
      return { ok: false, error: { message: 'unrecognized subcommand audio' } };
    }
    throw new Error(`unexpected command: ${command}`);
  };

  const snapshot = await handleWorkspaceRequest({ action: 'snapshot' });
  assert.deepEqual(snapshot.audioAnalyses, []);
});

test('loads ordered collection items', async () => {
  responder = (args) => {
    assert.deepEqual(args, ['collection', 'items', 'collection-1']);
    return { ok: true, data: [{ assetId: 'asset-1', position: 10 }] };
  };

  const items = await handleWorkspaceRequest({
    action: 'collection-items',
    collection: 'collection-1',
  });

  assert.deepEqual(items, [{ assetId: 'asset-1', position: 10 }]);
});

test('tags an asset using an idempotent tag create then assignment', async () => {
  responder = () => ({ ok: true, data: {} });

  await handleWorkspaceRequest({
    action: 'tag-asset',
    asset: '/library/kick.wav',
    tag: 'dark',
  });

  assert.deepEqual(calls.map(call => call.args), [
    ['tag', 'create', 'dark'],
    ['tag', 'add', '/library/kick.wav', 'dark'],
  ]);
});

test('adds assets to collections and creates collections without source file operations', async () => {
  responder = () => ({ ok: true, data: {} });

  await handleWorkspaceRequest({
    action: 'add-to-collection',
    asset: '/library/cover.psd',
    collection: 'collection-1',
  });
  await handleWorkspaceRequest({ action: 'create-collection', name: 'Album 03' });

  assert.deepEqual(calls.map(call => call.args), [
    ['collection', 'add', 'collection-1', '/library/cover.psd'],
    ['collection', 'create', 'Album 03'],
  ]);
});

test('analyzes one audio asset and bounded missing-audio batches', async () => {
  responder = () => ({ ok: true, data: { analyzed: 1 } });

  await handleWorkspaceRequest({
    action: 'analyze-audio',
    asset: '/library/kick.wav',
    points: 99999,
  });
  await handleWorkspaceRequest({
    action: 'analyze-missing-audio',
    limit: 99999,
    points: 8,
  });

  assert.deepEqual(calls.map(call => call.args), [
    ['audio', 'analyze', '/library/kick.wav', '--points', '2048'],
    ['audio', 'analyze-missing', '--limit', '10000', '--points', '32'],
  ]);
});

test('rejects incomplete and unknown workspace actions', async () => {
  await assert.rejects(
    handleWorkspaceRequest({ action: 'tag-asset', asset: '/library/kick.wav', tag: ' ' }),
    /Tag name is required/,
  );
  await assert.rejects(
    handleWorkspaceRequest({ action: 'analyze-audio', asset: ' ' }),
    /Audio asset is required/,
  );
  await assert.rejects(
    handleWorkspaceRequest({ action: 'destroy-everything' }),
    /Unknown Universal Library workspace action/,
  );
});
