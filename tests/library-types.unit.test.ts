import path from 'path';
import ts from 'typescript';

it('publishes type-safe object and legacy overloads through the package entry point', () => {
  const program = ts.createProgram([path.join(__dirname, 'types', 'migration.ts')], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  ).toBe('');
});
