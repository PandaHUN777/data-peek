import { defineConfig } from 'tsup'
import { resolve } from 'node:path'

// The shared package ships TypeScript source, not JS, so it is bundled in
// rather than listed as a runtime dependency. `pg` stays external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  minify: false,
  sourcemap: false,
  noExternal: ['@data-peek/shared'],
  esbuildOptions(options) {
    options.alias = { '@shared': resolve(__dirname, '../shared/src') }
  }
})
