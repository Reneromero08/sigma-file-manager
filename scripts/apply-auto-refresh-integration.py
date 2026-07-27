from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    return text.replace(old, new, 1)


index_path = Path('universal-library/extension/src/index.js')
index_text = index_path.read_text(encoding='utf-8')
index_text = replace_once(
    index_text,
    "import { handleWorkspaceRequest } from './workspace-provider.js';\n",
    """import { handleWorkspaceRequest } from './workspace-provider.js';
import {
  configureAutoRefresh,
  createAutoRefreshController,
  runAutoRefreshNow,
  showAutoRefreshStatus,
} from './auto-refresh.js';
""",
    'auto-refresh imports',
)
index_text = replace_once(
    index_text,
    "const disposables = [];\n",
    "const disposables = [];\nlet autoRefreshController = null;\n",
    'controller storage',
)
index_text = replace_once(
    index_text,
    "  await sigma.storage.set(CATALOG_VERSION_KEY, 1);\n",
    """  await sigma.storage.set(CATALOG_VERSION_KEY, 1);
  autoRefreshController = createAutoRefreshController();
  await autoRefreshController.initialize();
""",
    'controller initialization',
)
index_text = replace_once(
    index_text,
    """  registerCommand(
    'browse-assets',
""",
    """  registerCommand(
    'configure-auto-refresh',
    t('commands.configureAutoRefresh', 'Universal Library: Configure automatic refresh'),
    () => configureAutoRefresh(autoRefreshController),
  );
  registerCommand(
    'run-auto-refresh-now',
    t('commands.runAutoRefreshNow', 'Universal Library: Run automatic refresh now'),
    () => runAutoRefreshNow(autoRefreshController),
  );
  registerCommand(
    'auto-refresh-status',
    t('commands.autoRefreshStatus', 'Universal Library: Show automatic refresh status'),
    () => showAutoRefreshStatus(autoRefreshController),
  );
  registerCommand(
    'browse-assets',
""",
    'auto-refresh commands',
)
index_text = replace_once(
    index_text,
    """export function deactivate() {
  while (disposables.length) {
""",
    """export function deactivate() {
  autoRefreshController?.dispose();
  autoRefreshController = null;
  while (disposables.length) {
""",
    'controller disposal',
)
index_path.write_text(index_text, encoding='utf-8')

bootstrap_path = Path('universal-library/extension/tests/bootstrap.node.mjs')
bootstrap_text = bootstrap_path.read_text(encoding='utf-8')
bootstrap_text = replace_once(
    bootstrap_text,
    """    async clipboardWriteFiles(paths, operation) {
      clipboardWrites.push({ paths, operation });
    },
""",
    """    async clipboardWriteFiles(paths, operation) {
      clipboardWrites.push({ paths, operation });
    },
    async showModal() {
      return null;
    },
    alert(options) {
      return { type: 'alert', ...options };
    },
    checkbox(options) {
      return { type: 'checkbox', ...options };
    },
    select(options) {
      return { type: 'select', ...options };
    },
""",
    'bootstrap UI mocks',
)
bootstrap_text = replace_once(
    bootstrap_text,
    """      'add-selected-to-collection',
      'browse-assets',
      'catalog-health',
""",
    """      'add-selected-to-collection',
      'auto-refresh-status',
      'browse-assets',
      'catalog-health',
      'configure-auto-refresh',
""",
    'bootstrap auto-refresh commands first half',
)
bootstrap_text = replace_once(
    bootstrap_text,
    """      'copy-selected',
      'scan-roots',
      'show-roots',
""",
    """      'copy-selected',
      'run-auto-refresh-now',
      'scan-roots',
      'show-roots',
""",
    'bootstrap auto-refresh commands second half',
)
bootstrap_path.write_text(bootstrap_text, encoding='utf-8')
