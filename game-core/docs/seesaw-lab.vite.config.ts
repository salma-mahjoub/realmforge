import {defineConfig} from 'vite';
export default defineConfig({
    root: new URL('..', import.meta.url).pathname,
    publicDir: new URL('../../web/public', import.meta.url).pathname,
    server: {host: '127.0.0.1', port: 5178, strictPort: true},
    build: {outDir: 'docs/dist', emptyOutDir: true, rollupOptions: {input: new URL('./seesaw-lab.html', import.meta.url).pathname}},
});
