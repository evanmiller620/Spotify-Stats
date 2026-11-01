// Sharing with friends: stores a listening summary in Supabase so others can open it with a link.
// The database only allows the spotify_stats_* functions; tables can't be read or listed directly.
window.SpotifyCloud = (() => {
  const URL_ = 'https://gzqwhhbxbctrbspyylom.supabase.co';
  const KEY = 'sb_publishable_nYAkiwkX63rRlMHdf7UPsw_B9vQlzGF'; // publishable key: safe in a web page
  const CHUNK = 900000; // characters per upload request
  const MINE = 'spotifyStats.share', FRIENDS = 'spotifyStats.friends';

  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch { throw new Error("Couldn't reach the sharing server. Check your connection and try again."); }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* not json */ }
      throw new Error(msg || `Sharing server error (${res.status})`);
    }
    return text ? JSON.parse(text) : null;
  }

  // gzip + base64 so the whole history fits in a few requests
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => { const s = atob(b64), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const pack = async (data) => toB64(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const unpack = async (b64) => JSON.parse(await new Response(new Blob([fromB64(b64)]).stream().pipeThrough(new DecompressionStream('gzip'))).text());

  // A small summary for the friends list (totals and top artists), so the list loads without the full history.
  function summarize(D) {
    const W = D.cols || 9, R = D.rows, art = new Map();
    let plays = 0, sec = 0;
    const songs = new Set();
    for (let i = 0; i < R.length; i += W) {
      plays += R[i + 2]; sec += R[i + 3]; songs.add(R[i]);
      const a = D.songs[R[i]][1];
      art.set(a, (art.get(a) || 0) + R[i + 3]);
    }
    const top = [...art].sort((x, y) => y[1] - x[1]).slice(0, 150).map(([a, s]) => [D.artists[a], Math.round(s)]);
    return { v: 1, from: D.months[0], to: D.months.at(-1), plays, sec: Math.round(sec), songs: songs.size, artists: art.size, top };
  }

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

  // identifies the data that was shared, so a newer upload can be sent automatically
  const fingerprint = (D) => { const s = summarize(D); return `${s.from}|${s.to}|${s.plays}|${s.sec}|${s.songs}`; };

  return {
    fingerprint,
    mine: () => read(MINE, null),
    friends: () => read(FRIENDS, []),
    saveFriends: (list) => write(FRIENDS, list),
    addFriend(id, name) {
      if (!/^[a-z0-9]{12}$/.test(id) || id === read(MINE, null)?.id) return false;
      const list = read(FRIENDS, []);
      const f = list.find((x) => x.id === id);
      if (f) { if (name) f.name = name; } else list.push({ id, name: name || 'Friend', added: Date.now() });
      write(FRIENDS, list);
      return true;
    },
    removeFriend(id) { write(FRIENDS, read(FRIENDS, []).filter((x) => x.id !== id)); },
    // the code from a link someone pasted, or a bare code
    parseCode(text) {
      const t = String(text || '').trim();
      const m = t.match(/[?&]s=([a-z0-9]{12})/i) || t.match(/^([a-z0-9]{12})$/i);
      return m ? m[1].toLowerCase() : null;
    },
    linkFor(id) { return `${location.origin === 'null' ? location.href.split(/[?#]/)[0] : location.origin + location.pathname}?s=${id}`; },

    // Upload (or replace) this browser's shared copy.
    async share(data, name, progress = () => {}) {
      progress('Packing your summary', 0.05);
      const body = await pack(data);
      const n = Math.ceil(body.length / CHUNK);
      if (n > 16) throw new Error('This history is too big to share.');
      let me = read(MINE, null);
      const begin = () => rpc('spotify_stats_begin', { p_id: me.id, p_token: me.token, p_name: name, p_summary: summarize(data), p_chunks: n });
      const create = async () => { me = await rpc('spotify_stats_create', { p_name: name }); write(MINE, { ...me, name }); };
      if (!me) await create();
      try { await begin(); } catch (e) {
        if (!/not allowed/.test(e.message)) throw e;
        await create(); await begin(); // the old link is gone; start a new one
      }
      for (let i = 0; i < n; i++) {
        progress(`Uploading ${i + 1} of ${n}`, 0.1 + (0.85 * i) / n);
        await rpc('spotify_stats_put', { p_id: me.id, p_token: me.token, p_seq: i, p_data: body.slice(i * CHUNK, (i + 1) * CHUNK) });
      }
      await rpc('spotify_stats_finish', { p_id: me.id, p_token: me.token });
      const saved = { ...me, name, at: Date.now(), bytes: body.length, fp: fingerprint(data), stopped: false };
      write(MINE, saved);
      return saved;
    },
    async unshare() {
      const me = read(MINE, null);
      if (!me) return;
      await rpc('spotify_stats_unshare', { p_id: me.id, p_token: me.token });
      write(MINE, { ...me, at: null, stopped: true }); // keep the code so sharing again reuses the same link
    },
    async rename(name) {
      const me = read(MINE, null);
      if (!me) return;
      await rpc('spotify_stats_rename', { p_id: me.id, p_token: me.token, p_name: name });
      write(MINE, { ...me, name });
    },
    info: (ids) => (ids.length ? rpc('spotify_stats_info', { p_ids: ids }) : Promise.resolve([])),
    async fetch(id, progress = () => {}) {
      const [row] = await rpc('spotify_stats_info', { p_ids: [id] });
      if (!row) throw new Error("That link doesn't work anymore. The person may have stopped sharing.");
      const parts = [];
      for (let i = 0; i < row.chunks; i++) {
        progress(i, row.chunks);
        parts.push(await rpc('spotify_stats_chunk', { p_id: id, p_seq: i }));
      }
      const data = await unpack(parts.join(''));
      return { id, name: row.name, summary: row.summary, updated: row.updated_at, data };
    },
    summarize,
  };
})();
