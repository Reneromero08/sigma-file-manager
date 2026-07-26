import {
  addSelectedEntriesToCollection,
  configureCatalog,
  configureCatalogDatabasePath,
  scanLibraryRoots,
  showCatalogBrowser,
  showCatalogHealth,
  tagSelectedEntries,
  useDefaultCatalogDatabase,
} from './catalog-bridge.js';
import {
  clearCatalogExecutableOverride,
  formatCatalogError,
  runCatalog,
} from './catalog-client.js';
import { handleWorkspaceRequest } from './workspace-provider.js';

const ROOTS_KEY = 'library-roots';
const SEED_ENTRIES_KEY = 'seed-entries';
const CATALOG_VERSION_KEY = 'catalog-schema-version';

/** @type {{ dispose(): void }[]} */
const disposables = [];

function t(key, fallback, params) {
  return sigma.i18n.extensionT(key, params, fallback);
}

function normalizePath(value) {
  if (!value) return '';
  const separator = sigma.platform.pathSeparator;
  const duplicateSeparators = new RegExp(`${separator === '\\' ? '\\\\' : separator}{2,}`, 'g');
  const normalized = value.replace(duplicateSeparators, separator);
  return normalized.length > 1 && normalized.endsWith(separator)
    ? normalized.slice(0, -1)
    : normalized;
}

async function readArray(key) {
  const value = await sigma.storage.get(key);
  return Array.isArray(value) ? value : [];
}

async function addLibraryRoot() {
  const result = await sigma.fs.scoped.requestDirectoryAccess({
    permission: 'read',
    title: t('dialogs.addRootTitle', 'Choose a folder to add to Universal Library'),
  });

  if (!result.granted || !result.path) return;

  const path = normalizePath(result.path);
  const roots = await readArray(ROOTS_KEY);
  const existing = roots.find(root => normalizePath(root.path) === path);

  if (!existing) {
    roots.push({
      path,
      displayName: sigma.path.basename(path) || path,
      addedAt: Date.now(),
      permissions: result.permissions ?? ['read'],
    });
    await sigma.storage.set(ROOTS_KEY, roots);
  }

  sigma.ui.showNotification({
    title: t('notifications.rootAddedTitle', 'Universal Library root ready'),
    description: existing
      ? t('notifications.rootAlreadyAdded', '{path} was already registered.', { path })
      : t('notifications.rootAdded', '{path} can now be indexed without moving files.', { path }),
    type: existing ? 'info' : 'success',
  });
}

async function showLibraryRoots() {
  const storedRoots = await readArray(ROOTS_KEY);
  const grants = await sigma.fs.scoped.getDirectories();
  const grantedPaths = new Set(grants.map(grant => normalizePath(grant.path)));

  const lines = storedRoots.map((root, index) => {
    const path = normalizePath(root.path);
    const state = grantedPaths.has(path)
      ? t('roots.granted', 'granted')
      : t('roots.missingGrant', 'permission must be renewed');
    return `${index + 1}. ${root.displayName ?? sigma.path.basename(path)}\n${path}\n${state}`;
  });

  await sigma.ui.showDialog({
    title: t('dialogs.rootsTitle', 'Universal Library roots'),
    message: lines.length > 0
      ? lines.join('\n\n')
      : t('dialogs.noRoots', 'No folders are registered yet.'),
    type: 'info',
    confirmText: t('common.close', 'Close'),
  });
}

async function addSelectedEntries(context) {
  const selectedEntries = context?.selectedEntries ?? sigma.context.getSelectedEntries();

  if (!selectedEntries.length) {
    sigma.ui.showNotification({
      title: t('notifications.nothingSelectedTitle', 'Nothing selected'),
      description: t('notifications.nothingSelected', 'Select one or more files or folders first.'),
      type: 'warning',
    });
    return;
  }

  const existingEntries = await readArray(SEED_ENTRIES_KEY);
  const byPath = new Map(existingEntries.map(entry => [normalizePath(entry.path), entry]));
  const queuedAt = Date.now();

  for (const entry of selectedEntries) {
    const path = normalizePath(entry.path);
    const existing = byPath.get(path);
    byPath.set(path, {
      ...existing,
      path,
      name: entry.name,
      isDirectory: Boolean(entry.isDirectory),
      extension: entry.extension ?? null,
      size: entry.size ?? null,
      createdAt: entry.createdAt ?? null,
      modifiedAt: entry.modifiedAt ?? null,
      queuedAt: existing?.queuedAt ?? queuedAt,
      lastQueuedAt: queuedAt,
    });
  }

  await sigma.storage.set(SEED_ENTRIES_KEY, [...byPath.values()]);

  sigma.ui.showNotification({
    title: t('notifications.entriesAddedTitle', 'Added to Universal Library queue'),
    description: t(
      'notifications.entriesAdded',
      '{count} selected item(s) were recorded without moving or copying them.',
      { count: selectedEntries.length },
    ),
    type: 'success',
  });
}

async function copySelectedEntries() {
  const selectedEntries = sigma.context.getSelectedEntries();

  if (!selectedEntries.length) {
    sigma.ui.showNotification({
      title: t('notifications.nothingSelectedTitle', 'Nothing selected'),
      description: t('notifications.nothingSelected', 'Select one or more files or folders first.'),
      type: 'warning',
    });
    return;
  }

  await sigma.ui.clipboardWriteFiles(selectedEntries.map(entry => entry.path), 'copy');
  sigma.ui.showNotification({
    title: t('notifications.copiedTitle', 'Copied for another application'),
    description: t(
      'notifications.copied',
      '{count} item(s) are available on the native file clipboard.',
      { count: selectedEntries.length },
    ),
    type: 'success',
  });
}

