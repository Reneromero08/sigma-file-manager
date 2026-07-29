// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import GlobalIndexingStatus from '@/modules/global-search/global-indexing-status.vue';
import { resolveGlobalIndexingDisplayStatus } from '@/modules/global-search/global-indexing-status';

type DriveScanError = {
  drive_root: string;
  message: string;
};

const {
  userSettings,
  setUserSetting,
  globalSearch,
} = vi.hoisted(() => ({
  userSettings: {
    globalSearch: {
      enabled: false,
      selectedDriveRoots: [] as string[],
    },
  },
  setUserSetting: vi.fn(),
  globalSearch: {
    scanPhase: 'idle' as 'idle' | 'scanning' | 'canceling' | 'committing',
    isScanInProgress: false,
    isCommitting: false,
    lastError: null as string | null,
    lastScanError: null as string | null,
    driveScanErrors: [] as DriveScanError[],
    cancelScan: vi.fn(),
    refreshStatus: vi.fn(),
    startStatusPolling: vi.fn(),
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => (
      fallback ?? key.split('.')[key.split('.').length - 1] ?? key
    ),
  }),
}));

vi.mock('@/stores/storage/user-settings', () => ({
  useUserSettingsStore: () => ({
    userSettings,
    set: setUserSetting,
  }),
}));

vi.mock('@/stores/runtime/global-search', () => ({
  useGlobalSearchStore: () => globalSearch,
}));

let wrapper: VueWrapper | null = null;

function mountStatus(): VueWrapper {
  wrapper = mount(GlobalIndexingStatus);
  return wrapper;
}

function resetState() {
  userSettings.globalSearch.enabled = false;
  userSettings.globalSearch.selectedDriveRoots = [];
  globalSearch.scanPhase = 'idle';
  globalSearch.isScanInProgress = false;
  globalSearch.isCommitting = false;
  globalSearch.lastError = null;
  globalSearch.lastScanError = null;
  globalSearch.driveScanErrors = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  setUserSetting.mockResolvedValue(undefined);
  globalSearch.cancelScan.mockResolvedValue(undefined);
  globalSearch.refreshStatus.mockResolvedValue(undefined);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('resolveGlobalIndexingDisplayStatus', () => {
  it.each([
    ['disabled', false, 0, 'idle', false, false, false],
    ['disabled', true, 0, 'idle', false, false, false],
    ['idle', true, 1, 'idle', false, false, false],
    ['indexing', true, 1, 'scanning', true, false, false],
    ['stopping', true, 1, 'canceling', true, false, false],
    ['error', true, 1, 'idle', false, false, true],
  ] as const)(
    'returns %s for the supplied runtime state',
    (expected, enabled, selectedRootCount, scanPhase, isScanInProgress, isCommitting, hasError) => {
      expect(resolveGlobalIndexingDisplayStatus({
        enabled,
        selectedRootCount,
        scanPhase,
        isScanInProgress,
        isCommitting,
        hasError,
      })).toBe(expected);
    },
  );
});

describe('GlobalIndexingStatus', () => {
  it('visibly reports Disabled for a fresh profile with no roots', () => {
    const currentWrapper = mountStatus();

    expect(currentWrapper.get('[data-global-indexing-status]').attributes('data-status'))
      .toBe('disabled');
    expect(currentWrapper.text()).toContain('Sigma indexing: disabled');
    expect(currentWrapper.get('button').text()).toBe('Disable');
    expect(currentWrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('visibly reports Idle after explicit enablement and root approval', () => {
    userSettings.globalSearch.enabled = true;
    userSettings.globalSearch.selectedDriveRoots = ['/synthetic/library'];
    const currentWrapper = mountStatus();

    expect(currentWrapper.get('[data-global-indexing-status]').attributes('data-status'))
      .toBe('idle');
    expect(currentWrapper.text()).toContain('Sigma indexing: idle');
  });

  it('shows Stop while indexing and transitions visibly to Stopping', async () => {
    userSettings.globalSearch.enabled = true;
    userSettings.globalSearch.selectedDriveRoots = ['/synthetic/library'];
    globalSearch.scanPhase = 'scanning';
    globalSearch.isScanInProgress = true;
    let resolveCancel: (() => void) | undefined;
    globalSearch.cancelScan.mockImplementation(() => new Promise<void>((resolve) => {
      resolveCancel = resolve;
    }));
    const currentWrapper = mountStatus();

    const stopButton = currentWrapper.findAll('button').find(button => button.text() === 'Stop');
    expect(stopButton).toBeDefined();
    await stopButton?.trigger('click');
    await nextTick();

    expect(currentWrapper.get('[data-global-indexing-status]').attributes('data-status'))
      .toBe('stopping');
    expect(globalSearch.cancelScan).toHaveBeenCalledOnce();

    resolveCancel?.();
    await flushPromises();
  });

  it('visibly reports backend errors while enabled and idle', () => {
    userSettings.globalSearch.enabled = true;
    userSettings.globalSearch.selectedDriveRoots = ['/synthetic/library'];
    globalSearch.lastError = 'backend unavailable';
    const currentWrapper = mountStatus();

    expect(currentWrapper.get('[data-global-indexing-status]').attributes('data-status'))
      .toBe('error');
  });

  it('provides a direct Disable action without clearing approved roots', async () => {
    userSettings.globalSearch.enabled = true;
    userSettings.globalSearch.selectedDriveRoots = ['/synthetic/library'];
    const currentWrapper = mountStatus();
    const disableButton = currentWrapper.findAll('button').find(button => button.text() === 'Disable');

    await disableButton?.trigger('click');
    await flushPromises();

    expect(setUserSetting).toHaveBeenCalledWith('globalSearch.enabled', false);
    expect(setUserSetting).not.toHaveBeenCalledWith(
      'globalSearch.selectedDriveRoots',
      expect.anything(),
    );
  });

  it('cancels active work when the direct Disable action is used', async () => {
    userSettings.globalSearch.enabled = true;
    userSettings.globalSearch.selectedDriveRoots = ['/synthetic/library'];
    globalSearch.scanPhase = 'scanning';
    globalSearch.isScanInProgress = true;
    const currentWrapper = mountStatus();
    const disableButton = currentWrapper.findAll('button').find(button => button.text() === 'Disable');

    await disableButton?.trigger('click');
    await flushPromises();

    expect(setUserSetting).toHaveBeenCalledWith('globalSearch.enabled', false);
    expect(globalSearch.cancelScan).toHaveBeenCalledOnce();
  });
});
