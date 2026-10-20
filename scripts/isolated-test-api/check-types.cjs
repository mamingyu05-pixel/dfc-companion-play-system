'use strict';
// No emit, database, sockets, Prisma generation or service initialization.
const path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..'), ts = createRequire(path.join(root, 'package.json'))('typescript');
const configPath = path.join(root, 'apps/api-server/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath);
const tests = ts.sys.readDirectory(path.join(root, 'apps/api-server/test'), ['.ts'], undefined, ['**/*']);
const program = ts.createProgram([...new Set([...parsed.fileNames, ...tests])], { ...parsed.options, noEmit: true, incremental: false });
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
console.log(JSON.stringify({ scope: 'api-source-and-tests', noEmit: true, diagnostics: diagnostics.length, pgStarted: false }));
if (diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: value => value, getCurrentDirectory: () => root, getNewLine: () => '\n'
}));
process.exitCode = diagnostics.length ? 1 : 0;
