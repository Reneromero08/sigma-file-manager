// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import type { Platform } from '@tauri-apps/plugin-os';

const EXTENSION_MODULE_SCHEME = 'sigma-extension';

function normalizePathComponents(modulePath: string): string[] {
  const components: string[] = [];

  if (!modulePath || modulePath.includes('\\') || modulePath.includes('\0')) {
    throw new Error('Extension embed module path is invalid');
  }

  for (const component of modulePath.replace(/^\/+/, '').split('/')) {
    if (!component || component === '.') {
      continue;
    }

    if (component === '..') {
      throw new Error('Extension embed module path escapes its package');
    }

    components.push(component);
  }

  if (
    components.length === 0
    || !/\.(?:m?js)$/i.test(components[components.length - 1] ?? '')
  ) {
    throw new Error('Extension embed entry must be a JavaScript module');
  }

  return components;
}

function encodeComponent(component: string): string {
  if (!component || component.includes('/') || component.includes('\\') || component.includes('\0')) {
    throw new Error('Extension embed module identity is invalid');
  }

  return encodeURIComponent(component);
}

export function createEmbedModuleUrl(options: {
  extensionId: string;
  extensionVersion: string;
  modulePath: string;
  platform: Platform;
}): string {
  const encodedPath = [
    encodeComponent(options.extensionId),
    encodeComponent(options.extensionVersion),
    ...normalizePathComponents(options.modulePath).map(encodeComponent),
  ].join('/');

  if (options.platform === 'windows' || options.platform === 'android') {
    return `http://${EXTENSION_MODULE_SCHEME}.localhost/${encodedPath}`;
  }

  return `${EXTENSION_MODULE_SCHEME}://localhost/${encodedPath}`;
}
