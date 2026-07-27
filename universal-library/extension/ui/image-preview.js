const PREVIEWABLE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'webp',
]);

function extensionFromPath(path) {
  if (typeof path !== 'string') return '';
  const name = path.split(/[\\/]/).at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLocaleLowerCase() : '';
}

export function isPreviewableImage(asset) {
  return Boolean(
    asset?.mediaKind === 'image'
      && asset?.isOnline
      && asset?.primaryPath
      && PREVIEWABLE_EXTENSIONS.has(extensionFromPath(asset.primaryPath)),
  );
}

export function createImagePreviewLoader(options) {
  const {
    resolveUrl,
    concurrency = 4,
  } = options;
  if (typeof resolveUrl !== 'function') {
    throw new TypeError('resolveUrl must be a function');
  }

  const limit = Math.min(12, Math.max(1, Math.trunc(Number(concurrency) || 4)));
  const cache = new Map();
  const queue = [];
  let active = 0;
  let disposed = false;

  function pump() {
    while (!disposed && active < limit && queue.length) {
      const task = queue.shift();
      active += 1;
      Promise.resolve()
        .then(() => resolveUrl(task.asset))
        .then((result) => {
          const url = typeof result === 'string' ? result : result?.url;
          if (typeof url !== 'string' || !url) {
            throw new Error('The image preview URL was not available.');
          }
          task.resolve(url);
        })
        .catch(task.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  function request(asset) {
    if (disposed) return Promise.reject(new Error('The image preview loader is disposed.'));
    if (!isPreviewableImage(asset)) return Promise.resolve(null);
    const key = `${asset.id}:${asset.primaryPath}`;
    const existing = cache.get(key);
    if (existing) return existing;

    const pending = new Promise((resolve, reject) => {
      queue.push({ asset, resolve, reject });
      pump();
    });
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  }

  function dispose() {
    disposed = true;
    const error = new Error('The image preview loader is disposed.');
    while (queue.length) queue.shift().reject(error);
    cache.clear();
  }

  return {
    request,
    dispose,
    stats() {
      return {
        active,
        queued: queue.length,
        cached: cache.size,
        concurrency: limit,
      };
    },
  };
}
