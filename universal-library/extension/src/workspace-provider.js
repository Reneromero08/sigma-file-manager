import { runCatalog } from './catalog-client.js';

function boundedLimit(value, fallback = 300, maximum = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(parsed)));
}

function boundedWaveformPoints(value) {
  return Math.max(32, boundedLimit(value, 256, 2048));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

async function optionalCatalog(args, fallback) {
  try {
    return await runCatalog(args, { promptForExecutable: false });
  }
  catch {
    return fallback;
  }
}

async function queryAssets(request) {
  const args = ['asset', 'list', '--limit', String(boundedLimit(request.limit, 300, 1000))];
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
  const [health, assets, collections, tags, audioAnalyses] = await Promise.all([
    runCatalog(['health']),
    queryAssets(request),
    runCatalog(['collection', 'list']),
    runCatalog(['tag', 'list']),
    optionalCatalog(['audio', 'list', '--limit', '10000'], []),
  ]);

  return {
    health,
    assets,
    collections,
    tags,
    audioAnalyses,
    generatedAt: Date.now(),
  };
}

async function getCollectionItems(request) {
  const collection = requiredString(request.collection, 'Collection');
  return runCatalog(['collection', 'items', collection]);
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

async function analyzeAudio(request) {
  const asset = requiredString(request.asset, 'Audio asset');
  return runCatalog([
    'audio',
    'analyze',
    asset,
    '--points',
    String(boundedWaveformPoints(request.points)),
  ]);
}

async function analyzeMissingAudio(request) {
  return runCatalog([
    'audio',
    'analyze-missing',
    '--limit',
    String(boundedLimit(request.limit, 500, 10_000)),
    '--points',
    String(boundedWaveformPoints(request.points)),
  ]);
}

async function getAssetUrl(request, label = 'Asset path') {
  const path = requiredString(request.path, label);
  const url = await sigma.fs.scoped.toAssetUrl(path);
  return { path, url };
}

export async function handleWorkspaceRequest(request = {}) {
  switch (request.action) {
    case 'snapshot':
      return getSnapshot(request);
    case 'collection-items':
      return getCollectionItems(request);
    case 'tag-asset':
      return tagAsset(request);
    case 'add-to-collection':
      return addAssetToCollection(request);
    case 'create-collection':
      return createCollection(request);
    case 'analyze-audio':
      return analyzeAudio(request);
    case 'analyze-missing-audio':
      return analyzeMissingAudio(request);
    case 'asset-url':
      return getAssetUrl(request);
    case 'audio-url':
      return getAssetUrl(request, 'Audio path');
    default:
      throw new Error(`Unknown Universal Library workspace action: ${request.action ?? 'missing'}`);
  }
}
