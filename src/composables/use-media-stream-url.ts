// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import {
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';
import {
  createMediaStreamLease,
  releaseMediaStreamLease,
  type MediaStreamLease,
} from '@/utils/media-stream-url';

function isRemoteMediaUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export function useMediaStreamUrl(
  pathSource: MaybeRefOrGetter<string | null | undefined>,
  enabledSource: MaybeRefOrGetter<boolean> = true,
) {
  const mediaStreamUrl = ref('');
  const mediaStreamError = ref<string | null>(null);
  let activeLease: MediaStreamLease | null = null;
  let requestGeneration = 0;
  let disposed = false;

  function releaseActiveLease(): void {
    const lease = activeLease;
    activeLease = null;

    if (lease) {
      void releaseMediaStreamLease(lease).catch(() => {});
    }
  }

  async function refresh(): Promise<void> {
    const generation = ++requestGeneration;
    const path = toValue(pathSource)?.trim() ?? '';
    const enabled = toValue(enabledSource);

    releaseActiveLease();
    mediaStreamUrl.value = '';
    mediaStreamError.value = null;

    if (!enabled || !path) {
      return;
    }

    if (isRemoteMediaUrl(path)) {
      mediaStreamUrl.value = path;
      return;
    }

    try {
      const lease = await createMediaStreamLease(path);

      if (disposed || generation !== requestGeneration) {
        void releaseMediaStreamLease(lease).catch(() => {});
        return;
      }

      activeLease = lease;
      mediaStreamUrl.value = lease.url;
    }
    catch (error) {
      if (disposed || generation !== requestGeneration) {
        return;
      }

      mediaStreamError.value = error instanceof Error ? error.message : String(error);
    }
  }

  const stopWatching = watch(
    [() => toValue(pathSource), () => toValue(enabledSource)],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    disposed = true;
    requestGeneration += 1;
    stopWatching();
    releaseActiveLease();
  });

  return {
    mediaStreamUrl,
    mediaStreamError,
    refresh,
  };
}
