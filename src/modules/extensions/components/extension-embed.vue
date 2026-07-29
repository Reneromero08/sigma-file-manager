<!-- SPDX-License-Identifier: GPL-3.0-or-later
License: GNU GPLv3 or later. See the license file in the project root for more information.
Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
-->

<script setup lang="ts">
import { platform } from '@tauri-apps/plugin-os';
import { createApp, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ExtensionIcon from '@/modules/extensions/components/extension-icon.vue';
import ExtensionToolbarView from '@/modules/extensions/components/extension-toolbar-view.vue';
import { getExtensionAPI } from '@/modules/extensions/runtime/loader';
import { createExtensionApiMethodMap } from '@/modules/extensions/runtime/api-method-map';
import { clearEmbedHostState, handleEmbedBridgeMessage } from '@/modules/extensions/runtime/embed-host-bridge';
import { createEmbedModuleUrl } from '@/modules/extensions/runtime/embed-module-url';
import pathApiCoreScript from '@/modules/extensions/api/path-api-core.js?raw';
import embedBridgeScript from '@/modules/extensions/runtime/embed-bridge.js?raw';

function getInlinePathApiScript(): string {
  return pathApiCoreScript.replace(
    /^export\s+function\s+createPathAPI/m,
    'function createPathAPI',
  );
}

const props = withDefaults(defineProps<{
  extensionId: string;
  extensionVersion: string;
  embedScriptPath: string;
  iconPath?: string;
  isActive?: boolean;
}>(), {
  iconPath: undefined,
  isActive: true,
});

const { t } = useI18n();
const toolbarRef = ref<HTMLDivElement | null>(null);
const iframeRef = ref<HTMLIFrameElement | null>(null);
const loadState = ref<'loading' | 'loaded' | 'failed'>('loading');
const loadError = ref('');
const bridgeToken = `embed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const EMBED_LOAD_TIMEOUT_MS = 20_000;
let toolbarApp: ReturnType<typeof createApp> | null = null;
let activeToolbarId: string | null = null;
let activeAttemptToken = '';
let attemptSequence = 0;
let loadTimeout: ReturnType<typeof setTimeout> | null = null;
let isDisposed = false;

function clearToolbar() {
  if (toolbarApp) {
    toolbarApp.unmount();
    toolbarApp = null;
  }

  toolbarRef.value?.replaceChildren();
  activeToolbarId = null;
}

function postMessageToEmbed(message: Record<string, unknown>) {
  iframeRef.value?.contentWindow?.postMessage({
    ...message,
    bridgeToken,
    attemptToken: activeAttemptToken,
  }, '*');
}

function handleToolbarRender(toolbarId: string, elements: unknown[]) {
  const container = toolbarRef.value;

  if (!container) {
    return;
  }

  clearToolbar();
  activeToolbarId = toolbarId;
  toolbarApp = createApp(ExtensionToolbarView, {
    elements,
    onButtonClick: (buttonId: string) => {
      postMessageToEmbed({
        type: 'toolbar-click',
        toolbarId,
        buttonId,
      });
    },
  });
  toolbarApp.mount(container);
}

function createEmbedSrcdoc(entryModuleUrl: string, attemptToken: string): string {
  const runtimeConstants = [
    `const bridgeToken = ${JSON.stringify(bridgeToken)};`,
    `const attemptToken = ${JSON.stringify(attemptToken)};`,
    `const entryModuleUrl = ${JSON.stringify(entryModuleUrl)};`,
    `const extensionId = ${JSON.stringify(props.extensionId)};`,
  ].join('\n');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: asset: sigma-extension: http://sigma-extension.localhost; font-src data: blob:; media-src blob: asset:; script-src 'unsafe-inline' sigma-extension: http://sigma-extension.localhost; connect-src blob: asset: sigma-extension: http://sigma-extension.localhost;"
    >
    <style>
      html, body, #app {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
${runtimeConstants}
${getInlinePathApiScript()}
${embedBridgeScript}
    <\/script>
  </body>
</html>`;
}

