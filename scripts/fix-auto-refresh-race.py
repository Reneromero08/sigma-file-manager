from pathlib import Path


module_path = Path('universal-library/extension/src/auto-refresh.js')
text = module_path.read_text(encoding='utf-8')
start = text.index("  async function runNow(trigger = 'manual') {")
end = text.index("  async function configure(value) {", start)
replacement = """  async function runNow(trigger = 'manual') {
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

    const execution = (async () => {
      await persistStatus();
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

    running = execution;
    return execution;
  }

"""
module_path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')

test_path = Path('universal-library/extension/tests/auto-refresh.node.mjs')
test_text = test_path.read_text(encoding='utf-8')
test_text = test_text.replace(
    "  const first = controller.runNow('manual');\n  await new Promise(resolve => setTimeout(resolve, 0));\n  const second = await controller.runNow('manual');",
    "  const first = controller.runNow('manual');\n  const second = await controller.runNow('manual');",
)
test_path.write_text(test_text, encoding='utf-8')