async function useManagedCatalogExecutable() {
  try {
    const managedPath = await clearCatalogExecutableOverride();
    if (!managedPath) {
      sigma.ui.showNotification({
        title: t('catalog.managedUnavailableTitle', 'Managed catalog is unavailable'),
        description: t(
          'catalog.managedUnavailableDescription',
          'Reinstall or update the Universal Library extension, or choose a custom catalog executable.',
        ),
        type: 'warning',
      });
      return;
    }

    const health = await runCatalog(['health'], { promptForExecutable: false });
    sigma.ui.showNotification({
      title: t('catalog.managedEnabledTitle', 'Using the managed Universal Library catalog'),
      description: t(
        'catalog.managedEnabledDescription',
        'Schema {version} is ready at {path}.',
        { version: health.schemaVersion, path: health.databasePath },
      ),
      type: 'success',
    });
  }
  catch (error) {
    sigma.ui.showNotification({
      title: t('catalog.managedFailedTitle', 'Could not use the managed catalog'),
      description: formatCatalogError(error),
      type: 'error',
      duration: 8000,
    });
  }
}

async function browseAssetsCommand(options) {
  if (options?.workspace === true) {
    return handleWorkspaceRequest(options);
  }
  return showCatalogBrowser();
}

function registerCommand(id, title, handler, description) {
  disposables.push(
    sigma.commands.registerCommand(
      { id, title, ...(description ? { description } : {}) },
      handler,
    ),
  );
}

export async function activate() {
  try {
    await sigma.i18n.mergeFromPath('locales');
  }
  catch {
    // English fallbacks keep the extension usable while locale files are incomplete.
  }

  await sigma.storage.set(CATALOG_VERSION_KEY, 1);

  disposables.push(
    sigma.sidebar.registerPage({
      id: 'library',
      title: t('sidebar.title', 'Universal Library'),
      icon: 'library-big',
      order: 25,
      url: 'ui/workspace.js',
    }),
  );

  registerCommand(
    'add-root',
    t('commands.addRoot', 'Universal Library: Add folder'),
    addLibraryRoot,
    t('commands.addRootDescription', 'Grant read-only access to a folder without importing it.'),
  );
  registerCommand(
    'show-roots',
    t('commands.showRoots', 'Universal Library: Show folders'),
    showLibraryRoots,
  );
  registerCommand(
    'add-selected',
    t('commands.addSelected', 'Universal Library: Add selected items'),
    () => addSelectedEntries(),
    t('commands.addSelectedDescription', 'Record selected paths without moving or copying files.'),
  );
  registerCommand(
    'copy-selected',
    t('commands.copySelected', 'Universal Library: Copy selected items'),
    copySelectedEntries,
    t('commands.copySelectedDescription', 'Place selected paths on the native file clipboard.'),
  );
  registerCommand(
    'configure-catalog',
    t('commands.configureCatalog', 'Universal Library: Choose custom catalog executable'),
    configureCatalog,
  );
  registerCommand(
    'use-managed-catalog',
    t('commands.useManagedCatalog', 'Universal Library: Use managed catalog executable'),
    useManagedCatalogExecutable,
  );
  registerCommand(
    'configure-database',
    t('commands.configureDatabase', 'Universal Library: Choose catalog database'),
    configureCatalogDatabasePath,
  );
  registerCommand(
    'use-default-database',
    t('commands.useDefaultDatabase', 'Universal Library: Use default catalog database'),
    useDefaultCatalogDatabase,
  );
  registerCommand(
    'catalog-health',
    t('commands.catalogHealth', 'Universal Library: Show catalog status'),
    showCatalogHealth,
  );
  registerCommand(
    'scan-roots',
    t('commands.scanRoots', 'Universal Library: Index all folders'),
    scanLibraryRoots,
  );
  registerCommand(
    'browse-assets',
    t('commands.browseAssets', 'Universal Library: Browse indexed assets'),
    browseAssetsCommand,
  );
  registerCommand(
    'tag-selected',
    t('commands.tagSelected', 'Universal Library: Tag selected files'),
    tagSelectedEntries,
  );
  registerCommand(
    'add-selected-to-collection',
    t('commands.addSelectedToCollection', 'Universal Library: Add selected files to collection'),
    addSelectedEntriesToCollection,
  );

  disposables.push(
    sigma.contextMenu.registerItem(
      {
        id: 'add-selected',
        title: t('contextMenu.addSelected', 'Add to Universal Library'),
        icon: 'library-big',
        group: 'universal-library',
        order: 10,
        when: { selectionType: 'any', entryType: 'any' },
      },
      addSelectedEntries,
    ),
    sigma.contextMenu.registerItem(
      {
        id: 'tag-selected',
        title: t('contextMenu.tagSelected', 'Tag in Universal Library'),
        icon: 'tag',
        group: 'universal-library',
        order: 20,
        when: { selectionType: 'any', entryType: 'file' },
      },
      tagSelectedEntries,
    ),
    sigma.contextMenu.registerItem(
      {
        id: 'add-selected-to-collection',
        title: t('contextMenu.addToCollection', 'Add to Universal Library collection'),
        icon: 'library-big',
        group: 'universal-library',
        order: 30,
        when: { selectionType: 'any', entryType: 'file' },
      },
      addSelectedEntriesToCollection,
    ),
  );
}

export function deactivate() {
  while (disposables.length) {
    disposables.pop()?.dispose();
  }
}
