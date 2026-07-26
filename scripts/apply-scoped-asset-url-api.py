from pathlib import Path


def replace_once(path, old, new, label):
    file_path = Path(path)
    text = file_path.read_text()
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected one marker, found {text.count(old)}')
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    'packages/api/index.d.ts',
    '''      exists(path: string): Promise<boolean>;
    };
  };''',
    '''      exists(path: string): Promise<boolean>;
      /**
       * Returns a streamable Tauri asset URL after verifying persistent scoped read access.
       * The URL does not grant access to paths outside the extension's approved directories.
       */
      toAssetUrl(path: string): Promise<string>;
    };
  };''',
    'public API declaration',
)

replace_once(
    'src/modules/extensions/api/create-fs-api.ts',
    "import { open } from '@tauri-apps/plugin-dialog';\n",
    "import { convertFileSrc } from '@tauri-apps/api/core';\nimport { open } from '@tauri-apps/plugin-dialog';\n",
    'convertFileSrc import',
)
replace_once(
    'src/modules/extensions/api/create-fs-api.ts',
    '''      exists: async (path: string): Promise<boolean> => {
        await requireScopedReadAccess(path);
        return invokeAsExtension<boolean>(context.extensionId, 'path_exists', { path });
      },
    },''',
    '''      exists: async (path: string): Promise<boolean> => {
        await requireScopedReadAccess(path);
        return invokeAsExtension<boolean>(context.extensionId, 'path_exists', { path });
      },
      toAssetUrl: async (path: string): Promise<string> => {
        await requireScopedReadAccess(path);
        return convertFileSrc(path);
      },
    },''',
    'scoped asset URL implementation',
)

replace_once(
    'src/modules/extensions/runtime/api-method-map.ts',
    "    'fs.scoped.exists': path => api.fs.scoped.exists(path as string),\n",
    "    'fs.scoped.exists': path => api.fs.scoped.exists(path as string),\n    'fs.scoped.toAssetUrl': path => api.fs.scoped.toAssetUrl(path as string),\n",
    'worker method map',
)

replace_once(
    'src/modules/extensions/runtime/embed-bridge.js',
    "      exists: path => callHost('fs.scoped.exists', path),\n",
    "      exists: path => callHost('fs.scoped.exists', path),\n      toAssetUrl: path => callHost('fs.scoped.toAssetUrl', path),\n",
    'embed bridge method',
)

replace_once(
    'src/modules/extensions/api/__tests__/create-fs-api.test.ts',
    '''const { invokeAsExtensionMock, hasScopedAccessMock } = vi.hoisted(() => ({
  invokeAsExtensionMock: vi.fn(),
  hasScopedAccessMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({''',
    '''const { invokeAsExtensionMock, hasScopedAccessMock, convertFileSrcMock } = vi.hoisted(() => ({
  invokeAsExtensionMock: vi.fn(),
  hasScopedAccessMock: vi.fn(),
  convertFileSrcMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: convertFileSrcMock,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({''',
    'test core mock',
)
replace_once(
    'src/modules/extensions/api/__tests__/create-fs-api.test.ts',
    '''    invokeAsExtensionMock.mockReset();
    hasScopedAccessMock.mockReset();
  });''',
    '''    invokeAsExtensionMock.mockReset();
    hasScopedAccessMock.mockReset();
    convertFileSrcMock.mockReset();
  });''',
    'test mock reset',
)
replace_once(
    'src/modules/extensions/api/__tests__/create-fs-api.test.ts',
    '''  it('allows importing a file selected from a dialog', async () => {''',
    '''  it('creates a scoped streamable asset URL only after read authorization', async () => {
    const context = createContext(['fs.read']);
    hasScopedAccessMock.mockResolvedValueOnce(true);
    convertFileSrcMock.mockReturnValueOnce('asset://localhost/library/kick.wav');
    const fsApi = createFsAPI(context);

    await expect(fsApi.scoped.toAssetUrl('/library/kick.wav'))
      .resolves.toBe('asset://localhost/library/kick.wav');

    expect(hasScopedAccessMock).toHaveBeenCalledWith(
      'test.extension',
      '/library/kick.wav',
      'read',
    );
    expect(convertFileSrcMock).toHaveBeenCalledWith('/library/kick.wav');
  });

  it('rejects scoped asset URLs outside approved directories', async () => {
    const context = createContext(['fs.read']);
    hasScopedAccessMock.mockResolvedValueOnce(false);
    const fsApi = createFsAPI(context);

    await expect(fsApi.scoped.toAssetUrl('/private/secret.wav'))
      .rejects.toThrow(/not in scoped directories/);
    expect(convertFileSrcMock).not.toHaveBeenCalled();
  });

  it('allows importing a file selected from a dialog', async () => {''',
    'scoped URL tests',
)
