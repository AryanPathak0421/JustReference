import { defineConfig } from 'tsup';

/** Production bundle: inlines @jr/shared (TypeScript source) and keeps npm packages external. */
export default defineConfig({
  entry: ['src/server.ts', 'src/seed/run.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: ['@jr/shared'],
});
