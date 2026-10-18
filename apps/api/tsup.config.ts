import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@globalhub\//],
  external: ['@prisma/client', '@node-rs/argon2'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
