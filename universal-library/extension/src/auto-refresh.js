import { formatCatalogError, runCatalog, startCatalog } from './catalog-client.js';

const ROOTS_KEY = 'library-roots';
const CONFIG_KEY = 'catalog-auto-refresh-config';
const STATUS_KEY = 'catalog-auto-refresh-status';
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_STARTUP_DELAY_MS = 30_000;

function finiteInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function normalizeAutoRefreshConfig(value = {}) {
  const intervalMinutes = Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(
      MIN_INTERVAL_MINUTES,
      finiteInteger(value.intervalMinutes, DEFAULT_INTERVAL_MINUTES),
    ),
  );
  return {
    enabled: value.enabled === true,
    intervalMinutes,
  };
}

async function readRoots(storage) {
  const roots = await storage.get(ROOTS_KEY);
  return Array.isArray(roots) ? roots : [];
}

export async function scanRootsInBackground(options = {}) {
  const {
    storage = sigma.storage,
    addRoot = args => runCatalog(args),
    startScan = args => startCatalog(args),
    basename = path => sigma.path.basename(path),
  } = options;
  const roots = await readRoots(storage);
  const reports = [];
  const failures = [];

  for (const root of roots) {
    const path = typeof root?.path === 'string' ? root.path : '';
    if (!path) continue;
    const name = root.displayName ?? basename(path) ?? path;
    try {
      await addRoot(['root', 'add', path, '--name', name]);
      const task = await startScan(['root', 'scan', path]);
      reports.push(await task.result);
    }
    catch (error) {
      failures.push({
        root: path,
        message: formatCatalogError(error),
      });
    }
  }

  return {
    rootCount: roots.length,
    reports,
    failures,
    filesSeen: reports.reduce((total, report) => total + (report.filesSeen ?? 0), 0),
    issueCount: reports.reduce((total, report) => total + (report.issueCount ?? 0), 0),
  };
}

export function createAutoRefreshController(options = {}) {
  const {
    storage = sigma.storage,
    scan = () => scanRootsInBackground({ storage }),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer),
    now = () => Date.now(),
    startupDelayMs = DEFAULT_STARTUP_DELAY_MS,
  } = options;

  let config = normalizeAutoRefreshConfig();
  let timer = null;
  let running = null;
  let disposed = false;
  let status = {
    state: 'disabled',
    trigger: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    nextRunAt: null,
    lastSummary: null,
    lastError: null,
  };

  function snapshot() {
    return {
      config: { ...config },
      status: structuredClone(status),
      running: Boolean(running),
    };
  }

  async function persistStatus() {
    await storage.set(STATUS_KEY, {
      ...status,
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
    });
  }

  function cancelTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    status.nextRunAt = null;
  }

  function schedule(delayMs) {
    cancelTimer();
    if (disposed || !config.enabled) return;
    const safeDelay = Math.max(0, finiteInteger(delayMs, 0));
    status.nextRunAt = now() + safeDelay;
    timer = setTimer(() => {
      timer = null;
      status.nextRunAt = null;
      void runNow('scheduled').catch(() => {});
    }, safeDelay);
  }

  async function runNow(trigger = 'manual') {
    if (disposed) {
      return { skipped: true, reason: 'disposed' };
    }
    if (running) {
      return { skipped: true, reason: 'already-running' };
    }

    cancelTimer();
    const startedAt = now();
    status = {
      ...status,
      state: 'running',
      trigger,
      lastStartedAt: startedAt,
      lastError: null,
    };
    await persistStatus();

    running = (async () => {
      try {
        const summary = await scan();
        status = {
          ...status,
          state: summary.failures?.length || summary.issueCount ? 'warning' : 'idle',
          lastCompletedAt: now(),
          lastSummary: summary,
          lastError: null,
        };
        return summary;
      }
      catch (error) {
        status = {
          ...status,
          state: 'error',
          lastCompletedAt: now(),
          lastError: formatCatalogError(error),
        };
        throw error;
      }
      finally {
        running = null;
        if (config.enabled && !disposed) {
          schedule(config.intervalMinutes * 60_000);
        }
        await persistStatus();
      }
    })();

    return running;
  }

  async function configure(value) {
    config = normalizeAutoRefreshConfig(value);
    await storage.set(CONFIG_KEY, config);
    cancelTimer();
    status = {
      ...status,
      state: config.enabled ? 'idle' : 'disabled',
      nextRunAt: null,
    };
    if (config.enabled && !disposed) {
      schedule(startupDelayMs);
    }
    await persistStatus();
    return snapshot();
  }

  async function initialize() {
    config = normalizeAutoRefreshConfig(await storage.get(CONFIG_KEY));
    const storedStatus = await storage.get(STATUS_KEY);
    if (storedStatus && typeof storedStatus === 'object') {
      status = {
        ...status,
        ...storedStatus,
        state: config.enabled ? 'idle' : 'disabled',
        nextRunAt: null,
      };
    }
    if (config.enabled && !disposed) {
      schedule(startupDelayMs);
    }
    return snapshot();
  }

  function dispose() {
    disposed = true;
    cancelTimer();
  }

  return {
    initialize,
    configure,
    runNow,
    snapshot,
    dispose,
  };
}

