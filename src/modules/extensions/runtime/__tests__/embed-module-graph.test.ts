// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { describe, expect, it } from 'vitest';
import { createEmbedModuleUrl } from '@/modules/extensions/runtime/embed-module-url';

describe('extension embed module URL', () => {
  it('creates a deterministic CSP-safe packaged URL', () => {
    expect(createEmbedModuleUrl({
      extensionId: 'reneromero08.universal-library',
      extensionVersion: '0.8.0',
      modulePath: 'ui/workspace.js',
      platform: 'linux',
    })).toBe(
      'sigma-extension://localhost/reneromero08.universal-library/0.8.0/ui/workspace.js',
    );
  });

  it('uses the Tauri localhost protocol mapping on Windows', () => {
    expect(createEmbedModuleUrl({
      extensionId: 'example.extension',
      extensionVersion: '1.0.0',
      modulePath: 'ui/workspace.js',
      platform: 'windows',
    })).toBe(
      'http://sigma-extension.localhost/example.extension/1.0.0/ui/workspace.js',
    );
  });

  it('preserves package-relative paths for sibling and nested imports', () => {
    const entryUrl = createEmbedModuleUrl({
      extensionId: 'example.extension',
      extensionVersion: '1.0.0',
      modulePath: 'ui/workspace.js',
      platform: 'linux',
    });
    expect(new URL('./audio-player.js', entryUrl).href).toBe(
      'sigma-extension://localhost/example.extension/1.0.0/ui/audio-player.js',
    );
    expect(new URL('./nested/provider.js', entryUrl).href).toBe(
      'sigma-extension://localhost/example.extension/1.0.0/ui/nested/provider.js',
    );
  });

  it('rejects traversal outside the extension root', () => {
    expect(() => createEmbedModuleUrl({
      extensionId: 'example.extension',
      extensionVersion: '1.0.0',
      modulePath: '../outside.js',
      platform: 'linux',
    })).toThrow(/escapes its package/);
  });

  it('does not depend on an AppImage resource mount path', () => {
    const options = {
      extensionId: 'reneromero08.universal-library',
      extensionVersion: '0.8.0',
      modulePath: 'ui/workspace.js',
      platform: 'linux' as const,
    };
    expect(createEmbedModuleUrl(options)).toBe(createEmbedModuleUrl(options));
    expect(createEmbedModuleUrl(options)).not.toContain('/tmp/.mount_');
  });

  it('keeps Universal Library media and provider modules addressable', () => {
    for (const modulePath of [
      'ui/audio-player.js',
      'ui/audio-ui.js',
      'ui/image-preview.js',
      'src/workspace-provider.js',
    ]) {
      expect(createEmbedModuleUrl({
        extensionId: 'reneromero08.universal-library',
        extensionVersion: '0.8.0',
        modulePath,
        platform: 'linux',
      })).toBe(
        `sigma-extension://localhost/reneromero08.universal-library/0.8.0/${modulePath}`,
      );
    }
  });
});
