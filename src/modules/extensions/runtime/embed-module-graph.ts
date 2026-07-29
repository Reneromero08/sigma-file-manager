// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.

type EmbedModuleGraph = {
  entryPath: string;
  sources: Record<string, string>;
};

const MAX_EMBED_MODULE_COUNT = 128;
const MAX_EMBED_MODULE_BYTES = 4 * 1024 * 1024;
const STATIC_RELATIVE_MODULE_SPECIFIER_PATTERN
  = /^(\s*(?:import|export)\s+(?:[^;'"`]*?\sfrom\s*)?)(['"])(\.{1,2}\/[^'"]+)\2/gm;
const DYNAMIC_RELATIVE_MODULE_SPECIFIER_PATTERN
  = /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

function normalizeModulePath(path: string): string {
  const segments: string[] = [];

  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (segments.length === 0) {
        throw new Error(`Extension embed import escapes its package: ${path}`);
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join('/');
}

function resolveModuleSpecifier(importerPath: string, specifier: string): string {
  const separatorIndex = importerPath.lastIndexOf('/');
  const importerDirectory = separatorIndex >= 0
    ? importerPath.slice(0, separatorIndex)
    : '';
  return normalizeModulePath(`${importerDirectory}/${specifier}`);
}

function transformRelativeModuleSpecifiers(
  source: string,
  importerPath: string,
  transform: (resolvedPath: string) => string,
): string {
  function replaceSpecifier(
    match: string,
    prefix: string,
    quote: string,
    specifier: string,
  ): string {
    const resolvedPath = resolveModuleSpecifier(importerPath, specifier);
    return `${prefix}${quote}${transform(resolvedPath)}${quote}`;
  }

  return source.replace(
    STATIC_RELATIVE_MODULE_SPECIFIER_PATTERN,
    replaceSpecifier,
  ).replace(
    DYNAMIC_RELATIVE_MODULE_SPECIFIER_PATTERN,
    replaceSpecifier,
  );
}

function getRelativeModulePaths(source: string, importerPath: string): string[] {
  const paths = new Set<string>();
  transformRelativeModuleSpecifiers(source, importerPath, (resolvedPath) => {
    paths.add(resolvedPath);
    return resolvedPath;
  });
  return [...paths];
}

export async function loadEmbedModuleGraph(
  entryPath: string,
  readModule: (path: string) => Promise<string>,
): Promise<EmbedModuleGraph> {
  const normalizedEntryPath = normalizeModulePath(entryPath);
  const sources: Record<string, string> = {};
  let totalBytes = 0;

  async function loadModule(modulePath: string): Promise<void> {
    if (sources[modulePath] !== undefined) {
      return;
    }

    if (Object.keys(sources).length >= MAX_EMBED_MODULE_COUNT) {
      throw new Error(`Extension embed exceeds ${MAX_EMBED_MODULE_COUNT} modules`);
    }

    const source = await readModule(modulePath);
    totalBytes += new TextEncoder().encode(source).byteLength;

    if (totalBytes > MAX_EMBED_MODULE_BYTES) {
      throw new Error(`Extension embed exceeds ${MAX_EMBED_MODULE_BYTES} bytes`);
    }

    sources[modulePath] = source;
    await Promise.all(
      getRelativeModulePaths(source, modulePath).map(loadModule),
    );
  }

  await loadModule(normalizedEntryPath);
  return {
    entryPath: normalizedEntryPath,
    sources,
  };
}

export function createEmbedModuleDataUrl(graph: EmbedModuleGraph): string {
  const moduleUrls = new Map<string, string>();
  const resolving = new Set<string>();

  function createModuleUrl(modulePath: string): string {
    const existingUrl = moduleUrls.get(modulePath);

    if (existingUrl) {
      return existingUrl;
    }

    if (resolving.has(modulePath)) {
      throw new Error(`Circular extension embed import is not supported: ${modulePath}`);
    }

    const source = graph.sources[modulePath];

    if (source === undefined) {
      throw new Error(`Extension embed module is missing: ${modulePath}`);
    }

    resolving.add(modulePath);
    const transformedSource = transformRelativeModuleSpecifiers(
      source,
      modulePath,
      createModuleUrl,
    );
    resolving.delete(modulePath);

    const encodedSource = encodeURIComponent(transformedSource).replace(/'/g, '%27');
    const moduleUrl = `data:text/javascript;charset=utf-8,${encodedSource}`;
    moduleUrls.set(modulePath, moduleUrl);
    return moduleUrl;
  }

  return createModuleUrl(graph.entryPath);
}
