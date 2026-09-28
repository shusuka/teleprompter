const { app, BrowserWindow, protocol, ipcMain, screen, shell, dialog, session, systemPreferences, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');

const DEV_URL = process.env.SOROT_DEV_URL;
const DIST = path.join(__dirname, '..', 'dist');
const HOST = 'sorot';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
  },
]);

// Pengenal suara berjalan di renderer; jangan biarkan Chromium/Windows memperlambatnya
// saat jendela tertutup jendela lain (mis. ketika layar penonton aktif).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function boostRenderer(win) {
  try {
    const pid = win.webContents.getOSProcessId();
    if (pid) os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch {
    /* tidak semua sistem mengizinkan */
  }
}

// Satu instance saja: membuka exe kedua kali cukup memunculkan jendela lama.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWin = null;
let audienceWin = null;

const projectsRoot = () => path.join(app.getPath('userData'), 'paparan');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function safeJoin(root, rel) {
  const target = path.normalize(path.join(root, rel));
  if (!target.startsWith(path.normalize(root))) return null;
  return target;
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file;
    if (rel.startsWith('data/')) {
      file = safeJoin(projectsRoot(), rel.slice(5));
    } else {
      if (!rel) rel = 'index.html';
      file = safeJoin(DIST, rel);
    }
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fsp.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(body, {
        headers: { 'Content-Type': type, 'Cache-Control': 'no-cache', ...ISOLATION_HEADERS },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function pageUrl(hash = '') {
  const base = DEV_URL || `app://${HOST}/index.html`;
  return hash ? `${base}#${hash}` : base;
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0b0d10',
    title: 'Sorot',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  mainWin.once('ready-to-show', () => {
    mainWin.maximize();
    mainWin.show();
  });
  mainWin.loadURL(pageUrl());
  mainWin.webContents.on('did-finish-load', () => boostRenderer(mainWin));
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.on('closed', () => {
    mainWin = null;
    if (audienceWin && !audienceWin.isDestroyed()) audienceWin.close();
  });
}

function externalDisplay() {
  const primary = screen.getPrimaryDisplay();
  const mainBounds = mainWin ? mainWin.getBounds() : primary.bounds;
  const current = screen.getDisplayMatching(mainBounds);
  return screen.getAllDisplays().find((d) => d.id !== current.id) || null;
}

function openAudience() {
  if (audienceWin && !audienceWin.isDestroyed()) {
    audienceWin.focus();
    return { ok: true, external: !!externalDisplay() };
  }
  const ext = externalDisplay();
  const b = ext ? ext.bounds : { x: 80, y: 80, width: 960, height: 540 };
  audienceWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    backgroundColor: '#000000',
    title: 'Sorot — Layar Penonton',
    autoHideMenuBar: true,
    fullscreen: !!ext,
    frame: !ext,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  audienceWin.loadURL(pageUrl('/audience'));
  audienceWin.on('closed', () => {
    audienceWin = null;
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('audience:closed');
  });
  return { ok: true, external: !!ext };
}

/* ---------- penyimpanan paparan ---------- */

async function readProject(id) {
  const raw = await fsp.readFile(path.join(projectsRoot(), id, 'project.json'), 'utf8');
  return JSON.parse(raw);
}

ipcMain.handle('projects:list', async () => {
  await fsp.mkdir(projectsRoot(), { recursive: true });
  const dirs = await fsp.readdir(projectsRoot(), { withFileTypes: true });
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      out.push(await readProject(d.name));
    } catch {
      /* folder rusak dilewati */
    }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

ipcMain.handle('projects:get', async (_e, id) => readProject(id));

ipcMain.handle('projects:create', async () => {
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  await fsp.mkdir(path.join(projectsRoot(), id, 'slides'), { recursive: true });
  return id;
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Di Windows, rename ke berkas yang sedang dibuka proses lain (antivirus, pengindeks)
// gagal sesaat. Coba beberapa kali, lalu tulis langsung bila tetap terkunci.
async function writeJsonSafely(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      if (!LOCKED.has(err.code)) {
        await fsp.rm(tmp, { force: true });
        throw err;
      }
      await wait(40 * (attempt + 1));
    }
  }
  await fsp.rm(tmp, { force: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fsp.writeFile(file, text, 'utf8');
      return;
    } catch (err) {
      if (!LOCKED.has(err.code) || attempt === 4) throw err;
      await wait(100 * (attempt + 1));
    }
  }
}

// Simpanan untuk paparan yang sama dijalankan berurutan agar tidak saling tabrak.
const saveQueues = new Map();

ipcMain.handle('projects:save', async (_e, project) => {
  const dir = path.join(projectsRoot(), project.id);
  const text = JSON.stringify(project, null, 2);
  const prev = saveQueues.get(project.id) || Promise.resolve();
  const job = prev
    .catch(() => {})
    .then(async () => {
      await fsp.mkdir(dir, { recursive: true });
      await writeJsonSafely(path.join(dir, 'project.json'), text);
    });
  saveQueues.set(project.id, job);
  try {
    await job;
  } finally {
    if (saveQueues.get(project.id) === job) saveQueues.delete(project.id);
  }
  return true;
});

ipcMain.handle('projects:delete', async (_e, id) => {
  const dir = safeJoin(projectsRoot(), id);
  if (!dir || dir === path.normalize(projectsRoot())) return false;
  await fsp.rm(dir, { recursive: true, force: true });
  return true;
});

ipcMain.handle('slides:clear', async (_e, id) => {
  const dir = path.join(projectsRoot(), id, 'slides');
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  return true;
});

ipcMain.handle('slides:write', async (_e, id, name, bytes) => {
  const file = safeJoin(path.join(projectsRoot(), id, 'slides'), name);
  if (!file) throw new Error('Nama berkas tidak sah');
  await fsp.writeFile(file, Buffer.from(bytes));
  return `slides/${name}`;
});

ipcMain.handle('projects:reveal', async (_e, id) => {
  shell.openPath(path.join(projectsRoot(), id));
});

/* ---------- PPTX → gambar lewat PowerPoint (COM) ---------- */

const PPT_SCRIPT = `
param([string]$src, [string]$out)
$ErrorActionPreference = 'Stop'
try { $ppt = New-Object -ComObject PowerPoint.Application } catch { Write-Output 'NO_POWERPOINT'; exit 3 }
$wasOpen = $ppt.Presentations.Count
$pres = $ppt.Presentations.Open($src, -1, 0, 0)
try {
  $w = 1920
  $h = [int][Math]::Round(1920 * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
  $n = $pres.Slides.Count
  $tmp = $out
  try {
    # Ekspor sekaligus; nama berkas bisa berbeda menurut bahasa Office, jadi diurutkan dari angkanya.
    $pres.Export($tmp, 'PNG', $w, $h)
    $files = Get-ChildItem $tmp -Filter *.png | Sort-Object { [int](($_.BaseName -replace '\D', '') + '0') / 10 }
    if ($files.Count -ne $n) { throw 'jumlah berkas tidak cocok' }
  } catch {
    Get-ChildItem $tmp | Remove-Item -Force
    for ($i = 1; $i -le $n; $i++) {
      $pres.Slides.Item($i).Export((Join-Path $tmp ('{0:D3}.png' -f $i)), 'PNG', $w, $h)
    }
    $files = Get-ChildItem $tmp -Filter *.png | Sort-Object Name
  }
  $i = 0
  foreach ($f in $files) {
    $i++
    Rename-Item -LiteralPath $f.FullName ('s{0:D3}.png' -f $i)
  }
  Write-Output ("OK {0} {1} {2}" -f $i, $w, $h)
} finally {
  $pres.Close()
  if ($wasOpen -eq 0) { $ppt.Quit() }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
`;

ipcMain.handle('pptx:export', async (_e, id, srcPath) => {
  const dest = path.join(projectsRoot(), id, 'slides');
  await fsp.mkdir(dest, { recursive: true });
  // PowerPoint menulis ke folder sementara dulu; beberapa pemasangan Windows
  // memvirtualisasi AppData sehingga PowerPoint tidak bisa melihat folder data aplikasi.
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'sorot-ppt-'));
  const scriptFile = path.join(app.getPath('temp'), `sorot-ppt-${process.pid}.ps1`);
  // BOM agar PowerShell 5 membaca skrip sebagai UTF-8
  await fsp.writeFile(scriptFile, String.fromCharCode(0xfeff) + PPT_SCRIPT, 'utf8');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-src', srcPath, '-out', out],
      { windowsHide: true, timeout: 10 * 60 * 1000 },
      async (err, stdout) => {
        fs.rm(scriptFile, () => {});
        const text = String(stdout || '');
        const m = text.match(/OK (\d+) (\d+) (\d+)/);
        if (m) {
          const count = Number(m[1]);
          const files = [];
          try {
            for (let i = 1; i <= count; i++) {
              const name = `s${String(i).padStart(3, '0')}.png`;
              await fsp.copyFile(path.join(out, name), path.join(dest, name));
              files.push(`slides/${name}`);
            }
          } catch (copyErr) {
            resolve({ ok: false, reason: 'failed', detail: String(copyErr.message) });
            return;
          } finally {
            fs.rm(out, { recursive: true, force: true }, () => {});
          }
          resolve({ ok: true, files, aspect: Number(m[2]) / Number(m[3]) });
          return;
        }
        fs.rm(out, { recursive: true, force: true }, () => {});
        if (text.includes('NO_POWERPOINT')) {
          resolve({ ok: false, reason: 'no-powerpoint' });
        } else {
          resolve({ ok: false, reason: 'failed', detail: String(err?.message || text).slice(0, 400) });
        }
      },
    );
  });
});

