import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

function copyPlainAppFiles() {
  return {
    name: 'copy-plain-app-files',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      fs.mkdirSync(distDir, { recursive: true });

      const rootFiles = [
        'index.html',
        'admin.html',
        'receptionist.html',
        'teacher.html',
        'student.html',
        'checkin.html',
        'qr-print.html',
        'report.html',
        'firebase-rules.json',
        'README.md',
      ];

      for (const file of rootFiles) {
        const src = path.resolve(__dirname, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(distDir, file));
        }
      }

      for (const dir of ['css', 'js']) {
        const srcDir = path.resolve(__dirname, dir);
        const destDir = path.join(distDir, dir);
        if (fs.existsSync(srcDir)) {
          fs.mkdirSync(destDir, { recursive: true });
          for (const entry of fs.readdirSync(srcDir)) {
            const srcFile = path.join(srcDir, entry);
            if (fs.statSync(srcFile).isFile()) {
              fs.copyFileSync(srcFile, path.join(destDir, entry));
            }
          }
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [copyPlainAppFiles()],
    build: {
      rollupOptions: {
        external: [/^https:\/\//],
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
