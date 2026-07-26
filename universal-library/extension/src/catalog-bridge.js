import {
  clearCatalogDatabaseOverride,
  configureCatalogDatabase,
  configureCatalogExecutable,
  formatCatalogError,
  getCatalogConfiguration,
  runCatalog,
  startCatalog,
} from './catalog-client.js';

const ROOTS_KEY = 'library-roots';
const MEDIA_FILTERS = [
  { value: 'all', label: 'All media' },
  { value: 'audio', label: 'Audio' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'design', label: 'Design files' },
  { value: 'project', label: 'Projects' },
  { value: 'document', label: 'Documents' },
  { value: 'font', label: 'Fonts' },
  { value: 'archive', label: 'Archives' },
  { value: 'code', label: 'Code' },
  { value: 'other', label: 'Other' },
];

function t(key, fallback, params) {
  return sigma.i18n.extensionT(key, params, fallback);
}

async function readArray(key) {
  const value = await sigma.storage.get(key);
  return Array.isArray(value) ? value : [];
}

function selectedFiles() {
  return sigma.context.getSelectedEntries().filter(entry => !entry.isDirectory);
}

function showError(error, title = 'Universal Library catalog error') {
  sigma.ui.showNotification({
    title,
    description: formatCatalogError(error),
    type: 'error',
    duration: 8000,
  });
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function assetDetail(asset) {
  if (!asset) {
    return {
      detail: null,
      detailFields: [],
    };
  }

  return {
    detail: asset.primaryPath
      ? { type: 'files', filePaths: [asset.primaryPath] }
      : { type: 'empty' },
    detailFields: [
      { label: 'Type', value: asset.mediaKind },
      { label: 'Size', value: formatBytes(asset.sizeBytes) },
      { label: 'State', value: asset.isOnline ? 'Online' : 'Offline' },
      { label: 'Path', value: asset.primaryPath ?? 'No current location' },
      { label: 'Asset ID', value: asset.id },
    ],
  };
}

export async function configureCatalog() {
  try {
    const executablePath = await configureCatalogExecutable();
    if (!executablePath) return;
    const health = await runCatalog(['health'], { promptForExecutable: false });
    sigma.ui.showNotification({
      title: t('catalog.configuredTitle', 'Universal Library catalog connected'),
      description: t(
        'catalog.configuredDescription',
        'Schema {version} is ready at {path}.',
        { version: health.schemaVersion, path: health.databasePath },
      ),
      type: 'success',
    });
  }
  catch (error) {
    showError(error, t('catalog.configureFailed', 'Could not connect the catalog'));
  }
}

export async function configureCatalogDatabasePath() {
  try {
    const databasePath = await configureCatalogDatabase();
    if (!databasePath) return;
    const health = await runCatalog(['health']);
    sigma.ui.showNotification({
      title: t('catalog.databaseConfiguredTitle', 'Catalog database selected'),
      description: health.databasePath,
      type: 'success',
    });
  }
  catch (error) {
    showError(error, t('catalog.databaseFailed', 'Could not use that catalog database'));
  }
}

export async function useDefaultCatalogDatabase() {
  try {
    await clearCatalogDatabaseOverride();
    const health = await runCatalog(['health']);
    sigma.ui.showNotification({
      title: t('catalog.defaultDatabaseTitle', 'Using the default catalog database'),
      description: health.databasePath,
      type: 'success',
    });
  }
  catch (error) {
    showError(error);
  }
}

export async function showCatalogHealth() {
  try {
    const configuration = await getCatalogConfiguration();
    const health = await runCatalog(['health']);
    await sigma.ui.showDialog({
      title: t('catalog.healthTitle', 'Universal Library catalog'),
      type: 'info',
      confirmText: t('common.close', 'Close'),
      message: [
        `Status: ${health.status}`,
        `Schema: ${health.schemaVersion}`,
        `Roots: ${health.rootCount}`,
        `Collections: ${health.collectionCount}`,
        `Database: ${health.databasePath}`,
        `Executable: ${configuration.executablePath}`,
      ].join('\n'),
    });
  }
  catch (error) {
    showError(error);
  }
}

export async function scanLibraryRoots() {
  const roots = await readArray(ROOTS_KEY);
  if (!roots.length) {
    sigma.ui.showNotification({
      title: t('catalog.noRootsTitle', 'No Universal Library folders'),
      description: t('catalog.noRootsDescription', 'Add a folder before running the catalog indexer.'),
      type: 'warning',
    });
    return;
  }

  try {
    const summary = await sigma.ui.withProgress(
      {
        subtitle: t('catalog.scanning', 'Indexing Universal Library folders'),
        location: 'notification',
        cancellable: true,
      },
      async (progress, token) => {
        const reports = [];
        const failures = [];

        for (let index = 0; index < roots.length; index += 1) {
          if (token.isCancellationRequested) break;
          const root = roots[index];
          const name = root.displayName ?? sigma.path.basename(root.path) ?? root.path;
          progress.report({
            value: Math.round((index / roots.length) * 100),
            subtitle: `Indexing ${name}`,
            description: root.path,
          });

          try {
            await runCatalog(['root', 'add', root.path, '--name', name]);
            const task = await startCatalog(['root', 'scan', root.path]);
            const cancellation = token.onCancellationRequested(() => {
              void task.cancel();
            });
            try {
              reports.push(await task.result);
            }
            finally {
              cancellation.dispose();
            }
          }
          catch (error) {
            failures.push({ root: root.path, message: formatCatalogError(error) });
          }
        }

        progress.report({ value: 100, subtitle: 'Indexing complete' });
        return { reports, failures, cancelled: token.isCancellationRequested };
      },
    );

    const files = summary.reports.reduce((total, report) => total + report.filesSeen, 0);
    const issues = summary.reports.reduce((total, report) => total + report.issueCount, 0);
    sigma.ui.showNotification({
      title: summary.cancelled
        ? t('catalog.scanCancelledTitle', 'Universal Library indexing cancelled')
        : t('catalog.scanCompleteTitle', 'Universal Library indexing complete'),
      description: `${files} file(s) indexed, ${issues} scan issue(s), ${summary.failures.length} failed root(s).`,
      type: summary.failures.length || issues ? 'warning' : 'success',
      duration: 8000,
    });
  }
  catch (error) {
    showError(error, t('catalog.scanFailedTitle', 'Universal Library indexing failed'));
  }
}

export async function showCatalogBrowser() {
  const assetsById = new Map();
  let searchQuery = '';
  let filterValue = 'all';
  let requestSequence = 0;

  const modal = sigma.ui.createModal({
    title: t('catalog.browserTitle', 'Universal Library assets'),
    commandTitle: t('catalog.browserCommand', 'Browse indexed assets'),
    width: 1040,
    layout: 'listDetail',
    listDetail: {
      items: [],
      selectedItemId: null,
      searchQuery,
      filterValue,
      filterOptions: MEDIA_FILTERS,
      searchPlaceholder: t('catalog.searchPlaceholder', 'Search file names and paths'),
      detail: null,
      detailFields: [],
      emptyListTitle: t('catalog.emptyAssetsTitle', 'No indexed assets'),
      emptyListDescription: t('catalog.emptyAssetsDescription', 'Index a Universal Library folder or change the search.'),
      emptyDetailTitle: t('catalog.emptyDetailTitle', 'Select an asset'),
      emptyDetailDescription: t('catalog.emptyDetailDescription', 'Its path, type, and online state will appear here.'),
    },
    buttons: [
      { id: 'copy', label: t('catalog.copyAsset', 'Copy file'), variant: 'primary' },
      { id: 'close', label: t('common.close', 'Close'), variant: 'secondary' },
    ],
  });

  async function loadAssets() {
    const requestId = ++requestSequence;
    const args = ['asset', 'list', '--limit', '200'];
    if (searchQuery.trim()) args.push('--query', searchQuery.trim());
    if (filterValue !== 'all') args.push('--kind', filterValue);

    try {
      const assets = await runCatalog(args);
      if (requestId !== requestSequence) return;
      assetsById.clear();
      for (const asset of assets) assetsById.set(asset.id, asset);

      const previousSelection = modal.getListDetail().selectedItemId;
      const selectedItemId = assetsById.has(previousSelection)
        ? previousSelection
        : assets[0]?.id ?? null;
      const selectedAsset = selectedItemId ? assetsById.get(selectedItemId) : null;
      const detail = assetDetail(selectedAsset);

      await modal.setListDetail({
        items: assets.map(asset => ({
          id: asset.id,
          title: asset.canonicalName,
          subtitle: asset.primaryPath ?? 'Offline asset',
          icon: asset.mediaKind === 'image' ? 'image' : asset.mediaKind === 'text' ? 'text' : 'files',
          badge: asset.isOnline ? asset.mediaKind : 'offline',
        })),
        selectedItemId,
        searchQuery,
        filterValue,
        filterOptions: MEDIA_FILTERS,
        ...detail,
      });
    }
    catch (error) {
      if (requestId !== requestSequence) return;
      await modal.setListDetail({
        items: [],
        selectedItemId: null,
        searchQuery,
        filterValue,
        filterOptions: MEDIA_FILTERS,
        detail: null,
        detailFields: [],
        emptyListTitle: 'Catalog query failed',
        emptyListDescription: formatCatalogError(error),
      });
    }
  }

  modal.onSelectionChange(async (itemId) => {
    const asset = itemId ? assetsById.get(itemId) : null;
    await modal.setListDetail({ selectedItemId: itemId, ...assetDetail(asset) });
  });
  modal.onSearchChange(async (value) => {
    searchQuery = value;
    await loadAssets();
  });
  modal.onFilterChange(async (value) => {
    filterValue = value;
    await loadAssets();
  });
  modal.onSubmit(async (_values, buttonId) => {
    if (buttonId === 'close') {
      modal.close();
      return false;
    }
    if (buttonId !== 'copy') return false;

    const selectedId = modal.getListDetail().selectedItemId;
    const asset = selectedId ? assetsById.get(selectedId) : null;
    if (!asset?.primaryPath) {
      sigma.ui.showNotification({
        title: 'Asset is offline',
        description: 'No current file location is available to copy.',
        type: 'warning',
      });
      return false;
    }

    await sigma.ui.clipboardWriteFiles([asset.primaryPath], 'copy');
    sigma.ui.showNotification({
      title: t('notifications.copiedTitle', 'Copied for another application'),
      description: asset.canonicalName,
      type: 'success',
    });
    return false;
  });

  await loadAssets();
}

export async function tagSelectedEntries() {
  const files = selectedFiles();
  if (!files.length) {
    sigma.ui.showNotification({
      title: t('notifications.nothingSelectedTitle', 'Nothing selected'),
      description: t('catalog.selectFilesForTag', 'Select one or more indexed files first.'),
      type: 'warning',
    });
    return;
  }

  const result = await sigma.ui.showDialog({
    title: t('catalog.tagSelectedTitle', 'Tag selected files'),
    message: t('catalog.tagSelectedMessage', 'Enter a tag name to create or reuse.'),
    type: 'prompt',
    confirmText: t('catalog.applyTag', 'Apply tag'),
    cancelText: t('common.cancel', 'Cancel'),
  });
  const tagName = result.confirmed ? result.value?.trim() : '';
  if (!tagName) return;

  try {
    await runCatalog(['tag', 'create', tagName]);
    const failures = [];
    for (const file of files) {
      try {
        await runCatalog(['tag', 'add', file.path, tagName]);
      }
      catch (error) {
        failures.push(`${file.name}: ${formatCatalogError(error)}`);
      }
    }

    sigma.ui.showNotification({
      title: t('catalog.taggedTitle', 'Universal Library tag applied'),
      description: `${files.length - failures.length} file(s) tagged${failures.length ? `; ${failures.length} failed` : ''}.`,
      type: failures.length ? 'warning' : 'success',
    });
  }
  catch (error) {
    showError(error, t('catalog.tagFailedTitle', 'Could not apply the tag'));
  }
}

export async function addSelectedEntriesToCollection() {
  const files = selectedFiles();
  if (!files.length) {
    sigma.ui.showNotification({
      title: t('notifications.nothingSelectedTitle', 'Nothing selected'),
      description: t('catalog.selectFilesForCollection', 'Select one or more indexed files first.'),
      type: 'warning',
    });
    return;
  }

  try {
    const collections = await runCatalog(['collection', 'list']);
    if (!collections.length) {
      sigma.ui.showNotification({
        title: t('catalog.noCollectionsTitle', 'No Universal Library collections'),
        description: t('catalog.noCollectionsDescription', 'Create a collection with the catalog CLI first.'),
        type: 'warning',
      });
      return;
    }

    const values = await sigma.ui.showModal({
      title: t('catalog.addToCollectionTitle', 'Add selected files to a collection'),
      content: [
        sigma.ui.select({
          id: 'collection',
          label: t('catalog.collectionLabel', 'Collection'),
          options: collections.map(collection => ({ value: collection.id, label: collection.name })),
          value: collections[0].id,
        }),
      ],
    });
    const collectionId = values?.collection;
    if (typeof collectionId !== 'string' || !collectionId) return;

    const failures = [];
    for (const file of files) {
      try {
        await runCatalog(['collection', 'add', collectionId, file.path]);
      }
      catch (error) {
        failures.push(`${file.name}: ${formatCatalogError(error)}`);
      }
    }

    const collection = collections.find(item => item.id === collectionId);
    sigma.ui.showNotification({
      title: t('catalog.collectionAddedTitle', 'Added to Universal Library collection'),
      description: `${files.length - failures.length} file(s) added to ${collection?.name ?? 'the collection'}${failures.length ? `; ${failures.length} failed` : ''}.`,
      type: failures.length ? 'warning' : 'success',
    });
  }
  catch (error) {
    showError(error, t('catalog.collectionFailedTitle', 'Could not update the collection'));
  }
}
