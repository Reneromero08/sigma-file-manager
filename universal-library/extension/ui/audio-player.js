function createInitialState() {
  return {
    assetId: null,
    path: null,
    status: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 1,
    error: null,
  };
}

function finiteOrZero(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function createAuditionController(options) {
  const {
    resolveUrl,
    createAudio = () => document.createElement('audio'),
    onChange = () => {},
  } = options;
  if (typeof resolveUrl !== 'function') {
    throw new TypeError('resolveUrl must be a function');
  }

  const audio = createAudio();
  audio.preload = 'metadata';
  let state = createInitialState();
  let generation = 0;

  function snapshot() {
    return { ...state };
  }

  function publish(updates = {}) {
    state = { ...state, ...updates };
    onChange(snapshot());
  }

  function currentAssetMatches(asset) {
    return Boolean(asset?.id && state.assetId === asset.id);
  }

  function onLoadedMetadata() {
    publish({
      duration: finiteOrZero(audio.duration),
      currentTime: finiteOrZero(audio.currentTime),
    });
  }

  function onTimeUpdate() {
    publish({
      currentTime: finiteOrZero(audio.currentTime),
      duration: finiteOrZero(audio.duration),
    });
  }

  function onPlay() {
    publish({ status: 'playing', error: null });
  }

  function onPause() {
    if (state.status !== 'ended' && state.status !== 'idle') {
      publish({ status: 'paused' });
    }
  }

  function onEnded() {
    publish({
      status: 'ended',
      currentTime: finiteOrZero(audio.duration),
    });
  }

  function onError() {
    publish({
      status: 'error',
      error: audio.error?.message ?? 'The audio preview could not be played.',
    });
  }

  audio.addEventListener('loadedmetadata', onLoadedMetadata);
  audio.addEventListener('timeupdate', onTimeUpdate);
  audio.addEventListener('play', onPlay);
  audio.addEventListener('pause', onPause);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);

  async function loadAsset(asset) {
    if (!asset?.id || !asset?.primaryPath) {
      throw new Error('An online audio asset is required for audition.');
    }

    const requestGeneration = ++generation;
    audio.pause();
    publish({
      assetId: asset.id,
      path: asset.primaryPath,
      status: 'loading',
      currentTime: 0,
      duration: finiteOrZero(asset.audioAnalysis?.durationMs) / 1000,
      error: null,
    });

    const resolved = await resolveUrl(asset);
    if (requestGeneration !== generation) {
      return false;
    }
    const url = typeof resolved === 'string' ? resolved : resolved?.url;
    if (typeof url !== 'string' || !url) {
      throw new Error('The audio preview URL was not available.');
    }

    audio.src = url;
    audio.currentTime = 0;
    audio.load?.();
    return true;
  }

  async function toggle(asset) {
    if (currentAssetMatches(asset) && state.status === 'playing') {
      audio.pause();
      return snapshot();
    }

    if (!currentAssetMatches(asset) || !audio.src) {
      const loaded = await loadAsset(asset);
      if (!loaded) return snapshot();
    }

    try {
      await audio.play();
    }
    catch (error) {
      publish({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return snapshot();
  }

  function pause() {
    audio.pause();
  }

  function stop() {
    generation += 1;
    audio.pause();
    audio.removeAttribute?.('src');
    audio.load?.();
    state = createInitialState();
    onChange(snapshot());
  }

  function seekRatio(ratio) {
    const duration = finiteOrZero(audio.duration || state.duration);
    if (!duration) return snapshot();
    const boundedRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
    audio.currentTime = duration * boundedRatio;
    publish({ currentTime: audio.currentTime, duration });
    return snapshot();
  }

  function setVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value) || 0));
    audio.volume = volume;
    publish({ volume });
    return snapshot();
  }

  function dispose() {
    stop();
    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    audio.removeEventListener('timeupdate', onTimeUpdate);
    audio.removeEventListener('play', onPlay);
    audio.removeEventListener('pause', onPause);
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('error', onError);
  }

  return {
    audio,
    snapshot,
    toggle,
    pause,
    stop,
    seekRatio,
    setVolume,
    dispose,
  };
}
