<!-- SPDX-License-Identifier: GPL-3.0-or-later
License: GNU GPLv3 or later. See the license file in the project root for more information.
Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
-->

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGlobalSearchStore } from '@/stores/runtime/global-search';
import { useUserSettingsStore } from '@/stores/storage/user-settings';
import {
  resolveGlobalIndexingDisplayStatus,
  type GlobalIndexingDisplayStatus,
} from '@/modules/global-search/global-indexing-status';

const { t } = useI18n();
const globalSearchStore = useGlobalSearchStore();
const userSettingsStore = useUserSettingsStore();
const actionState = ref<'stopping' | 'disabling' | null>(null);

const selectedRootCount = computed(
  () => userSettingsStore.userSettings.globalSearch.selectedDriveRoots.length,
);

const status = computed<GlobalIndexingDisplayStatus>(() => {
  if (actionState.value === 'stopping' || actionState.value === 'disabling') {
    return 'stopping';
  }

  return resolveGlobalIndexingDisplayStatus({
    enabled: userSettingsStore.userSettings.globalSearch.enabled === true,
    selectedRootCount: selectedRootCount.value,
    scanPhase: globalSearchStore.scanPhase,
    isScanInProgress: globalSearchStore.isScanInProgress,
    isCommitting: globalSearchStore.isCommitting,
    hasError: Boolean(
      globalSearchStore.lastError
      || globalSearchStore.lastScanError
      || globalSearchStore.driveScanErrors.length > 0,
    ),
  });
});

const statusLabel = computed(() => {
  return t(`globalSearch.indexingControl.status.${status.value}`, status.value);
});

const canStop = computed(() => status.value === 'indexing');
const canDisable = computed(() => (
  userSettingsStore.userSettings.globalSearch.enabled === true
  && actionState.value === null
));

async function stopIndexing() {
  if (!canStop.value) return;

  actionState.value = 'stopping';

  try {
    await globalSearchStore.cancelScan();
  }
  finally {
    actionState.value = null;
  }
}

async function disableIndexing() {
  if (!canDisable.value) return;

  actionState.value = 'disabling';

  try {
    await userSettingsStore.set('globalSearch.enabled', false);

    if (globalSearchStore.isScanInProgress || globalSearchStore.isCommitting) {
      await globalSearchStore.cancelScan();
    }
  }
  finally {
    actionState.value = null;
  }
}

onMounted(() => {
  void globalSearchStore.refreshStatus();
  globalSearchStore.startStatusPolling();
});
</script>

<template>
  <div
    class="global-indexing-status"
    data-global-indexing-status
    :data-status="status"
    :aria-label="t('globalSearch.indexingControl.ariaLabel', 'Sigma global indexing status')"
  >
    <span
      class="global-indexing-status__indicator"
      aria-hidden="true"
    />
    <span class="global-indexing-status__label">
      {{ t('globalSearch.indexingControl.label', 'Sigma indexing') }}:
      <strong>{{ statusLabel }}</strong>
    </span>
    <button
      v-if="status === 'indexing' || status === 'stopping'"
      class="global-indexing-status__action"
      type="button"
      :disabled="!canStop"
      @click="stopIndexing"
    >
      {{ t('globalSearch.indexingControl.stop', 'Stop') }}
    </button>
    <button
      class="global-indexing-status__action"
      type="button"
      :disabled="!canDisable"
      @click="disableIndexing"
    >
      {{ t('globalSearch.indexingControl.disable', 'Disable') }}
    </button>
  </div>
</template>

<style scoped>
.global-indexing-status {
  display: flex;
  height: 28px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid hsl(var(--border) / 55%);
  border-radius: var(--radius-sm);
  background: hsl(var(--background-2) / 88%);
  color: hsl(var(--foreground));
  font-size: 11px;
  gap: 6px;
  white-space: nowrap;
}

.global-indexing-status__indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: hsl(var(--muted-foreground));
}

.global-indexing-status[data-status='disabled'] .global-indexing-status__indicator {
  background: hsl(var(--muted-foreground));
}

.global-indexing-status[data-status='idle'] .global-indexing-status__indicator {
  background: hsl(145deg 65% 50%);
}

.global-indexing-status[data-status='indexing'] .global-indexing-status__indicator,
.global-indexing-status[data-status='stopping'] .global-indexing-status__indicator {
  background: hsl(42deg 92% 56%);
}

.global-indexing-status[data-status='error'] .global-indexing-status__indicator {
  background: hsl(var(--destructive));
}

.global-indexing-status__label strong {
  font-weight: 650;
}

.global-indexing-status__action {
  height: 20px;
  padding: 0 6px;
  border: 1px solid hsl(var(--border) / 70%);
  border-radius: 4px;
  background: hsl(var(--background-3) / 85%);
  color: inherit;
  cursor: pointer;
  font-size: 10px;
}

.global-indexing-status__action:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>
