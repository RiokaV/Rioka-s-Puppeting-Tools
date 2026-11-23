import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
      // Packages the built SPA (index.html + assets/*.js + assets/*.css) into
      // offline_studio_dist/ and serves it at /offline-studio/ so the AE SDK
      // bundle can ship a 100% offline standalone RiokaStudio.exe with zero login.
      {
        name: 'export-offline-studio-snapshot',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const offlineDir = path.resolve(__dirname, 'offline_studio_dist');
          const distIndex = path.join(distDir, 'index.html');
          const distAssets = path.join(distDir, 'assets');
          if (!fs.existsSync(distIndex) || !fs.existsSync(distAssets)) {
            return;
          }

          fs.rmSync(offlineDir, {recursive: true, force: true});
          fs.mkdirSync(path.join(offlineDir, 'assets'), {recursive: true});

          // Strip external Google Fonts links in the offline copy so standalone exe boots instantly offline
          const rawHtml = fs.readFileSync(distIndex, 'utf8');
          const offlineHtml = rawHtml
            .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '')
            .replace(/<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '');
          fs.writeFileSync(path.join(offlineDir, 'index.html'), offlineHtml, 'utf8');

          const manifestFiles: string[] = ['index.html'];
          for (const entry of fs.readdirSync(distAssets, {withFileTypes: true})) {
            if (!entry.isFile()) continue;
            if (!/\.(js|css|wasm|svg|png)$/i.test(entry.name)) continue;
            fs.copyFileSync(
              path.join(distAssets, entry.name),
              path.join(offlineDir, 'assets', entry.name)
            );
            manifestFiles.push(`assets/${entry.name}`);
          }

          fs.writeFileSync(
            path.join(offlineDir, 'manifest.json'),
            JSON.stringify({files: manifestFiles}, null, 2),
            'utf8'
          );

          // Mirror into dist/offline-studio/ so production preview also serves it
          const distOffline = path.join(distDir, 'offline-studio');
          fs.rmSync(distOffline, {recursive: true, force: true});
          fs.cpSync(offlineDir, distOffline, {recursive: true, force: true});
        },
        configureServer(server) {
          server.middlewares.use('/offline-studio', (req, res, next) => {
            const urlPath = (req.url || '/').split('?')[0].replace(/^\/+/, '');
            const safeRel = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
            const offlineDir = path.resolve(__dirname, 'offline_studio_dist');
            const target = path.join(offlineDir, safeRel);
            if (!target.startsWith(offlineDir) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
              return next();
            }
            const ext = path.extname(target).toLowerCase();
            const mimeMap: Record<string, string> = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.json': 'application/json; charset=utf-8',
              '.svg': 'image/svg+xml',
              '.png': 'image/png',
              '.wasm': 'application/wasm',
            };
            res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
            fs.createReadStream(target).pipe(res);
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
