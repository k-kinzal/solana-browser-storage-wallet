import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/index.ts',
  output: [
    { dir: 'dist/esm', format: 'esm', sourcemap: true },
    { dir: 'dist/cjs', format: 'cjs', sourcemap: true, entryFileNames: '[name].cjs' }
  ],
  treeshake: true,
  external: ['tslib']         // peer deps / Node 組み込みなどは外部化
});
