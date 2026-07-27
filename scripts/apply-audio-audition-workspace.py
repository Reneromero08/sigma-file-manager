from pathlib import Path


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected one marker, found {text.count(old)}')
    return text.replace(old, new, 1)


path = Path('universal-library/extension/ui/workspace.js')
text = path.read_text(encoding='utf-8')

text = replace_once(
    text,
    "} from './audio-ui.js';\n",
    "} from './audio-ui.js';\nimport { createAuditionController } from './audio-player.js';\n",
    'audio player import',
)

text = replace_once(
    text,
    '''    .ul-asset-card.is-selected { border-color: hsl(267 80% 66% / 0.72); box-shadow: 0 0 0 1px hsl(267 80% 66% / 0.3), 0 18px 38px hsl(220 30% 4% / 0.35); }
    .ul-asset-preview {''',
    '''    .ul-asset-card.is-selected { border-color: hsl(267 80% 66% / 0.72); box-shadow: 0 0 0 1px hsl(267 80% 66% / 0.3), 0 18px 38px hsl(220 30% 4% / 0.35); }
    .ul-asset-card.is-playing { border-color: hsl(158 70% 55% / 0.78); box-shadow: 0 0 0 1px hsl(158 70% 55% / 0.24), 0 18px 38px hsl(158 70% 20% / 0.22); }
    .ul-asset-card.is-audio { cursor: pointer; }
    .ul-asset-preview {''',
    'playing card CSS',
)
text = replace_once(
    text,
    '''    .ul-offline-badge { position: absolute; right: 8px; bottom: 8px; padding: 3px 6px; border: 1px solid hsl(2 70% 58% / 0.5); border-radius: 999px; color: hsl(2 80% 76%); background: hsl(2 55% 20% / 0.78); font-size: 8px; text-transform: uppercase; }
    .ul-asset-body {''',
    '''    .ul-offline-badge { position: absolute; right: 8px; bottom: 8px; padding: 3px 6px; border: 1px solid hsl(2 70% 58% / 0.5); border-radius: 999px; color: hsl(2 80% 76%); background: hsl(2 55% 20% / 0.78); font-size: 8px; text-transform: uppercase; }
    .ul-play-indicator { position: absolute; left: 9px; bottom: 8px; display: grid; width: 25px; height: 25px; place-items: center; border: 1px solid hsl(0 0% 100% / 0.18); border-radius: 50%; color: white; background: hsl(220 24% 7% / 0.78); box-shadow: 0 5px 18px hsl(220 35% 2% / 0.45); font-size: 10px; }
    .ul-asset-card.is-playing .ul-play-indicator { color: hsl(158 82% 72%); border-color: hsl(158 70% 55% / 0.45); }
    .ul-asset-body {''',
    'play indicator CSS',
)
text = replace_once(
    text,
    '''    .ul-button:disabled { opacity: 0.45; cursor: not-allowed; }
    .ul-detail-list {''',
    '''    .ul-button:disabled { opacity: 0.45; cursor: not-allowed; }
    .ul-player { display: grid; margin-top: 12px; gap: 8px; }
    .ul-player-row { display: flex; align-items: center; justify-content: space-between; color: var(--ul-muted); font-size: 9px; }
    .ul-slider { width: 100%; accent-color: var(--ul-accent); cursor: pointer; }
    .ul-player-error { color: hsl(2 80% 72%); font-size: 9px; line-height: 1.4; }
    .ul-detail-list {''',
    'player CSS',
)

