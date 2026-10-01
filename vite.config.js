import { defineConfig } from 'vite';

// Entry is viewer.html (index.html is the byte-identical upstream mirror and
// stays untouched). The 7.7 MB dataset is bundled from src/data.json; extra simulated
// bodies (the humanoids in src/data/, from `npm run sim:biped`) are merged in at load time.
// parade.html walks the humanoids together (src/js/parade.js); it loads only their body packs.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { viewer: 'viewer.html', parade: 'parade.html' },
    },
    chunkSizeWarningLimit: 9000,
  },
});
