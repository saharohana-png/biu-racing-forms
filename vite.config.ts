import vinext from 'vinext';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ command }) => ({
  server: { host: '127.0.0.1', port: 5173 },
  plugins: [vinext(), cloudflare({
    configPath: process.env.FORMS_WRANGLER_CONFIG || './wrangler.jsonc',
    viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    inspectorPort: false,
    ...(command === 'serve' ? { config: { vars: { LOCAL_DEV: 'true' } } } : {}),
  })],
}));
