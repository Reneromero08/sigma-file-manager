import assert from 'node:assert/strict';
import test from 'node:test';

const requestedPaths = [];

globalThis.sigma = {
  settings: {
    async get() {
      return '/opt/ulib';
    },
    async set() {},
    async reset() {},
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
    async run() {
      throw new Error('catalog execution is not used for audio URLs');
    },
    async runWithProgress() {
      throw new Error('not used');
    },
  },
  fs: {
    scoped: {
      async toAssetUrl(path) {
        requestedPaths.push(path);
        if (path.startsWith('/private/')) {
          throw new Error(`Access denied: ${path} is not in scoped directories`);
        }
        return `asset://localhost${path}`;
      },
    },
  },
};

const { handleWorkspaceRequest } = await import('../src/workspace-provider.js');

test('returns a streamable URL only through the scoped filesystem API', async () => {
  const result = await handleWorkspaceRequest({
    action: 'audio-url',
    path: '/library/kick.wav',
  });

  assert.deepEqual(result, {
    path: '/library/kick.wav',
    url: 'asset://localhost/library/kick.wav',
  });
  assert.deepEqual(requestedPaths, ['/library/kick.wav']);
});

test('propagates scoped authorization failures', async () => {
  await assert.rejects(
    handleWorkspaceRequest({ action: 'audio-url', path: '/private/secret.wav' }),
    /not in scoped directories/,
  );
});

test('rejects empty audio paths before requesting a URL', async () => {
  const before = requestedPaths.length;
  await assert.rejects(
    handleWorkspaceRequest({ action: 'audio-url', path: ' ' }),
    /Audio path is required/,
  );
  assert.equal(requestedPaths.length, before);
});
