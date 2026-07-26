// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { invoke } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import type { InstalledExtensionData } from '@/types/extension';
import {
  BUNDLED_UNIVERSAL_LIBRARY_ID,
  BUNDLED_UNIVERSAL_LIBRARY_RESOURCE_PATH,
  createLocalStorageBundledExtensionMarkerStore,
  syncBundledExtension,
  type BundledExtensionManifestPreview,
  type BundledExtensionMarkerStore,
  type BundledExtensionSyncResult,
} from '@/modules/extensions/bundled-extension-sync';

export type BundledUniversalLibraryBootstrapOptions = {
  getInstalledExtension: () => InstalledExtensionData | undefined;
  installLocalExtension: (sourcePath: string) => Promise<void>;
  refreshLocalExtensionFromSource: (
    extensionId: string,
    sourcePath: string,
    expectedVersion: string,
  ) => Promise<void>;
  resolveSourcePath?: () => Promise<string>;
  readManifestPreview?: (sourcePath: string) => Promise<BundledExtensionManifestPreview>;
  markerStore?: BundledExtensionMarkerStore;
};

async function resolveBundledSourcePath(): Promise<string> {
  return resolveResource(BUNDLED_UNIVERSAL_LIBRARY_RESOURCE_PATH);
}

async function readBundledManifestPreview(
  sourcePath: string,
): Promise<BundledExtensionManifestPreview> {
  return invoke<BundledExtensionManifestPreview>('read_local_extension_manifest', {
    sourcePath,
  });
}

export async function bootstrapBundledUniversalLibrary(
  options: BundledUniversalLibraryBootstrapOptions,
): Promise<BundledExtensionSyncResult> {
  const sourcePath = await (options.resolveSourcePath ?? resolveBundledSourcePath)();
  const preview = await (options.readManifestPreview ?? readBundledManifestPreview)(sourcePath);
  const markerStore = options.markerStore
    ?? createLocalStorageBundledExtensionMarkerStore(window.localStorage);

  return syncBundledExtension({
    extensionId: BUNDLED_UNIVERSAL_LIBRARY_ID,
    sourcePath,
    preview,
    markerStore,
    getInstalledExtension: options.getInstalledExtension,
    installFromSource: options.installLocalExtension,
    refreshFromSource: options.refreshLocalExtensionFromSource,
  });
}
