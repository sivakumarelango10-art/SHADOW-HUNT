import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * `vite build --mode artifact` makes a self-contained, server-free build (solo vs the bot
 * hunter) that runs the real server simulation in the page. The server's Node-only modules
 * are swapped for browser versions here.
 */
function offlineShims(): Plugin {
  const off = (f: string) => path.resolve(__dirname, 'src/offline', f);
  return {
    name: 'shadow-hunt-offline-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'node:crypto' || source === 'crypto') return off('shims/crypto.ts');
      if (!importer?.includes(`${path.sep}apps${path.sep}server${path.sep}`)) return null;
      if (source.endsWith('/services/store.ts')) return off('localStore.ts');
      if (source.endsWith('/utils/log.ts')) return off('shims/log.ts');
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    plugins: [react(), tailwindcss(), ...(artifact ? [offlineShims()] : [])],
    base: artifact ? './' : '/',
    define: artifact ? { 'import.meta.env.VITE_OFFLINE': JSON.stringify('1') } : {},
    server: { host: true, port: 5173 },
    preview: { host: true, port: 4173 },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1600,
      outDir: artifact ? 'dist-artifact' : 'dist',
      // The artifact page is packed into one HTML file (scripts/build-artifact.mjs).
      assetsInlineLimit: artifact ? 100_000_000 : undefined,
      cssCodeSplit: !artifact,
      rollupOptions: {
        output: artifact
          ? { inlineDynamicImports: true }
          : {
              manualChunks(id) {
                if (id.includes('node_modules/three') || id.includes('@react-three') || id.includes('postprocessing'))
                  return 'three';
                if (id.includes('@supabase')) return 'supabase';
                if (id.includes('@colyseus')) return 'colyseus';
                return undefined;
              },
            },
      },
    },
  };
});
