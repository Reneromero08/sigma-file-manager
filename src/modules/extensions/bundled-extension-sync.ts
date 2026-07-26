// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import type { InstalledExtensionData } from '@/types/extension';

export const BUNDLED_UNIVERSAL_LIBRARY_ID = 'reneromero08.universal-library';
export const BUNDLED_UNIVERSAL_LIBRARY_RESOURCE_PATH = 'bundled-extensions/reneromero08.universal-library';
export const BUNDLED_EXTENSION_MARKER_PREFIX = 'sigma.bundled-extension.managed:';

export type BundledExtensionManifestPreview = {
  extensionId: string;
  name?: string;
  version: string;
};

export type BundledExtensionMarkerStore = {
  get(extensionId: string): string | null;
  set(extensionId: string, value: string): void;
};

export type BundledExtensionSyncResult
  = 'installed'
  | 'refreshed'
  | 'current'
  | 'cancelled'
  | 'skipped-user-extension'
  | 'skipped-user-uninstalled';

export type BundledExtensionSyncOptions = {
  extensionId: string;
  sourcePath: string;
  preview: BundledExtensionManifestPreview;
  markerStore: BundledExtensionMarkerStore;
  getInstalledExtension: () => InstalledExtensionData | undefined;
  installFromSource: (sourcePath: string) => Promise<void>;
  refreshFromSource: (
    extensionId: string,
    sourcePath: string,
    expectedVersion: string,
  ) => Promise<void>;
};

export function createLocalStorageBundledExtensionMarkerStore(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): BundledExtensionMarkerStore {
  return {
    get(extensionId) {
      return storage.getItem(`${BUNDLED_EXTENSION_MARKER_PREFIX}${extensionId}`);
    },
    set(extensionId, value) {
      storage.setItem(`${BUNDLED_EXTENSION_MARKER_PREFIX}${extensionId}`, value);
    },
  };
}

function isManagedMarker(value: string | null): boolean {
  return value === 'managed';
}

export async function syncBundledExtension(
  options: BundledExtensionSyncOptions,
): Promise<BundledExtensionSyncResult> {
  const {
    extensionId,
    sourcePath,
    preview,
    markerStore,
    getInstalledExtension,
    installFromSource,
    refreshFromSource,
  } = options;

  if (preview.extensionId !== extensionId) {
    throw new Error(
      `Bundled extension id mismatch: expected "${extensionId}", received "${preview.extensionId}"`,
    );
  }

  const marker = markerStore.get(extensionId);
  const installed = getInstalledExtension();

  if (!installed) {
    if (isManagedMarker(marker)) {
      return 'skipped-user-uninstalled';
    }

    await installFromSource(sourcePath);
    const installedAfterPrompt = getInstalledExtension();

    if (!installedAfterPrompt) {
      return 'cancelled';
    }

    if (!installedAfterPrompt.isLocal) {
      return 'skipped-user-extension';
    }

    markerStore.set(extensionId, 'managed');
    return 'installed';
  }

  if (!isManagedMarker(marker) || !installed.isLocal) {
    return 'skipped-user-extension';
  }

  if (installed.version === preview.version) {
    return 'current';
  }

  await refreshFromSource(extensionId, sourcePath, preview.version);
  const refreshed = getInstalledExtension();

  if (!refreshed || refreshed.version !== preview.version) {
    throw new Error(`Bundled extension refresh did not install version ${preview.version}`);
  }

  markerStore.set(extensionId, 'managed');
  return 'refreshed';
}
