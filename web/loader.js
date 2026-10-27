// Picks which data to show, then starts the app.
// If you've loaded your own Spotify export (it lives in this browser only), that wins;
// otherwise the default data.js is used.
window.SpotifyStore = (() => {
  const DB = 'spotify-stats', STORE = 'kv', KEY = 'mine';
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(r?.result); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    });
  };
  const gzip = (text) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const gunzip = (buf) => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return {
    async save(data, meta) {
      const gz = await gzip(JSON.stringify(data));
      await tx('readwrite', (s) => s.put({ meta, gz }, KEY));
      return gz.byteLength;
    },
    async load() {
      const rec = await tx('readonly', (s) => s.get(KEY));
      if (!rec) return null;
      return { meta: rec.meta, data: JSON.parse(await gunzip(rec.gz)) };
    },
    remove: () => tx('readwrite', (s) => s.delete(KEY)),
  };
})();

(() => {
  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.body.appendChild(s);
  });
  (async () => {
    let mine = null;
    try { mine = await window.SpotifyStore.load(); } catch { /* storage unavailable: fall back to the default */ }
    if (mine) {
      window.SPOTIFY = mine.data;
      window.SPOTIFY_SOURCE = { kind: 'mine', ...mine.meta };
    } else {
      await load('data.js');
      window.SPOTIFY_SOURCE = { kind: 'default' };
    }
    await load('app.js');
    await load('import.js');
  })().catch((e) => {
    document.body.classList.remove('booting');
    document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="card">Couldn't start: ${String(e.message || e)}</p>`);
  });
})();
