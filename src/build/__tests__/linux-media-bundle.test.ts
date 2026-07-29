// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type LinuxBundleConfig = {
  app?: {
    security?: {
      assetProtocol?: {
        scope?: {
          allow?: string[];
          requireLiteralLeadingDot?: boolean;
        };
      };
    };
  };
  bundle?: {
    linux?: {
      appimage?: {
        bundleMediaFramework?: boolean;
      };
      deb?: {
        depends?: string[];
      };
    };
  };
};

describe('Linux media packaging', () => {
  it('ships the AppImage media framework and Debian runtime dependencies', () => {
    const config = JSON.parse(readFileSync(
      resolve(process.cwd(), 'src-tauri/tauri.conf.json'),
      'utf8',
    )) as LinuxBundleConfig;

    expect(config.bundle?.linux?.appimage?.bundleMediaFramework).toBe(true);
    expect(config.bundle?.linux?.deb?.depends).toEqual(expect.arrayContaining([
      'gstreamer1.0-plugins-base',
      'gstreamer1.0-plugins-good',
      'gstreamer1.0-plugins-bad',
      'gstreamer1.0-libav',
    ]));
    expect(config.app?.security?.assetProtocol?.scope?.allow).toContain('/**');
    expect(config.app?.security?.assetProtocol?.scope?.requireLiteralLeadingDot).toBe(false);
  });
});
