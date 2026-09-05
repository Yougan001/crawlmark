import { existsSync } from 'node:fs';
import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    vinext(),
    ...(existsSync(new URL('./.openai/hosting.json', import.meta.url))
      ? [sites()]
      : []),
  ],
  server: {
    proxy: {
      '/api/inspect': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
