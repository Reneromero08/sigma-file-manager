from pathlib import Path


init_path = Path("src/composables/use-init.ts")
text = init_path.read_text(encoding="utf-8")

import_marker = "import { useExtensionsStore } from '@/stores/runtime/extensions';\n"
imports = (
    "import { useExtensionsStore } from '@/stores/runtime/extensions';\n"
    "import { useExtensionsStorageStore } from '@/stores/storage/extensions';\n"
    "import { bootstrapBundledUniversalLibrary } from '@/modules/extensions/bundled-extension-bootstrap';\n"
    "import { BUNDLED_UNIVERSAL_LIBRARY_ID } from '@/modules/extensions/bundled-extension-sync';\n"
)
if text.count(import_marker) != 1:
    raise SystemExit("extensions store import marker was not unique")
text = text.replace(import_marker, imports, 1)

store_marker = "  const extensionsStore = useExtensionsStore();\n"
stores = (
    "  const extensionsStore = useExtensionsStore();\n"
    "  const extensionsStorageStore = useExtensionsStorageStore();\n"
)
if text.count(store_marker) != 1:
    raise SystemExit("extensions store initialization marker was not unique")
text = text.replace(store_marker, stores, 1)

old_block = """    runInBackgroundWithTrace(
      'background:extensions.init',
      () => extensionsStore.init(),
      'Failed to initialize extensions:',
    );
"""
new_block = """    runInBackgroundWithTrace(
      'background:extensions.init',
      async () => {
        await extensionsStore.init();

        if (!isMainWindow) {
          return;
        }

        const result = await bootstrapBundledUniversalLibrary({
          getInstalledExtension: () => (
            extensionsStorageStore.extensionsData.installedExtensions[
              BUNDLED_UNIVERSAL_LIBRARY_ID
            ]
          ),
          installLocalExtension: sourcePath => (
            extensionsStore.installLocalExtension(sourcePath)
          ),
          refreshLocalExtensionFromSource: async (
            extensionId,
            sourcePath,
            expectedVersion,
          ) => {
            const extensionData = extensionsStorageStore
              .extensionsData
              .installedExtensions[extensionId];

            if (!extensionData?.isLocal) {
              throw new Error(`Bundled extension "${extensionId}" is not a local extension`);
            }

            const previousSourcePath = extensionData.localSourcePath;
            extensionData.localSourcePath = sourcePath;

            try {
              await extensionsStore.refreshLocalExtension(extensionId);
            }
            catch (error) {
              extensionData.localSourcePath = previousSourcePath;
              await extensionsStorageStore.saveStorageData();
              throw error;
            }

            const refreshed = extensionsStorageStore
              .extensionsData
              .installedExtensions[extensionId];

            if (!refreshed || refreshed.version !== expectedVersion) {
              if (refreshed) {
                refreshed.localSourcePath = previousSourcePath;
              }
              await extensionsStorageStore.saveStorageData();
            }
          },
        });

        logInitTrace(`bundled Universal Library sync: ${result}`);
      },
      'Failed to initialize extensions:',
    );
"""
if text.count(old_block) != 1:
    raise SystemExit("extensions background initialization block was not found")
init_path.write_text(text.replace(old_block, new_block, 1), encoding="utf-8")

test_path = Path("src/modules/extensions/__tests__/bundled-extension-sync.test.ts")
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace(
    "installFromSource: vi.fn(async () => {}),",
    "installFromSource: vi.fn(async () => undefined),",
    1,
)
test_text = test_text.replace(
    "expect(refreshFromSource).toHaveBeenCalledWith(extensionId, sourcePath);",
    "expect(refreshFromSource).toHaveBeenCalledWith(extensionId, sourcePath, '0.4.0');",
    1,
)
test_path.write_text(test_text, encoding="utf-8")
