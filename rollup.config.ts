import commonjs from '@rollup/plugin-commonjs';

export default {
  input: ['lib/src/migrate.js', 'lib/src/cli.js'],
  output: [
    {
      dir: 'lib/src',
      format: 'cjs',
      preserveModules: true,
      sourcemap: true,
    },
    {
      dir: 'lib/src',
      format: 'es',
      sourcemap: true,
      preserveModules: true,
      entryFileNames: '[name].mjs',
    },
  ],
  plugins: [
    commonjs(),
    {
      renderChunk(code, chunk) {
        if (chunk.fileName === 'cli.js') {
          return `#!/usr/bin/env node\n${code}`;
        }
        return code;
      },
    },
  ],
};
