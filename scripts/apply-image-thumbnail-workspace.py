import json
from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    return text.replace(old, new, 1)


package_path = Path('universal-library/extension/package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
package['version'] = '0.8.0'
check = package['scripts']['check']
if 'ui/image-preview.js' not in check:
    check = check.replace('node --check ui/audio-player.js', 'node --check ui/audio-player.js && node --check ui/image-preview.js')
package['scripts']['check'] = check
package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')

custody_path = Path('universal-library/extension/tests/managed-binary-manifest.node.mjs')
custody = custody_path.read_text(encoding='utf-8')
custody = replace_once(
    custody,
    "assert.equal(manifest.version, '0.7.0');",
    "assert.equal(manifest.version, '0.8.0');",
    'managed extension version',
)
custody_path.write_text(custody, encoding='utf-8')

workspace_path = Path('universal-library/extension/ui/workspace.js')
workspace = workspace_path.read_text(encoding='utf-8')
workspace = replace_once(
    workspace,
    "import { createAuditionController } from './audio-player.js';\n",
    """import { createAuditionController } from './audio-player.js';
import {
  createImagePreviewLoader,
  isPreviewableImage,
} from './image-preview.js';
""",
    'image preview imports',
)
workspace = replace_once(
    workspace,
    """    .ul-kind-glyph { color: hsl(267 90% 80%); font-size: 29px; font-weight: 750; text-shadow: 0 8px 22px hsl(267 80% 55% / 0.4); }
    .ul-waveform {""",
    """    .ul-kind-glyph { color: hsl(267 90% 80%); font-size: 29px; font-weight: 750; text-shadow: 0 8px 22px hsl(267 80% 55% / 0.4); }
    .ul-image-preview { position: absolute; width: 100%; height: 100%; object-fit: cover; opacity: 0; inset: 0; transition: opacity 140ms ease; }
    .ul-image-preview.is-loaded { opacity: 1; }
    .ul-inspector-image { width: 100%; height: 100%; object-fit: contain; opacity: 0; border-radius: inherit; transition: opacity 140ms ease; }
    .ul-inspector-image.is-loaded { opacity: 1; }
    .ul-waveform {""",
    'image preview CSS',
)
workspace = replace_once(
    workspace,
    """  const audition = createAuditionController({
    resolveUrl: asset => execute({ action: 'audio-url', path: asset.primaryPath }),
    createAudio: audioFactory,
    onChange(playback) {""",
    """  const imagePreviews = createImagePreviewLoader({
    concurrency: 4,
    resolveUrl: asset => execute({ action: 'asset-url', path: asset.primaryPath }),
  });

  function attachImagePreview(containerNode, asset, className) {
    if (!isPreviewableImage(asset)) return null;
    const image = element('img', className);
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'lazy';
    imagePreviews.request(asset)
      .then((url) => {
        if (!url || !image.isConnected) return;
        image.addEventListener('load', () => image.classList.add('is-loaded'), { once: true });
        image.addEventListener('error', () => image.remove(), { once: true });
        image.src = url;
      })
      .catch(() => {
        image.remove();
      });
    containerNode.append(image);
    return image;
  }

  const audition = createAuditionController({
    resolveUrl: asset => execute({ action: 'audio-url', path: asset.primaryPath }),
    createAudio: audioFactory,
    onChange(playback) {""",
    'image preview loader',
)
workspace = replace_once(
    workspace,
    """    hero.append(
      inspectorWaveform
      ?? element('div', 'ul-kind-glyph', KIND_GLYPHS[asset.mediaKind] ?? '·'),
    );
""",
    """    hero.append(
      inspectorWaveform
      ?? element('div', 'ul-kind-glyph', KIND_GLYPHS[asset.mediaKind] ?? '·'),
    );
    attachImagePreview(hero, asset, 'ul-inspector-image');
""",
    'inspector image preview',
)
workspace = replace_once(
    workspace,
    """      preview.append(
        waveform ?? element('div', 'ul-kind-glyph', KIND_GLYPHS[asset.mediaKind] ?? '·'),
      );
""",
    """      preview.append(
        waveform ?? element('div', 'ul-kind-glyph', KIND_GLYPHS[asset.mediaKind] ?? '·'),
      );
      attachImagePreview(preview, asset, 'ul-image-preview');
""",
    'card image preview',
)
workspace = replace_once(
    workspace,
    """    dispose() {
      audition.dispose();
    },
""",
    """    dispose() {
      audition.dispose();
      imagePreviews.dispose();
    },
""",
    'preview disposal',
)
workspace_path.write_text(workspace, encoding='utf-8')
