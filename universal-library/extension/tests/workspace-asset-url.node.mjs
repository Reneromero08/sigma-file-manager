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
      throw new Error('catalog execution is not used for asset URLs');
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

const { handleWorkspaceRequest } = await import(`../src/workspace-provider.js?asset-url=${Date.now()}`);

test('returns a scoped URL for an approved visual asset', async () => {
  const result = await handleWorkspaceRequest({
    action: 'asset-url',
    path: '/library/poster.webp',
  });
  assert.deepEqual(result, {
    path: '/library/poster.webp',
    url: 'asset://localhost/library/poster.webp',
  });
  assert.deepEqual(requestedPaths, ['/library/poster.webp']);
});

test('propagates scoped access rejection for visual assets', async () => {
  await assert.rejects(
    handleWorkspaceRequest({ action: 'asset-url', path: '/private/poster.png' }),
    /not in scoped directories/,
  );
});

test('rejects empty asset paths before requesting a URL', async () => {
  const before = requestedPaths.length;
  await assert.rejects(
    handleWorkspaceRequest({ action: 'asset-url', path: ' ' }),
    /Asset path is required/,
  );
  assert.equal(requestedPaths.length, before);
});
