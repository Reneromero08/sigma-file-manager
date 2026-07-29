// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import {
  effectScope,
  nextTick,
  ref,
} from 'vue';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { useMediaStreamUrl } from '@/composables/use-media-stream-url';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return {
    promise,
    resolve,
  };
}

describe('useMediaStreamUrl', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('creates and releases local media leases as the path changes', async () => {
    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'create_media_stream_url') {
        const suffix = args?.path?.endsWith('first.mp4') ? 'first' : 'second';

        return {
          url: `http://127.0.0.1:45678/media/${suffix}`,
          token: suffix,
        };
      }

      return true;
    });

    const path = ref('/fixture/first.mp4');
    const scope = effectScope();
    const stream = scope.run(() => useMediaStreamUrl(path));

    await vi.waitFor(() => {
      expect(stream?.mediaStreamUrl.value).toContain('/media/first');
    });

    path.value = '/fixture/second.mp4';
    await nextTick();
    await vi.waitFor(() => {
      expect(stream?.mediaStreamUrl.value).toContain('/media/second');
    });
    expect(invokeMock).toHaveBeenCalledWith('release_media_stream', { token: 'first' });

    scope.stop();
    expect(invokeMock).toHaveBeenCalledWith('release_media_stream', { token: 'second' });
  });

  it('keeps a newer lease when an older request resolves late', async () => {
    const firstLease = deferred<{
      url: string;
      token: string;
    }>();
    invokeMock.mockImplementation((command: string, args?: { path?: string }) => {
      if (command === 'create_media_stream_url' && args?.path === '/fixture/first.mp4') {
        return firstLease.promise;
      }

      if (command === 'create_media_stream_url') {
        return Promise.resolve({
          url: 'http://127.0.0.1:45678/media/second',
          token: 'second',
        });
      }

      return Promise.resolve(true);
    });
    const path = ref('/fixture/first.mp4');
    const scope = effectScope();
    const stream = scope.run(() => useMediaStreamUrl(path));

    path.value = '/fixture/second.mp4';
    await nextTick();
    await vi.waitFor(() => {
      expect(stream?.mediaStreamUrl.value).toContain('/media/second');
    });

    firstLease.resolve({
      url: 'http://127.0.0.1:45678/media/first',
      token: 'first',
    });
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('release_media_stream', { token: 'first' });
    });
    expect(stream?.mediaStreamUrl.value).toContain('/media/second');
    scope.stop();
  });

  it('uses remote HTTP media directly without registering local access', async () => {
    const scope = effectScope();
    const stream = scope.run(() =>
      useMediaStreamUrl(ref('https://media.example.test/clip.mp4')));
    await nextTick();

    expect(stream?.mediaStreamUrl.value).toBe('https://media.example.test/clip.mp4');
    expect(invokeMock).not.toHaveBeenCalled();
    scope.stop();
  });
});
