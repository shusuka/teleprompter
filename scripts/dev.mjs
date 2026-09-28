// Menjalankan Vite lalu membuka Electron yang memuat server pengembangan.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, SOROT_DEV_URL: `${url}index.html` },
});
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
