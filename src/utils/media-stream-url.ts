// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { invoke } from '@tauri-apps/api/core';

export interface MediaStreamLease {
  url: string;
  token: string;
}

export async function createMediaStreamLease(path: string): Promise<MediaStreamLease> {
  return invoke<MediaStreamLease>('create_media_stream_url', { path });
}

export async function releaseMediaStreamLease(
  lease: MediaStreamLease | null | undefined,
): Promise<void> {
  if (!lease?.token) {
    return;
  }

  await invoke('release_media_stream', { token: lease.token });
}
