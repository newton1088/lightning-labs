import { MOCK_CONTROLLER_PREFIX } from '../const.js';
import { withoutQs } from '../util.js';
import { Mutex } from 'async-mutex';

const MOCK_IMPORT_PATTERN = /mock(!?)(\{ *([a-zA-Z0-9_]+( *, *)?)+\ *}):(.+)/;
const mutex = new Mutex();

function parseExports(curlyWrappedNames) {
  return curlyWrappedNames
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim());
}

export const makeMockImportResolver =
  ({ mockedModules, recursiveResolve }) =>
  async ({ source, context }) => {
    const match = MOCK_IMPORT_PATTERN.exec(source);
    if (!match) {
      return;
    }
    const [, exclamation, curlyWrappedNames, , , verbatimImport] = match;
    const exportedNames = parseExports(curlyWrappedNames);

    // Even if the mocked module can be resolved on disk, the developer
    // may not wish that module to provide the default values of the mock.
    // In that case, the developer can use the `mock!{default}:./filepath`
    // syntax to force the mock plugin to treat it as a stub.
    const forceMock = !!exclamation;

    // perhaps we will need to synchronously set something
    // in mockedModules, in case the test file immediately
    // imports the nonexisted mocked file right after the
    // mock: import, in the same file. I don't think web test
    // runner will wait for the previous import to resolve
    // before taking a look at the next one

    const { resolvedImport, importExists } = await recursiveResolve({
      source: verbatimImport,
      context,
    });

    const mockControllerPath = `${MOCK_CONTROLLER_PREFIX}${resolvedImport}`;
    const moduleKey = withoutQs(resolvedImport);
    try {
      const release = await mutex.acquire();
      try {
        if (mockedModules.has(moduleKey)) {
          const existingEntry = mockedModules.get(moduleKey);
          const newExportedNames = Array.from(
            new Set([...existingEntry.exportedNames, ...exportedNames]),
          );
          mockedModules.set(moduleKey, {
            ...existingEntry,
            exportedNames: newExportedNames,
          });
        } else {
          mockedModules.set(moduleKey, {
            mockControllerPath,
            exportedNames,
            importExists: !forceMock && importExists,
          });
        }
  
        return mockControllerPath;
      } finally {
        release();
      }
    } catch (error) {
      console.error("Error updating mocked modules:", error);
    }
    return mockControllerPath;
  };