text = replace_once(
    text,
    '''export async function mount(container, context) {
  const { sigma, toolbarContainer } = context;''',
    '''export async function mount(container, context) {
  const { sigma, toolbarContainer, audioFactory } = context;''',
    'mount context',
)
text = replace_once(
    text,
    '''    error: null,
    compact: await sigma.storage.get('workspace.compact') === true,
    modalMode: null,
  };''',
    '''    error: null,
    compact: await sigma.storage.get('workspace.compact') === true,
    modalMode: null,
    playback: {
      assetId: null,
      status: 'idle',
      currentTime: 0,
      duration: 0,
      volume: 1,
      error: null,
    },
  };''',
    'playback state',
)
text = replace_once(
    text,
    '''  async function execute(request) {
    return sigma.commands.executeCommand('browse-assets', { workspace: true, ...request });
  }

  function currentAssets() {''',
    '''  async function execute(request) {
    return sigma.commands.executeCommand('browse-assets', { workspace: true, ...request });
  }

  const audition = createAuditionController({
    resolveUrl: asset => execute({ action: 'audio-url', path: asset.primaryPath }),
    createAudio: audioFactory,
    onChange(playback) {
      state.playback = playback;
      if (state.snapshot) {
        renderAssets();
        renderInspector();
      }
    },
  });

  async function toggleAudition(asset = selectedAsset()) {
    if (!asset || asset.mediaKind !== 'audio' || !asset.primaryPath) return;
    try {
      await audition.toggle(asset);
    }
    catch (error) {
      sigma.ui.showNotification({
        title: 'Audio preview failed',
        description: error instanceof Error ? error.message : String(error),
        type: 'error',
      });
    }
  }

  function isTypingTarget(target) {
    return target instanceof Element
      && (target.matches('input, select, textarea') || target.closest('[contenteditable="true"]'));
  }

  function currentAssets() {''',
    'audition controller',
)

text = replace_once(
    text,
    '''    const actions = element('div', 'ul-inspector-actions');

    const copy = element('button', 'ul-button is-primary', 'Copy file');''',
    '''    const actions = element('div', 'ul-inspector-actions');
    const isActiveAudio = state.playback.assetId === asset.id;
    const isPlaying = isActiveAudio && state.playback.status === 'playing';

    const play = element('button', 'ul-button is-primary', isPlaying ? 'Pause audio' : 'Play audio');
    play.type = 'button';
    play.dataset.action = 'toggle-audio';
    play.disabled = asset.mediaKind !== 'audio' || !asset.primaryPath;
    const copy = element('button', 'ul-button', 'Copy file');''',
    'inspector play button',
)
text = replace_once(
    text,
    '''    actions.append(copy, tag, collection, analyze);

    const details = element('div', 'ul-detail-list');''',
    '''    actions.append(play, copy, tag, collection, analyze);

    const player = element('div', 'ul-player');
    if (asset.mediaKind === 'audio') {
      const progress = element('input', 'ul-slider');
      progress.type = 'range';
      progress.min = '0';
      progress.max = '1000';
      progress.value = isActiveAudio && state.playback.duration > 0
        ? String(Math.round((state.playback.currentTime / state.playback.duration) * 1000))
        : '0';
      progress.dataset.action = 'seek-audio';
      progress.disabled = !isActiveAudio || state.playback.duration <= 0;
      progress.setAttribute('aria-label', 'Audio preview position');
      const timeline = element('div', 'ul-player-row');
      timeline.append(
        element('span', '', formatDuration((isActiveAudio ? state.playback.currentTime : 0) * 1000)),
        element('span', '', formatDuration((isActiveAudio ? state.playback.duration : asset.audioAnalysis?.durationMs / 1000) * 1000)),
      );
      const volume = element('input', 'ul-slider');
      volume.type = 'range';
      volume.min = '0';
      volume.max = '100';
      volume.value = String(Math.round(state.playback.volume * 100));
      volume.dataset.action = 'volume-audio';
      volume.setAttribute('aria-label', 'Audio preview volume');
      player.append(progress, timeline, volume);
      if (isActiveAudio && state.playback.error) {
        player.append(element('div', 'ul-player-error', state.playback.error));
      }
    }

    const details = element('div', 'ul-detail-list');''',
    'inspector playback controls',
)
text = replace_once(
    text,
    '''    refs.inspector.append(hero, name, path, actions, details);''',
    '''    refs.inspector.append(hero, name, path, actions, player, details);''',
    'inspector append',
)

