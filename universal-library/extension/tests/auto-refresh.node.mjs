import assert from 'node:assert/strict';
import test from 'node:test';

const stored = new Map();

globalThis.sigma = {
  storage: {
    async get(key) {
      return stored.get(key);
    },
    async set(key, value) {
      stored.set(key, structuredClone(value));
    },
  },
  path: {
    basename(path) {
      return path.split('/').filter(Boolean).at(-1) ?? path;
    },
  },
};

const {
  createAutoRefreshController,
  normalizeAutoRefreshConfig,
  scanRootsInBackground,
} = await import('../src/auto-refresh.js');

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    entries() {
      return [...timers.entries()];
    },
    async fire(id) {
      const timer = timers.get(id);
      timers.delete(id);
      timer.callback();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('normalizes disabled defaults and clamps refresh intervals', () => {
  assert.deepEqual(normalizeAutoRefreshConfig(), {
    enabled: false,
    intervalMinutes: 30,
  });
  assert.deepEqual(normalizeAutoRefreshConfig({ enabled: true, intervalMinutes: 1 }), {
    enabled: true,
    intervalMinutes: 5,
  });
  assert.deepEqual(normalizeAutoRefreshConfig({ enabled: true, intervalMinutes: 99_999 }), {
    enabled: true,
    intervalMinutes: 1440,
  });
});

test('stays disabled by default without scheduling a timer', async () => {
  stored.clear();
  const timers = fakeTimers();
  const controller = createAutoRefreshController({
    storage: sigma.storage,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const state = await controller.initialize();
  assert.equal(state.config.enabled, false);
  assert.equal(state.status.state, 'disabled');
  assert.equal(timers.entries().length, 0);
  controller.dispose();
});

test('enables an opt-in startup scan and reschedules after completion', async () => {
  stored.clear();
  const timers = fakeTimers();
  let currentTime = 1_000;
  let scans = 0;
  const controller = createAutoRefreshController({
    storage: sigma.storage,
    scan: async () => {
      scans += 1;
      return {
        rootCount: 1,
        reports: [],
        failures: [],
        filesSeen: 12,
        issueCount: 0,
      };
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => currentTime,
    startupDelayMs: 250,
  });

  await controller.configure({ enabled: true, intervalMinutes: 15 });
  const [[startupId, startup]] = timers.entries();
  assert.equal(startup.delay, 250);
  assert.equal(controller.snapshot().status.nextRunAt, 1_250);

  currentTime = 1_250;
  await timers.fire(startupId);
  assert.equal(scans, 1);
  assert.equal(controller.snapshot().status.lastSummary.filesSeen, 12);
  const [[, scheduled]] = timers.entries();
  assert.equal(scheduled.delay, 15 * 60_000);
  controller.dispose();
});

test('suppresses overlapping refreshes and preserves one scan', async () => {
  stored.clear();
  const pending = deferred();
  let scans = 0;
  const controller = createAutoRefreshController({
    storage: sigma.storage,
    scan: async () => {
      scans += 1;
      return pending.promise;
    },
  });

  const first = controller.runNow('manual');
  const second = await controller.runNow('manual');
  assert.deepEqual(second, { skipped: true, reason: 'already-running' });
  assert.equal(scans, 1);

  pending.resolve({
    rootCount: 1,
    reports: [],
    failures: [],
    filesSeen: 3,
    issueCount: 0,
  });
  await first;
  assert.equal(controller.snapshot().running, false);
  controller.dispose();
});

test('records failures, persists status, and clears scheduled work on disposal', async () => {
  stored.clear();
  const timers = fakeTimers();
  const controller = createAutoRefreshController({
    storage: sigma.storage,
    scan: async () => {
      throw new Error('drive unavailable');
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    startupDelayMs: 10,
  });

  await controller.configure({ enabled: true, intervalMinutes: 5 });
  await assert.rejects(controller.runNow('manual'), /drive unavailable/);
  const state = controller.snapshot();
  assert.equal(state.status.state, 'error');
  assert.match(state.status.lastError, /drive unavailable/);
  assert.match(stored.get('catalog-auto-refresh-status').lastError, /drive unavailable/);
  assert.equal(timers.entries().length, 1);

  controller.dispose();
  assert.equal(timers.entries().length, 0);
});

test('scans roots sequentially and isolates per-root failures', async () => {
  stored.clear();
  stored.set('library-roots', [
    { path: '/samples', displayName: 'Samples' },
    { path: '/archive', displayName: 'Archive' },
  ]);
  const events = [];
  const result = await scanRootsInBackground({
    storage: sigma.storage,
    addRoot: async (args) => {
      events.push(['add', args[2]]);
    },
    startScan: async (args) => {
      events.push(['scan', args[2]]);
      if (args[2] === '/archive') throw new Error('offline');
      return {
        result: Promise.resolve({ filesSeen: 25, issueCount: 1 }),
      };
    },
  });

  assert.deepEqual(events, [
    ['add', '/samples'],
    ['scan', '/samples'],
    ['add', '/archive'],
    ['scan', '/archive'],
  ]);
  assert.equal(result.filesSeen, 25);
  assert.equal(result.issueCount, 1);
  assert.equal(result.failures.length, 1);
});
