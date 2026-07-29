// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import { createI18n, type I18nOptions } from 'vue-i18n';
import { messages } from './data';
import { pluralRules } from './plural-rules';

const localeMessages = messages as unknown as NonNullable<I18nOptions['messages']>;
const i18nOptions = {
  locale: 'en',
  legacy: false,
  messages: localeMessages,
  pluralRules,
} as const;

export const i18n = createI18n(i18nOptions);
