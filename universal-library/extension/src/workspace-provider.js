import { runCatalog } from './catalog-client.js';

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 300;
  return Math.min(1000, Math.max(1, Math.trunc(parsed)));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

async function queryAssets(request) {
  const args = ['asset', 'list', '--limit', String(boundedLimit(request.limit))];
  if (typeof request.query === 'string' && request.query.trim()) {
    args.push('--query', request.query.trim());
  }
  if (typeof request.kind === 'string' && request.kind !== 'all' && request.kind.trim()) {
    args.push('--kind', request.kind.trim());
  }
  if (request.includeOffline) {
    args.push('--include-offline');
  }
  return runCatalog(args);
}

async function getSnapshot(request) {
  const [health, assets, collections, tags] = await Promise.all([
    runCatalog(['health']),
    queryAssets(request),
    runCatalog(['collection', 'list']),
    runCatalog(['tag', 'list']),
  ]);

  return {
    health,
    assets,
    collections,
    tags,
    generatedAt: Date.now(),
  };
}

async function tagAsset(request) {
  const asset = requiredString(request.asset, 'Asset path');
  const tag = requiredString(request.tag, 'Tag name');
  await runCatalog(['tag', 'create', tag]);
  return runCatalog(['tag', 'add', asset, tag]);
}

async function addAssetToCollection(request) {
  const asset = requiredString(request.asset, 'Asset path');
  const collection = requiredString(request.collection, 'Collection');
  return runCatalog(['collection', 'add', collection, asset]);
}

async function createCollection(request) {
  const name = requiredString(request.name, 'Collection name');
  return runCatalog(['collection', 'create', name]);
}

export async function handleWorkspaceRequest(request = {}) {
  switch (request.action) {
    case 'snapshot':
      return getSnapshot(request);
    case 'tag-asset':
      return tagAsset(request);
    case 'add-to-collection':
      return addAssetToCollection(request);
    case 'create-collection':
      return createCollection(request);
    default:
      throw new Error(`Unknown Universal Library workspace action: ${request.action ?? 'missing'}`);
  }
}