function handleMessage(event: MessageEvent) {
  if (event.source !== iframeRef.value?.contentWindow) {
    return;
  }

  const message = event.data as {
    bridgeToken?: string;
    attemptToken?: string;
    type?: string;
    id?: string;
    method?: string;
    args?: unknown[];
    toolbarId?: string;
    buttonId?: string;
    elements?: unknown[];
    stage?: string;
    error?: string | {
      name?: string;
      message?: string;
      stack?: string;
    };
  };

  if (
    !message
    || message.bridgeToken !== bridgeToken
    || message.attemptToken !== activeAttemptToken
  ) {
    return;
  }

  if (message.type === 'embed-ready') {
    completeAttempt('loaded');
    return;
  }

  if (message.type === 'embed-failed') {
    const structuredError = typeof message.error === 'object'
      ? message.error
      : undefined;
    console.error('[extension-embed] workspace load failed', {
      extensionId: props.extensionId,
      extensionVersion: props.extensionVersion,
      modulePath: props.embedScriptPath,
      stage: message.stage ?? 'unknown',
      error: message.error ?? null,
    });
    failAttempt(structuredError?.message ?? message.error);
    return;
  }

  if (message.type === 'render-toolbar' && message.toolbarId) {
    handleToolbarRender(message.toolbarId, message.elements ?? []);
    return;
  }

  if (message.type === 'unmount-toolbar') {
    if (!message.toolbarId || message.toolbarId === activeToolbarId) {
      clearToolbar();
    }

    return;
  }

  if (message.type?.startsWith('embed-')) {
    const api = getExtensionAPI(props.extensionId);

    if (api) {
      void handleEmbedBridgeMessage(props.extensionId, api, {
        ...message,
        error: typeof message.error === 'string' ? message.error : undefined,
      }, postMessageToEmbed);
    }

    return;
  }

  if (message.type === 'api-call' && message.id && message.method) {
    const api = getExtensionAPI(props.extensionId);
    const methodMap = api ? createExtensionApiMethodMap(api) : null;
    const handler = methodMap?.[message.method];

    if (!handler) {
      postMessageToEmbed({
        type: 'api-response',
        id: message.id,
        error: `Extension API method is not allowed: ${message.method}`,
      });
      return;
    }

    Promise.resolve(handler(...(message.args ?? []))).then((result) => {
      postMessageToEmbed({
        type: 'api-response',
        id: message.id,
        result,
      });
    }).catch((error) => {
      postMessageToEmbed({
        type: 'api-response',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function clearLoadTimeout() {
  if (loadTimeout) {
    clearTimeout(loadTimeout);
    loadTimeout = null;
  }
}

function completeAttempt(state: 'loaded' | 'failed') {
  clearLoadTimeout();
  loadState.value = state;
}

function failAttempt(error?: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error ?? '');
  loadError.value = errorMessage.slice(0, 180);
  completeAttempt('failed');
}

function mountEmbed() {
  clearToolbar();
  clearLoadTimeout();
  clearEmbedHostState(props.extensionId);
  loadState.value = 'loading';
  loadError.value = '';
  activeAttemptToken = `attempt-${++attemptSequence}-${Date.now()}`;

  try {
    const entryModuleUrl = createEmbedModuleUrl({
      extensionId: props.extensionId,
      extensionVersion: props.extensionVersion,
      modulePath: props.embedScriptPath,
      platform: platform(),
    });

    if (!iframeRef.value) {
      throw new Error('Extension workspace frame is unavailable');
    }

    iframeRef.value.srcdoc = createEmbedSrcdoc(entryModuleUrl, activeAttemptToken);
    const attemptToken = activeAttemptToken;
    loadTimeout = setTimeout(() => {
      if (!isDisposed && attemptToken === activeAttemptToken && loadState.value === 'loading') {
        console.error('[extension-embed] workspace load timed out', {
          extensionId: props.extensionId,
          extensionVersion: props.extensionVersion,
          modulePath: props.embedScriptPath,
        });
        failAttempt('The extension workspace did not finish loading.');
      }
    }, EMBED_LOAD_TIMEOUT_MS);
  }
  catch (error) {
    console.error('[extension-embed] workspace setup failed', {
      extensionId: props.extensionId,
      extensionVersion: props.extensionVersion,
      modulePath: props.embedScriptPath,
      error,
    });
    failAttempt(error);
  }
}

function unmountEmbed() {
  clearLoadTimeout();
  clearToolbar();
  loadState.value = 'loading';
}

onMounted(() => {
  window.addEventListener('message', handleMessage);
  mountEmbed();
});

onUnmounted(() => {
  isDisposed = true;
  window.removeEventListener('message', handleMessage);
  clearEmbedHostState(props.extensionId);
  unmountEmbed();
});
</script>

<template>
  <div class="extension-embed">
    <Teleport to=".window-toolbar-extension-embed-teleport-target">
      <div
        v-show="isActive"
        ref="toolbarRef"
        class="extension-embed__toolbar"
      />
    </Teleport>
    <div class="extension-embed__content-wrapper">
      <div class="extension-embed__content-spacer" />
      <iframe
        ref="iframeRef"
        class="extension-embed__content"
        :data-load-state="loadState"
        sandbox="allow-scripts"
        title=""
      />
      <Transition name="extension-embed-loader">
        <div
          v-if="loadState !== 'loaded'"
          class="extension-embed__loader"
          :data-state="loadState"
        >
          <div class="extension-embed__loader-icon-wrap">
            <ExtensionIcon
              :extension-id="extensionId"
              :icon-path="iconPath"
              :size="48"
            />
          </div>
          <p class="extension-embed__loader-text">
            {{
              loadState === 'failed'
                ? t('extensions.loadingExtensionFailed', 'Extension workspace could not be loaded.')
                : t('extensions.loadingExtension')
            }}
          </p>
          <p
            v-if="loadState === 'failed' && loadError"
            class="extension-embed__loader-error"
          >
            {{ loadError }}
          </p>
          <button
            v-if="loadState === 'failed'"
            class="extension-embed__retry"
            type="button"
            @click="mountEmbed"
          >
            {{ t('extensions.retryLoadingExtension', 'Retry') }}
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style>
.extension-embed {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.extension-embed__toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
}

.extension-embed__content-wrapper {
  position: relative;
  display: flex;
  overflow: hidden;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  border-radius: var(--radius-sm);
}

.extension-embed__content-spacer {
  min-height: 0;
  flex: 1;
}

.extension-embed__content {
  position: absolute;
  z-index: 0;
  display: block;
  overflow: hidden;
  width: 100%;
  height: 100%;
  border: none;
  inset: 0;
}

.extension-embed__loader {
  position: absolute;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-background);
  gap: 16px;
  inset: 0;
}

.extension-embed__loader-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.extension-embed__loader-text {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.extension-embed__loader-error {
  max-width: 36rem;
  margin: -6px 24px 0;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  text-align: center;
}

.extension-embed__retry {
  padding: 7px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-background-2);
  color: var(--color-text);
  cursor: pointer;
}

.extension-embed__retry:hover {
  background: var(--color-background-3);
}

.extension-embed-loader-enter-active {
  transition: none;
}

.extension-embed-loader-leave-active {
  transition: opacity 0.2s ease;
}

.extension-embed-loader-leave-to {
  opacity: 0;
}
</style>
