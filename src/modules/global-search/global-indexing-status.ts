// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

import type { GlobalSearchScanPhase } from '@/stores/runtime/global-search';

export type GlobalIndexingDisplayStatus
  = 'disabled'
    | 'idle'
    | 'indexing'
    | 'stopping'
    | 'error';

export function resolveGlobalIndexingDisplayStatus(options: {
  enabled: boolean;
  selectedRootCount: number;
  scanPhase: GlobalSearchScanPhase;
  isScanInProgress: boolean;
  isCommitting: boolean;
  hasError: boolean;
}): GlobalIndexingDisplayStatus {
  if (options.scanPhase === 'canceling') {
    return 'stopping';
  }

  if (
    options.scanPhase === 'scanning'
    || options.scanPhase === 'committing'
    || options.isScanInProgress
    || options.isCommitting
  ) {
    return 'indexing';
  }

  if (!options.enabled || options.selectedRootCount === 0) {
    return 'disabled';
  }

  if (options.hasError) {
    return 'error';
  }

  return 'idle';
}
