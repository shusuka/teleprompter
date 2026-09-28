// Penyimpanan paparan. Di aplikasi (Electron) memakai folder data pengguna;
// saat dibuka di peramban biasa (pengembangan) jatuh ke IndexedDB.

const api = typeof window !== 'undefined' ? window.sorot : undefined;
export const isDesktop = !!api;

/* ---------- cadangan IndexedDB ---------- */

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('sorot', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' });
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

const blobUrls = new Map();

const web = {
  async list() {
    const all = (await tx('projects', 'readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  get: (id) => tx('projects', 'readonly', (s) => s.get(id)),
  async create() {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  },
  save: (p) => tx('projects', 'readwrite', (s) => s.put(structuredClone(p))),
  async remove(id) {
    await tx('projects', 'readwrite', (s) => s.delete(id));
    await web.clearSlides(id);
  },
  async clearSlides(id) {
    const d = await db();
    await new Promise((resolve) => {
      const t = d.transaction('files', 'readwrite');
      const s = t.objectStore('files');
      const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
      s.delete(range);
      t.oncomplete = resolve;
    });
    for (const k of [...blobUrls.keys()]) if (k.startsWith(`${id}/`)) blobUrls.delete(k);
  },
  async writeSlide(id, name, blob) {
    await tx('files', 'readwrite', (s) => s.put(blob, `${id}/slides/${name}`));
    blobUrls.delete(`${id}/slides/${name}`);
    return `slides/${name}`;
  },
  async slideUrl(project, rel) {
    const key = `${project.id}/${rel}`;
    if (!blobUrls.has(key)) {
      const blob = await tx('files', 'readonly', (s) => s.get(key));
      blobUrls.set(key, blob ? URL.createObjectURL(blob) : '');
    }
    return blobUrls.get(key);
  },
};

/* ---------- Electron ---------- */

const desktop = {
  list: () => api.listProjects(),
  get: (id) => api.getProject(id),
  create: () => api.createProject(),
  save: (p) => api.saveProject(p),
  remove: (id) => api.deleteProject(id),
  clearSlides: (id) => api.clearSlides(id),
  async writeSlide(id, name, blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return api.writeSlide(id, name, bytes);
  },
  async slideUrl(project, rel) {
    return `app://sorot/data/${project.id}/${rel}?v=${project.slidesVersion || 0}`;
  },
};

export const store = isDesktop ? desktop : web;

export async function slideUrls(project) {
  return Promise.all(project.slides.map((s) => (s.image ? store.slideUrl(project, s.image) : '')));
}

export async function confirmAction(message, detail = '') {
  if (isDesktop) return api.confirm(message, detail);
  return window.confirm(detail ? `${message}\n\n${detail}` : message);
}

export const desktopApi = api;
