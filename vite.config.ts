/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Project site: https://lanpa.github.io/vrcalib/
export default defineConfig({
  base: '/vrcalib/',
  test: {
    include: ['src/**/*.test.ts'],
  },
  build: {
    rollupOptions: {
      input: {
        editor: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'view.html'),
      },
    },
  },
});
