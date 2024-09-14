import commonjs from '@rollup/plugin-commonjs';

export default {
  input: ['lib/migrate.js', 'lib/cli.js'],
  output: [
    {
      dir: 'lib',
      format: 'cjs',
      preserveModules: true,
      sourcemap: true,
    },
    {
      dir: 'lib',
      format: 'es',
      sourcemap: true,
      preserveModules: true,
      entryFileNames: '[name].mjs',
    },
  ],
  plugins: [
    commonjs(),
    {
      // TODO: here is cause of warning (!) Broken sourcemap
      renderChunk(code, chunk) {
        if (chunk.fileName === 'cli.js') {
          return `#!/usr/bin/env node\n${code}`;
        }
        return code;
      },
    },
  ],
};
