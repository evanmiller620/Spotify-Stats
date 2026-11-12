// Saving playlists to Spotify, and reading yours for the guessing game: "Sign in with Spotify" (authorization code + PKCE, no server needed).
// Setup: create an app at developer.spotify.com, add this site's address as a Redirect URI,
// and paste the app's Client ID below. See README → "Saving playlists to Spotify".
window.SpotifyAuth = (() => {
  const CLIENT_ID = ''; // ← your Spotify app's Client ID
  const SCOPES = 'playlist-modify-private playlist-modify-public playlist-read-private playlist-read-collaborative';
  const TOKEN = 'spotifyStats.spotifyAuth', PENDING = 'spotifyStats.pendingPlaylist', RESULT = 'spotifyStats.playlistResult', SIGNIN = 'spotifyStats.signInError';
  const API = 'https://api.spotify.com/v1', ACCOUNTS = 'https://accounts.spotify.com';

  const redirectUri = () => location.origin + location.pathname;
  // Spotify only sends people back to https:// pages, or http://127.0.0.1 while testing on your computer
  const canRedirect = () => location.protocol === 'https:' || /^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?$/.test(location.origin);
  const read = (store, k) => { try { return JSON.parse(store.getItem(k)); } catch { return null; } };
  const write = (store, k, v) => { try { v === null ? store.removeItem(k) : store.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const sha256 = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));

  async function tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.error || `Spotify sign-in failed (${res.status})`);
    const t = { access: j.access_token, refresh: j.refresh_token || read(localStorage, TOKEN)?.refresh, scope: j.scope ?? read(localStorage, TOKEN)?.scope ?? '', exp: Date.now() + (j.expires_in - 60) * 1000 };
    write(localStorage, TOKEN, t);
    return t;
  }
  async function token() {
    const t = read(localStorage, TOKEN);
    if (t?.access && t.exp > Date.now()) return t.access;
    if (t?.refresh) {
      try { return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })).access; } catch { write(localStorage, TOKEN, null); }
    }
    return null;
  }
  async function api(path, body, access) {
    const res = await fetch(API + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { write(localStorage, TOKEN, null); throw new Error('Your Spotify sign-in expired. Try again.'); }
    if (res.status === 403) throw new Error("Spotify didn't allow it. This site's Spotify app only works for accounts its owner has added (Spotify allows 5). Ask them to add yours.");
    if (!res.ok) throw new Error(j.error?.message || `Spotify error (${res.status})`);
    return j;
  }
  async function get(path) {
    const access = await token();
    if (!access) throw new Error('Connect Spotify first.');
    const res = await fetch(path.startsWith('http') ? path : API + path, { headers: { Authorization: `Bearer ${access}` } });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { write(localStorage, TOKEN, null); throw new Error('Your Spotify sign-in expired. Connect again.'); }
    if (res.status === 403) throw new Error("Spotify didn't allow it. It only shares the songs of playlists you own or collaborate on, and this site's Spotify app only works for accounts its owner has added.");
    if (res.status === 429) throw new Error('Spotify is busy. Try again in a minute.');
    if (!res.ok) throw new Error(j.error?.message || `Spotify error (${res.status})`);
    return j;
  }
  // Leave for Spotify's sign-in page; loader.js calls finish() when it sends you back.
  async function leave(pending) {
    if (!CLIENT_ID) throw new Error("Spotify sign-in isn't set up on this site yet (README → Saving playlists to Spotify).");
    if (!canRedirect()) throw new Error('Spotify sign-in only works when the site is opened from its web address (https://…), not from a file on your computer.');
    const verifier = randomString(64), state = randomString(16);
    write(sessionStorage, PENDING, { ...pending, verifier, state, back: location.href });
    const q = new URLSearchParams({
      response_type: 'code', client_id: CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri(), state,
      code_challenge_method: 'S256', code_challenge: b64url(await sha256(verifier)),
    });
    location.assign(`${ACCOUNTS}/authorize?${q}`);
    return new Promise(() => {}); // the page is leaving
  }
  async function create(p, access) {
    const pl = await api('/me/playlists', { name: p.name, description: p.description || '', public: false }, access);
    for (let i = 0; i < p.uris.length; i += 100) await api(`/playlists/${pl.id}/items`, { uris: p.uris.slice(i, i + 100) }, access);
    return { name: p.name, url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`, count: p.uris.length };
  }

  return {
    configured: () => !!CLIENT_ID,
    canRedirect,
    // Save a playlist. Signs in first if needed (leaves the page and comes back).
    async save(p) {
      if (!CLIENT_ID) throw new Error("Saving to Spotify isn't set up on this site yet.");
      const access = await token();
      if (access) return create(p, access);
      return leave({ p });
    },
    // Sign in without saving anything (the guessing game, to read your playlists).
    signIn: () => leave({}),
    // Signed in, and with permission to read playlists (sign-ins from before that was asked for don't have it).
    canReadPlaylists: () => { const t = read(localStorage, TOKEN); return !!t?.refresh && String(t.scope || '').includes('playlist-read-private'); },
    // Your playlists: [{ id, name, total }]. Spotify lists ones you follow too, but only shares the songs of your own.
    async playlists() {
      const out = [];
      for (let url = '/me/playlists?limit=50'; url && out.length < 1000;) {
        const j = await get(url);
        for (const p of j.items || []) if (p?.id) out.push({ id: p.id, name: p.name || 'Untitled', total: p.items?.total ?? p.tracks?.total ?? null });
        url = j.next;
      }
      return out;
    },
    // The songs in one playlist: [{ id, name, artist }] (no podcasts, no local files).
    async playlistSongs(id) {
      const out = [];
      for (let url = `/playlists/${id}/items?limit=50`; url && out.length < 10000;) {
        const j = await get(url);
        for (const row of j.items || []) {
          const t = row?.item ?? (row?.track && typeof row.track === 'object' ? row.track : null); // "track" was renamed "item" in 2026
          if (t?.name && (!t.type || t.type === 'track')) out.push({ id: t.id || '', name: t.name, artist: t.artists?.[0]?.name || '' });
        }
        url = j.next;
      }
      return out;
    },
    isCallback() {
      const q = new URLSearchParams(location.search);
      return (q.has('code') || q.has('error')) && q.has('state') && !!read(sessionStorage, PENDING);
    },
    // Back from Spotify's sign-in: finish signing in, save the playlist, return to where you were.
    async finish(say = () => {}) {
      const q = new URLSearchParams(location.search), pending = read(sessionStorage, PENDING);
      write(sessionStorage, PENDING, null);
      let result;
      try {
        if (q.get('state') !== pending.state) throw new Error('Spotify sign-in got mixed up. Try again.');
        if (q.has('error')) throw new Error(q.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify sign-in failed (${q.get('error')}).`);
        say('Signing in to Spotify…');
        const t = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pending.verifier });
        if (pending.p) {
          say('Saving your playlist…');
          result = { ok: true, ...(await create(pending.p, t.access)) };
        }
      } catch (e) { result = { ok: false, error: e.message, name: pending?.p?.name }; }
      if (pending?.p) write(sessionStorage, RESULT, result); else if (result) write(sessionStorage, SIGNIN, result.error);
      location.replace(pending?.back || redirectUri());
    },
    takeSignInError() { const r = read(sessionStorage, SIGNIN); write(sessionStorage, SIGNIN, null); return r; },
    takeResult() { const r = read(sessionStorage, RESULT); write(sessionStorage, RESULT, null); return r; },
    signedIn: () => !!read(localStorage, TOKEN)?.refresh,
    signOut: () => write(localStorage, TOKEN, null),
  };
})();
