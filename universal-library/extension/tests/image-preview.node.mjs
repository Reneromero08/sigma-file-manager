import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createImagePreviewLoader,
  isPreviewableImage,
} from '../ui/image-preview.js';

function asset(id, path, mediaKind = 'image', isOnline = true) {
  return {
    id,
    primaryPath: path,
    mediaKind,
    isOnline,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('recognizes browser-previewable online raster images', () => {
  assert.equal(isPreviewableImage(asset('one', '/library/poster.PNG')), true);
  assert.equal(isPreviewableImage(asset('two', 'C:\\images\\cover.webp')), true);
  assert.equal(isPreviewableImage(asset('three', '/library/design.psd', 'design')), false);
  assert.equal(isPreviewableImage(asset('four', '/library/photo.tiff')), false);
  assert.equal(isPreviewableImage(asset('five', '/library/offline.jpg', 'image', false)), false);
});

test('bounds concurrent URL resolution and drains the queue', async () => {
  const pending = new Map();
  let active = 0;
  let maximumActive = 0;
  const loader = createImagePreviewLoader({
    concurrency: 2,
    resolveUrl(value) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const task = deferred();
      pending.set(value.id, task);
      return task.promise.finally(() => {
        active -= 1;
      });
    },
  });

  const requests = [
    loader.request(asset('one', '/one.jpg')),
    loader.request(asset('two', '/two.jpg')),
    loader.request(asset('three', '/three.jpg')),
  ];
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(maximumActive, 2);
  assert.equal(pending.has('three'), false);

  pending.get('one').resolve('asset://localhost/one.jpg');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pending.has('three'), true);
  pending.get('two').resolve('asset://localhost/two.jpg');
  pending.get('three').resolve('asset://localhost/three.jpg');

  assert.deepEqual(await Promise.all(requests), [
    'asset://localhost/one.jpg',
    'asset://localhost/two.jpg',
    'asset://localhost/three.jpg',
  ]);
  assert.equal(maximumActive, 2);
  loader.dispose();
});

test('caches identical asset and path requests', async () => {
  let calls = 0;
  const loader = createImagePreviewLoader({
    async resolveUrl(value) {
      calls += 1;
      return `asset://localhost${value.primaryPath}`;
    },
  });
  const value = asset('same', '/same.png');
  const first = loader.request(value);
  const second = loader.request(value);
  assert.equal(first, second);
  assert.equal(await first, 'asset://localhost/same.png');
  assert.equal(calls, 1);
  loader.dispose();
});

test('evicts failed requests so a later retry can succeed', async () => {
  let calls = 0;
  const loader = createImagePreviewLoader({
    async resolveUrl() {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
      return 'asset://localhost/retry.jpg';
    },
  });
  const value = asset('retry', '/retry.jpg');
  await assert.rejects(loader.request(value), /temporary failure/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await loader.request(value), 'asset://localhost/retry.jpg');
  assert.equal(calls, 2);
  loader.dispose();
});

test('returns null for unsupported assets without resolving a URL', async () => {
  let calls = 0;
  const loader = createImagePreviewLoader({
    async resolveUrl() {
      calls += 1;
      return 'unexpected';
    },
  });
  assert.equal(await loader.request(asset('psd', '/cover.psd', 'design')), null);
  assert.equal(calls, 0);
  loader.dispose();
});

test('rejects queued work after disposal', async () => {
  const first = deferred();
  const loader = createImagePreviewLoader({
    concurrency: 1,
    resolveUrl(value) {
      if (value.id === 'one') return first.promise;
      return Promise.resolve('asset://localhost/two.jpg');
    },
  });
  const running = loader.request(asset('one', '/one.jpg'));
  const queued = loader.request(asset('two', '/two.jpg'));
  loader.dispose();
  await assert.rejects(queued, /disposed/);
  first.resolve('asset://localhost/one.jpg');
  assert.equal(await running, 'asset://localhost/one.jpg');
});