text = replace_once(
    text,
    '''      const card = element('button', `ul-asset-card${state.selectedAssetId === asset.id ? ' is-selected' : ''}`);
      card.type = 'button';''',
    '''      const isPlaying = state.playback.assetId === asset.id && state.playback.status === 'playing';
      const card = element(
        'button',
        `ul-asset-card${state.selectedAssetId === asset.id ? ' is-selected' : ''}${asset.mediaKind === 'audio' ? ' is-audio' : ''}${isPlaying ? ' is-playing' : ''}`,
      );
      card.type = 'button';''',
    'card playback classes',
)
text = replace_once(
    text,
    '''      if (!asset.isOnline) preview.append(element('span', 'ul-offline-badge', 'offline'));
      const body = element('div', 'ul-asset-body');''',
    '''      if (asset.mediaKind === 'audio' && asset.primaryPath) {
        preview.append(element('span', 'ul-play-indicator', isPlaying ? '❚❚' : '▶'));
      }
      if (!asset.isOnline) preview.append(element('span', 'ul-offline-badge', 'offline'));
      const body = element('div', 'ul-asset-body');''',
    'card play indicator',
)

text = replace_once(
    text,
    '''  refs.content.addEventListener('click', (event) => {
    const card = event.target.closest('[data-asset-id]');
    if (!card) return;
    state.selectedAssetId = card.dataset.assetId;
    renderAssets();
    renderInspector();
  });''',
    '''  refs.content.addEventListener('click', async (event) => {
    const card = event.target.closest('[data-asset-id]');
    if (!card) return;
    state.selectedAssetId = card.dataset.assetId;
    const asset = selectedAsset();
    renderAssets();
    renderInspector();
    if (asset?.mediaKind === 'audio' && asset.primaryPath) {
      await toggleAudition(asset);
    }
  });''',
    'card click audition',
)
text = replace_once(
    text,
    '''    if (action === 'copy-asset' && asset?.primaryPath) {
      await sigma.ui.clipboardWriteFiles([asset.primaryPath], 'copy');''',
    '''    if (action === 'toggle-audio') {
      await toggleAudition(asset);
    }
    else if (action === 'copy-asset' && asset?.primaryPath) {
      await sigma.ui.clipboardWriteFiles([asset.primaryPath], 'copy');''',
    'inspector toggle action',
)
text = replace_once(
    text,
    '''  shell.querySelector('[data-action="new-collection"]').addEventListener('click', () => openModal('new-collection'));''',
    '''  refs.inspector.addEventListener('input', (event) => {
    const action = event.target.dataset.action;
    if (action === 'seek-audio') {
      audition.seekRatio(Number(event.target.value) / 1000);
    }
    if (action === 'volume-audio') {
      audition.setVolume(Number(event.target.value) / 100);
    }
  });
  shell.querySelector('[data-action="new-collection"]').addEventListener('click', () => openModal('new-collection'));''',
    'seek and volume handlers',
)
text = replace_once(
    text,
    '''  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== refs.search) {''',
    '''  document.addEventListener('keydown', async (event) => {
    if (event.code === 'Space' && !state.modalMode && !isTypingTarget(event.target)) {
      const asset = selectedAsset();
      if (asset?.mediaKind === 'audio' && asset.primaryPath) {
        event.preventDefault();
        await toggleAudition(asset);
        return;
      }
    }
    if (event.key === '/' && document.activeElement !== refs.search) {''',
    'spacebar audition',
)
text = replace_once(
    text,
    '''  await loadSnapshot();
}''',
    '''  await loadSnapshot();
  return {
    dispose() {
      audition.dispose();
    },
  };
}''',
    'workspace disposal',
)

path.write_text(text, encoding='utf-8')
