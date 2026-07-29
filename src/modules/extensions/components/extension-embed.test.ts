// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import ExtensionEmbed from '@/modules/extensions/components/extension-embed.vue';
import { clearEmbedHostState } from '@/modules/extensions/runtime/embed-host-bridge';

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'linux',
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/modules/extensions/runtime/loader', () => ({
  getExtensionAPI: () => null,
}));

vi.mock('@/modules/extensions/runtime/embed-host-bridge', () => ({
  clearEmbedHostState: vi.fn(),
  handleEmbedBridgeMessage: vi.fn(),
}));

type EmbedTokens = {
  bridgeToken: string;
  attemptToken: string;
};

let wrapper: VueWrapper | null = null;

function mountEmbed(): VueWrapper {
  wrapper = mount(ExtensionEmbed, {
    attachTo: document.body,
    props: {
      extensionId: 'reneromero08.universal-library',
      extensionVersion: '0.8.0',
      embedScriptPath: 'ui/workspace.js',
    },
    global: {
      stubs: {
        ExtensionIcon: true,
        ExtensionToolbarView: true,
      },
    },
  });
  return wrapper;
}

function getIframe(currentWrapper: VueWrapper): HTMLIFrameElement {
  return currentWrapper.get('iframe').element as HTMLIFrameElement;
}

function getEmbedTokens(iframe: HTMLIFrameElement): EmbedTokens {
  const srcdoc = iframe.srcdoc;
  const bridgeMatch = srcdoc.match(/const bridgeToken = ("[^"]+");/);
  const attemptMatch = srcdoc.match(/const attemptToken = ("[^"]+");/);

  if (!bridgeMatch || !attemptMatch) {
    throw new Error('Embed tokens were not written to srcdoc');
  }

  return {
    bridgeToken: JSON.parse(bridgeMatch[1]) as string,
    attemptToken: JSON.parse(attemptMatch[1]) as string,
  };
}

async function sendEmbedMessage(
  iframe: HTMLIFrameElement,
  tokens: EmbedTokens,
  message: Record<string, unknown>,
): Promise<void> {
  window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow,
    data: {
      ...tokens,
      ...message,
    },
  }));
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  const target = document.createElement('div');
  target.className = 'window-toolbar-extension-embed-teleport-target';
  document.body.append(target);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ExtensionEmbed', () => {
  it('loads through the scoped protocol without data scripts or unsafe-eval', () => {
    const currentWrapper = mountEmbed();
    const srcdoc = getIframe(currentWrapper).srcdoc;

    expect(srcdoc).toContain(
      'sigma-extension://localhost/reneromero08.universal-library/0.8.0/ui/workspace.js',
    );
    expect(srcdoc).toContain(
      'script-src \'unsafe-inline\' sigma-extension: http://sigma-extension.localhost;',
    );
    expect(srcdoc).toContain('media-src blob: asset: http://127.0.0.1:*;');
    expect(srcdoc).not.toContain('unsafe-eval');
    expect(srcdoc).not.toMatch(/script-src[^;]*data:/);
    expect(currentWrapper.find('[data-state="loading"]').exists()).toBe(true);
  });

  it('removes the loading overlay after a successful workspace mount', async () => {
    const currentWrapper = mountEmbed();
    const iframe = getIframe(currentWrapper);

    await sendEmbedMessage(iframe, getEmbedTokens(iframe), {
      type: 'embed-ready',
    });

    expect(currentWrapper.find('.extension-embed__loader').exists()).toBe(false);
    expect(currentWrapper.text()).not.toContain('extensions.loadingExtension');
    expect(currentWrapper.get('iframe').attributes('data-load-state')).toBe('loaded');
  });

  it('shows a bounded failed state after entry import rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const currentWrapper = mountEmbed();
    const iframe = getIframe(currentWrapper);

    await sendEmbedMessage(iframe, getEmbedTokens(iframe), {
      type: 'embed-failed',
      stage: 'entry-module',
      error: {
        name: 'TypeError',
        message: 'x'.repeat(300),
        stack: 'full diagnostic stack',
      },
    });

    expect(currentWrapper.find('[data-state="failed"]').exists()).toBe(true);
    expect(currentWrapper.get('.extension-embed__loader-error').text()).toHaveLength(180);
    expect(currentWrapper.get('.extension-embed__retry').text()).toBe('Retry');
    expect(consoleError).toHaveBeenCalledWith(
      '[extension-embed] workspace load failed',
      expect.objectContaining({
        stage: 'entry-module',
        error: expect.objectContaining({ stack: 'full diagnostic stack' }),
      }),
    );
  });

  it('fails after a bounded timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const currentWrapper = mountEmbed();

    await vi.advanceTimersByTimeAsync(20_000);
    await nextTick();

    expect(currentWrapper.find('[data-state="failed"]').exists()).toBe(true);
    expect(currentWrapper.get('.extension-embed__loader-error').text()).toMatch(/did not finish/);
  });

  it('retries cleanly and ignores stale attempt results', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const currentWrapper = mountEmbed();
    const iframe = getIframe(currentWrapper);
    const firstTokens = getEmbedTokens(iframe);

    await sendEmbedMessage(iframe, firstTokens, {
      type: 'embed-failed',
      stage: 'entry-module',
      error: { message: 'first attempt failed' },
    });
    await currentWrapper.get('.extension-embed__retry').trigger('click');

    const secondTokens = getEmbedTokens(iframe);
    expect(secondTokens.attemptToken).not.toBe(firstTokens.attemptToken);
    expect(vi.mocked(clearEmbedHostState)).toHaveBeenCalledTimes(2);

    await sendEmbedMessage(iframe, secondTokens, {
      type: 'embed-ready',
    });
    await sendEmbedMessage(iframe, firstTokens, {
      type: 'embed-failed',
      stage: 'entry-module',
      error: { message: 'stale failure' },
    });

    expect(currentWrapper.find('[data-state]').exists()).toBe(false);
    expect(currentWrapper.get('iframe').attributes('data-load-state')).toBe('loaded');
  });
});