/* ---------- jendela & tampilan ---------- */

ipcMain.handle('audience:open', () => openAudience());
ipcMain.handle('audience:close', () => {
  if (audienceWin && !audienceWin.isDestroyed()) audienceWin.close();
  return true;
});
ipcMain.handle('audience:isOpen', () => !!(audienceWin && !audienceWin.isDestroyed()));
ipcMain.handle('displays:count', () => screen.getAllDisplays().length);

ipcMain.handle('win:fullscreen', (e, on) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return false;
  w.setFullScreen(typeof on === 'boolean' ? on : !w.isFullScreen());
  return w.isFullScreen();
});

ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: projectsRoot() }));

/* ---------- rahasia (API key), dienkripsi dengan akun Windows ---------- */

const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');

async function readSecrets() {
  try {
    return JSON.parse(await fsp.readFile(secretsFile(), 'utf8'));
  } catch {
    return {};
  }
}

ipcMain.handle('secret:get', async (_e, name) => {
  const all = await readSecrets();
  const v = all[name];
  if (!v) return '';
  try {
    return v.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.data, 'base64')) : v.data;
  } catch {
    return '';
  }
});

ipcMain.handle('secret:set', async (_e, name, value) => {
  const all = await readSecrets();
  if (!value) delete all[name];
  else if (safeStorage.isEncryptionAvailable()) all[name] = { enc: true, data: safeStorage.encryptString(value).toString('base64') };
  else all[name] = { enc: false, data: value };
  await writeJsonSafely(secretsFile(), JSON.stringify(all));
  return true;
});