export async function configureAutoRefresh(controller) {
  const current = controller.snapshot().config;
  const values = await sigma.ui.showModal({
    title: 'Universal Library automatic refresh',
    layout: 'form',
    content: [
      sigma.ui.alert({
        title: 'Opt-in background indexing',
        description: 'Automatic refresh scans approved roots sequentially and never overlaps an active scan.',
        tone: 'info',
      }),
      sigma.ui.checkbox({
        id: 'enabled',
        label: 'Enable automatic catalog refresh',
        checked: current.enabled,
      }),
      sigma.ui.select({
        id: 'intervalMinutes',
        label: 'Refresh interval',
        value: String(current.intervalMinutes),
        options: [
          { value: '5', label: 'Every 5 minutes' },
          { value: '15', label: 'Every 15 minutes' },
          { value: '30', label: 'Every 30 minutes' },
          { value: '60', label: 'Every hour' },
          { value: '180', label: 'Every 3 hours' },
          { value: '360', label: 'Every 6 hours' },
          { value: '720', label: 'Every 12 hours' },
          { value: '1440', label: 'Daily' },
        ],
      }),
    ],
    buttons: [
      { id: 'cancel', label: 'Cancel', variant: 'secondary' },
      { id: 'save', label: 'Save', variant: 'primary' },
    ],
  });
  if (!values) return null;
  const next = await controller.configure({
    enabled: values.enabled === true,
    intervalMinutes: values.intervalMinutes,
  });
  sigma.ui.showNotification({
    title: next.config.enabled
      ? 'Automatic Universal Library refresh enabled'
      : 'Automatic Universal Library refresh disabled',
    description: next.config.enabled
      ? `Approved folders will refresh every ${next.config.intervalMinutes} minute(s).`
      : 'Folders will only be indexed when you run a manual scan.',
    type: 'success',
  });
  return next;
}

export async function runAutoRefreshNow(controller) {
  try {
    const summary = await controller.runNow('manual');
    if (summary.skipped) {
      sigma.ui.showNotification({
        title: 'Universal Library refresh already running',
        description: 'The existing scan will finish before another refresh can start.',
        type: 'info',
      });
      return summary;
    }
    sigma.ui.showNotification({
      title: 'Universal Library refresh complete',
      description: `${summary.filesSeen} file(s) scanned, ${summary.issueCount} issue(s), ${summary.failures.length} failed root(s).`,
      type: summary.issueCount || summary.failures.length ? 'warning' : 'success',
      duration: 8000,
    });
    return summary;
  }
  catch (error) {
    sigma.ui.showNotification({
      title: 'Universal Library refresh failed',
      description: formatCatalogError(error),
      type: 'error',
      duration: 8000,
    });
    return null;
  }
}

export async function showAutoRefreshStatus(controller) {
  const current = controller.snapshot();
  const { config, status } = current;
  await sigma.ui.showDialog({
    title: 'Universal Library automatic refresh',
    type: status.state === 'error' ? 'error' : 'info',
    confirmText: 'Close',
    message: [
      `Enabled: ${config.enabled ? 'yes' : 'no'}`,
      `Interval: ${config.intervalMinutes} minute(s)`,
      `State: ${status.state}`,
      `Running: ${current.running ? 'yes' : 'no'}`,
      `Last started: ${status.lastStartedAt ? new Date(status.lastStartedAt).toLocaleString() : 'never'}`,
      `Last completed: ${status.lastCompletedAt ? new Date(status.lastCompletedAt).toLocaleString() : 'never'}`,
      `Next run: ${status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : 'not scheduled'}`,
      `Last error: ${status.lastError ?? 'none'}`,
    ].join('\n'),
  });
}
