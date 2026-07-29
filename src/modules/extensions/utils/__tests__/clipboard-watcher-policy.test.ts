// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { describe, expect, it } from 'vitest';
import { shouldUseNativeClipboardWatcher } from '@/modules/extensions/utils/clipboard-watcher-policy';

describe('clipboard watcher policy', () => {
  it('avoids continuous native clipboard polling on Linux', () => {
    expect(shouldUseNativeClipboardWatcher(true)).toBe(false);
  });

  it('keeps native clipboard change events on other platforms', () => {
    expect(shouldUseNativeClipboardWatcher(false)).toBe(true);
  });
});
