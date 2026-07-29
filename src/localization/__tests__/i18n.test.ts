// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { isRef } from 'vue';
import { describe, expect, it } from 'vitest';
import { i18n } from '../index';

describe('i18n', () => {
  it('exposes the global locale as writable composition state', () => {
    const locale = i18n.global.locale;
    const initialLocale = locale.value;

    expect(isRef(locale)).toBe(true);

    locale.value = 'de';
    expect(locale.value).toBe('de');

    locale.value = initialLocale;
  });
});
