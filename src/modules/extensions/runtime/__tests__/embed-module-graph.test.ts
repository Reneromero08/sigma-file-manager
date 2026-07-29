// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createEmbedModuleDataUrl,
  loadEmbedModuleGraph,
} from '@/modules/extensions/runtime/embed-module-graph';

describe('extension embed module graph', () => {
  it('loads and rewrites relative module imports before creating the entry URL', async () => {
    const readModule = vi.fn(async (path: string) => {
      const sources: Record<string, string> = {
        'ui/workspace.js': `
          import { value } from './audio-ui.js';
          export async function mount(container) {
            container.value = value;
          }
        `,
        'ui/audio-ui.js': 'export const value = "workspace-ready";',
      };
      return sources[path] ?? Promise.reject(new Error(`Missing module: ${path}`));
    });
    const graph = await loadEmbedModuleGraph('ui/workspace.js', readModule);
    const module = await import(createEmbedModuleDataUrl(graph));
    const container: { value?: string } = {};

    await module.mount(container);

    expect(container.value).toBe('workspace-ready');
    expect(readModule).toHaveBeenCalledWith('ui/workspace.js');
    expect(readModule).toHaveBeenCalledWith('ui/audio-ui.js');
  });

  it('rejects imports that escape the extension package', async () => {
    await expect(loadEmbedModuleGraph(
      'ui/workspace.js',
      async () => 'import "../../outside.js";',
    )).rejects.toThrow(/escapes its package/);
  });

  it('loads the bundled Universal Library workspace module graph', async () => {
    const extensionRoot = resolve('universal-library/extension');
    const graph = await loadEmbedModuleGraph(
      'ui/workspace.js',
      path => readFile(resolve(extensionRoot, path), 'utf8'),
    );
    const module = await import(createEmbedModuleDataUrl(graph));

    expect(Object.keys(graph.sources).sort()).toEqual([
      'ui/audio-player.js',
      'ui/audio-ui.js',
      'ui/image-preview.js',
      'ui/workspace.js',
    ]);
    expect(module.mount).toBeTypeOf('function');
  });
});