ipcMain.handle('dialog:confirm', async (e, message, detail) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showMessageBox(w, {
    type: 'question',
    buttons: ['Batal', 'Ya, lanjutkan'],
    defaultId: 1,
    cancelId: 0,
    message,
    detail,
  });
  return r.response === 1;
});

/* ---------- sinkron dengan slideshow PowerPoint yang sedang berjalan ---------- */

// Proses PowerShell kecil yang terus hidup: membaca perintah JSON per baris dari stdin
// dan menulis keadaan slideshow ke stdout setiap kali berubah. PowerPoint tidak pernah
// dibuka oleh Sorot; hanya menempel ke PowerPoint yang sudah berjalan.
const PPT_BRIDGE = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Get-Ppt { try { [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $null } }
function Get-State {
  $app = Get-Ppt
  if (-not $app) { return @{ ok = $false; reason = 'closed' } }
  $n = 0
  try { $n = $app.SlideShowWindows.Count } catch { return @{ ok = $false; reason = 'busy' } }
  if ($n -lt 1) {
    $open = 0; try { $open = $app.Presentations.Count } catch {}
    return @{ ok = $false; reason = 'noshow'; open = $open }
  }
  try {
    $w = $app.SlideShowWindows.Item(1)
    $v = $w.View
    $st = [int]$v.State
    $idx = -1; try { $idx = [int]$v.Slide.SlideIndex } catch {}
    return @{ ok = $true; slide = $idx; count = [int]$w.Presentation.Slides.Count; name = [string]$w.Presentation.Name; state = $st }
  } catch { return @{ ok = $false; reason = 'busy' } }
}
function Run-Cmd($c) {
  $app = Get-Ppt
  if (-not $app) { return }
  if ($c.cmd -eq 'start') {
    if ($app.SlideShowWindows.Count -lt 1 -and $app.Presentations.Count -gt 0) {
      $w = $app.ActivePresentation.SlideShowSettings.Run()
      if ([int]$c.slide -gt 1) { $w.View.GotoSlide([int]$c.slide) }
    }
    return
  }
  if ($app.SlideShowWindows.Count -lt 1) { return }
  $v = $app.SlideShowWindows.Item(1).View
  if ($c.cmd -eq 'goto') { $v.GotoSlide([int]$c.slide) }
  elseif ($c.cmd -eq 'black') { if ($c.on) { $v.State = 3 } else { $v.State = 1 } }
}
# Console.In di PowerShell 5 selalu memblokir; baca stream mentah di thread latar.
$in = [Console]::OpenStandardInput()
$buf = New-Object byte[] 4096
$pending = ''
$task = $in.ReadAsync($buf, 0, $buf.Length)
$last = ''
while ($true) {
  while ($task.IsCompleted) {
    $n = $task.Result
    if ($n -le 0) { exit 0 }
    $pending += [Text.Encoding]::UTF8.GetString($buf, 0, $n)
    while (($i = $pending.IndexOf([char]10)) -ge 0) {
      $line = $pending.Substring(0, $i).Trim()
      $pending = $pending.Substring($i + 1)
      if ($line) { try { Run-Cmd ($line | ConvertFrom-Json) } catch {} }
    }
    $task = $in.ReadAsync($buf, 0, $buf.Length)
  }
  $j = (Get-State) | ConvertTo-Json -Compress
  if ($j -ne $last) { [Console]::Out.WriteLine($j); [Console]::Out.Flush(); $last = $j }
  Start-Sleep -Milliseconds 150
}
`;

let pptProc = null;
let pptWatchers = new Set();
let pptLast = null;

function pptBroadcast(s) {
  pptLast = s;
  for (const wc of pptWatchers) if (!wc.isDestroyed()) wc.send('ppt:status', s);
}

async function pptStart() {
  if (pptProc) return;
  const scriptFile = path.join(app.getPath('temp'), `sorot-ppt-bridge-${process.pid}.ps1`);
  await fsp.writeFile(scriptFile, String.fromCharCode(0xfeff) + PPT_BRIDGE, 'utf8');
  const { spawn } = require('node:child_process');
  const proc = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], { windowsHide: true });
  pptProc = proc;
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        pptBroadcast(JSON.parse(line));
      } catch {
        /* baris tidak utuh */
      }
    }
  });
  proc.on('exit', () => {
    if (pptProc === proc) {
      pptProc = null;
      pptBroadcast({ ok: false, reason: 'stopped' });
    }
    fs.rm(scriptFile, () => {});
  });
}

function pptStop() {
  if (!pptProc) return;
  try {
    pptProc.stdin.end();
  } catch {
    /* sudah berhenti */
  }
  const p = pptProc;
  pptProc = null;
  setTimeout(() => p.kill(), 1500);
}

ipcMain.handle('ppt:watch', async (e, on) => {
  if (on) {
    pptWatchers.add(e.sender);
    e.sender.once('destroyed', () => {
      pptWatchers.delete(e.sender);
      if (!pptWatchers.size) pptStop();
    });
    await pptStart();
    return pptLast;
  }
  pptWatchers.delete(e.sender);
  if (!pptWatchers.size) pptStop();
  return null;
});

ipcMain.handle('ppt:cmd', (_e, cmd) => {
  if (pptProc?.stdin.writable) pptProc.stdin.write(`${JSON.stringify(cmd)}\n`);
});

app.on('before-quit', pptStop);

/* ---------- pembaruan otomatis ---------- */

const REPO = 'shusuka/teleprompter';
let updater = null;

function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let lastUpdate = null;
function sendUpdate(status) {
  lastUpdate = status;
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('update:status', status);
}

async function checkUpdates() {
  if (!app.isPackaged) return;
  // Versi portable tidak bisa memperbarui diri; cukup beri tahu ada versi baru.
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      const j = await r.json();
      const v = String(j.tag_name || '').replace(/^v/, '');
      if (v && isNewer(v, app.getVersion())) sendUpdate({ state: 'portable', version: v, url: j.html_url });
    } catch {
      /* luring */
    }
    return;
  }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-available', (i) => sendUpdate({ state: 'downloading', version: i.version }));
    updater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
    updater.on('error', () => {});
    await updater.checkForUpdates();
  } catch {
    /* luring atau rilis belum tersedia */
  }
}

ipcMain.handle('update:last', () => lastUpdate);
ipcMain.handle('update:install', () => {
  if (updater && lastUpdate?.state === 'ready') updater.quitAndInstall(false, true);
});
ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
});

/* ---------- start ---------- */

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(async () => {
  registerAppProtocol();

  // Hanya mikrofon yang diizinkan; permintaan lain ditolak.
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  createMainWindow();
  mainWin.webContents.once('did-finish-load', () => setTimeout(checkUpdates, 4000));
});

app.on('window-all-closed', () => app.quit());
