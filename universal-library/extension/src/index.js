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
      url: 'ui/index.html',
    }),
    sigma.commands.registerCommand(
      {
        id: 'add-root',
        title: t('commands.addRoot', 'Universal Library: Add folder'),
        description: t('commands.addRootDescription', 'Grant read-only access to a folder without importing it.'),
      },
      addLibraryRoot,
    ),
    sigma.commands.registerCommand(
      {
        id: 'show-roots',
        title: t('commands.showRoots', 'Universal Library: Show folders'),
      },
      showLibraryRoots,
    ),
    sigma.commands.registerCommand(
      {
        id: 'add-selected',
        title: t('commands.addSelected', 'Universal Library: Add selected items'),
        description: t('commands.addSelectedDescription', 'Record selected paths without moving or copying files.'),
      },
      () => addSelectedEntries(),
    ),
    sigma.commands.registerCommand(
      {
        id: 'copy-selected',
        title: t('commands.copySelected', 'Universal Library: Copy selected items'),
        description: t('commands.copySelectedDescription', 'Place selected paths on the native file clipboard.'),
      },
      copySelectedEntries,
    ),
    sigma.contextMenu.registerItem(
      {
        id: 'add-selected',
        title: t('contextMenu.addSelected', 'Add to Universal Library'),
        icon: 'library-big',
        group: 'universal-library',
        order: 10,
        when: {
          selectionType: 'any',
          entryType: 'any',
        },
      },
      addSelectedEntries,
    ),
  );
}

export function deactivate() {
  while (disposables.length) {
    disposables.pop()?.dispose();
  }
}
