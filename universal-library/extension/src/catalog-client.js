export const EXECUTABLE_SETTING = 'catalog.executablePath';
export const DATABASE_SETTING = 'catalog.databasePath';

export class CatalogCommandError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CatalogCommandError';
    this.code = options.code ?? null;
    this.stderr = options.stderr ?? '';
    this.stdout = options.stdout ?? '';
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function getCatalogConfiguration() {
  return {
    executablePath: nonEmptyString(await sigma.settings.get(EXECUTABLE_SETTING)),
    databasePath: nonEmptyString(await sigma.settings.get(DATABASE_SETTING)),
  };
}

export async function configureCatalogExecutable() {
  const selection = await sigma.dialog.openFile({
    title: 'Choose the Universal Library catalog executable',
    multiple: false,
    directory: false,
  });

  if (!selection || Array.isArray(selection)) return null;
  await sigma.settings.set(EXECUTABLE_SETTING, selection);
  return selection;
}

export async function configureCatalogDatabase() {
  const current = nonEmptyString(await sigma.settings.get(DATABASE_SETTING));
  const selection = await sigma.dialog.saveFile({
    title: 'Choose the Universal Library catalog database',
    defaultPath: current ?? 'universal-library.sqlite3',
    filters: [{ name: 'SQLite database', extensions: ['sqlite3', 'sqlite', 'db'] }],
  });

  if (!selection) return null;
  await sigma.settings.set(DATABASE_SETTING, selection);
  return selection;
}

export async function clearCatalogDatabaseOverride() {
  await sigma.settings.reset(DATABASE_SETTING);
}

async function requireExecutable(promptForExecutable) {
  const configured = nonEmptyString(await sigma.settings.get(EXECUTABLE_SETTING));
  if (configured) return configured;

  if (promptForExecutable) {
    const selected = await configureCatalogExecutable();
    if (selected) return selected;
  }

  throw new CatalogCommandError(
    'The Universal Library catalog executable is not configured. Run “Universal Library: Configure catalog executable” first.',
  );
}

function buildArguments(args, databasePath) {
  return databasePath
    ? ['--database', databasePath, ...args]
    : [...args];
}

function parseJsonDocument(value) {
  const text = value.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  }
  catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
      return JSON.parse(text.slice(start, end + 1));
    }
    catch {
      return null;
    }
  }
}

export function parseCatalogResult(result) {
  const successfulPayload = parseJsonDocument(result.stdout ?? '');
  const errorPayload = parseJsonDocument(result.stderr ?? '');
  const payload = result.code === 0
    ? successfulPayload
    : errorPayload ?? successfulPayload;

  if (result.code !== 0) {
    const message = payload?.error?.message
      ?? nonEmptyString(result.stderr)
      ?? nonEmptyString(result.stdout)
      ?? `Catalog command exited with code ${result.code}.`;
    throw new CatalogCommandError(message, result);
  }

  if (!payload || payload.ok !== true || !Object.hasOwn(payload, 'data')) {
    throw new CatalogCommandError(
      'The catalog returned an invalid JSON response.',
      result,
    );
  }

  return payload.data;
}

export async function runCatalog(args, options = {}) {
  const executablePath = await requireExecutable(options.promptForExecutable !== false);
  const databasePath = nonEmptyString(await sigma.settings.get(DATABASE_SETTING));
  const result = await sigma.shell.run(
    executablePath,
    buildArguments(args, databasePath),
  );
  return parseCatalogResult(result);
}

export async function startCatalog(args, options = {}) {
  const executablePath = await requireExecutable(options.promptForExecutable !== false);
  const databasePath = nonEmptyString(await sigma.settings.get(DATABASE_SETTING));
  const task = await sigma.shell.runWithProgress(
    executablePath,
    buildArguments(args, databasePath),
    options.onProgress,
  );

  return {
    taskId: task.taskId,
    cancel: task.cancel,
    result: task.result.then(parseCatalogResult),
  };
}

export function formatCatalogError(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
