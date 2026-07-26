// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { describe, expect, it, vi } from 'vitest';
import type { InstalledExtensionData } from '@/types/extension';
import {
  BUNDLED_EXTENSION_MARKER_PREFIX,
  createLocalStorageBundledExtensionMarkerStore,
  syncBundledExtension,
  type BundledExtensionMarkerStore,
} from '@/modules/extensions/bundled-extension-sync';

const extensionId = 'reneromero08.universal-library';
const sourcePath = '/resources/bundled-extensions/reneromero08.universal-library';

function installedExtension(
  overrides: Partial<InstalledExtensionData> = {},
): InstalledExtensionData {
  return {
    version: '0.4.0',
    enabled: true,
    autoUpdate: false,
    installedAt: 1,
    manifest: {
      id: extensionId,
      name: 'Universal Library',
      version: '0.4.0',
      repository: 'https://github.com/Reneromero08/sigma-file-manager',
      license: 'GPL-3.0-or-later',
      extensionType: 'api',
      main: 'src/index.js',
      permissions: [],
      engines: { sigmaFileManager: '>=2.2.0' },
    },
    settings: { scopedDirectories: [] },
    isLocal: true,
    localSourcePath: sourcePath,
    ...overrides,
  };
}

function markerStore(initial: string | null = null): BundledExtensionMarkerStore & {
  value: string | null;
} {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(_extensionId, value) {
      this.value = value;
    },
  };
}

describe('syncBundledExtension', () => {
  it('installs a missing bundled extension and records ownership', async () => {
    let installed: InstalledExtensionData | undefined;
    const markers = markerStore();
    const installFromSource = vi.fn(async () => {
      installed = installedExtension();
    });

    const result = await syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId,
        version: '0.4.0',
      },
      markerStore: markers,
      getInstalledExtension: () => installed,
      installFromSource,
      refreshFromSource: vi.fn(),
    });

    expect(result).toBe('installed');
    expect(installFromSource).toHaveBeenCalledWith(sourcePath);
    expect(markers.value).toBe('managed');
  });

  it('returns cancelled when binary consent or folder install is declined', async () => {
    const markers = markerStore();

    const result = await syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId,
        version: '0.4.0',
      },
      markerStore: markers,
      getInstalledExtension: () => undefined,
      installFromSource: vi.fn(async () => undefined),
      refreshFromSource: vi.fn(),
    });

    expect(result).toBe('cancelled');
    expect(markers.value).toBeNull();
  });

  it('does not reinstall a bundled extension the user later uninstalled', async () => {
    const installFromSource = vi.fn();

    const result = await syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId,
        version: '0.4.0',
      },
      markerStore: markerStore('managed'),
      getInstalledExtension: () => undefined,
      installFromSource,
      refreshFromSource: vi.fn(),
    });

    expect(result).toBe('skipped-user-uninstalled');
    expect(installFromSource).not.toHaveBeenCalled();
  });

  it('does not overwrite a manually installed same-id extension', async () => {
    const refreshFromSource = vi.fn();

    const result = await syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId,
        version: '0.4.0',
      },
      markerStore: markerStore(),
      getInstalledExtension: () => installedExtension({
        localSourcePath: '/home/raul/dev/universal-library',
      }),
      installFromSource: vi.fn(),
      refreshFromSource,
    });

    expect(result).toBe('skipped-user-extension');
    expect(refreshFromSource).not.toHaveBeenCalled();
  });

  it('keeps a current bundled extension unchanged', async () => {
    const refreshFromSource = vi.fn();

    const result = await syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId,
        version: '0.4.0',
      },
      markerStore: markerStore('managed'),
      getInstalledExtension: () => installedExtension(),
      installFromSource: vi.fn(),
      refreshFromSource,
    });

    expect(result).toBe('current');
    expect(refreshFromSource).not.toHaveBeenCalled();
  });

  it('refreshes a managed bundled extension from the current resource mount', async () => {
    let installed = installedExtension({
      version: '0.3.0',
      localSourcePath: '/tmp/.mount-old/resources/bundled-extension',
      enabled: false,
    });
    const refreshFromSource = vi.fn(async (_id: string, nextSourcePath: string) => {
      installed = installedExtension({
        enabled: false,
        localSourcePath: nextSourcePath,
      });
    });

    const result = await syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId,
        version: '0.4.0',
      },
      markerStore: markerStore('managed'),
      getInstalledExtension: () => installed,
      installFromSource: vi.fn(),
      refreshFromSource,
    });

    expect(result).toBe('refreshed');
    expect(refreshFromSource).toHaveBeenCalledWith(extensionId, sourcePath, '0.4.0');
    expect(installed.enabled).toBe(false);
  });

  it('rejects a bundled manifest with an unexpected extension id', async () => {
    await expect(syncBundledExtension({
      extensionId,
      sourcePath,
      preview: {
        extensionId: 'other.extension',
        version: '0.4.0',
      },
      markerStore: markerStore(),
      getInstalledExtension: () => undefined,
      installFromSource: vi.fn(),
      refreshFromSource: vi.fn(),
    })).rejects.toThrow(/Bundled extension id mismatch/);
  });
});

describe('createLocalStorageBundledExtensionMarkerStore', () => {
  it('namespaces bundled ownership markers by extension id', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    const markers = createLocalStorageBundledExtensionMarkerStore(storage);

    markers.set(extensionId, 'managed');

    expect(markers.get(extensionId)).toBe('managed');
    expect(values.get(`${BUNDLED_EXTENSION_MARKER_PREFIX}${extensionId}`)).toBe('managed');
  });
});
