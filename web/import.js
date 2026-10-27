// Load your own Spotify data: unzip + process in the browser (same rules as build.py),
// then keep the result in this browser so it replaces the default data on every visit.
// Nothing is uploaded anywhere.
(() => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------- reading the zip (no library: the browser can inflate on its own) ----------
  async function zipEntries(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("That file isn't a zip.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (p === 0xffffffff) throw new Error('This zip is in a format the browser reader doesn\'t handle (ZIP64). Unzip it and pick the .json files instead.');
    const entries = [];
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The zip looks damaged.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      entries.push({
        name,
        async text() {
          const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
          const raw = buf.subarray(start, start + csize);
          if (method === 0) return dec.decode(raw);
          if (method !== 8) throw new Error(`${name} uses a compression the browser can't read.`);
          return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
        },
      });
    }
    return entries;
  }

  // Which files hold listening history. Extended export = the full one; basic = last year only.
  const base = (n) => n.split('/').pop();
  const KINDS = [
    { kind: 'extended', re: /^Streaming_History_Audio_.*\.json$/ },
    { kind: 'extended', re: /^endsong_.*\.json$/ },
    { kind: 'basic', re: /^StreamingHistory_?(music_)?\d+\.json$/ },
  ];
  const kindOf = (n) => KINDS.find((k) => k.re.test(base(n)))?.kind;

  async function collectFiles(fileList) {
    const out = [];
    for (const f of fileList) {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
        for (const e of await zipEntries(f)) if (!e.name.endsWith('/') && kindOf(e.name)) out.push({ name: e.name, kind: kindOf(e.name), text: e.text });
      } else if (kindOf(f.name)) {
        out.push({ name: f.name, kind: kindOf(f.name), text: () => f.text() });
      }
    }
    // Same order as build.py (sorted by name), so results match it exactly.
    out.sort((a, b) => (base(a.name) < base(b.name) ? -1 : base(a.name) > base(b.name) ? 1 : 0));
    const hasExtended = out.some((f) => f.kind === 'extended');
    return hasExtended ? out.filter((f) => f.kind === 'extended') : out;
  }

  // ---------- processing: a straight port of build.py ----------
  const SKIP_ENDS = new Set(['fwdbtn', 'backbtn', 'endplay', 'clickrow']);
  const SLOT_MIN = 15, SLOTS = (24 * 60) / SLOT_MIN, HEX = '0123456789abcdef';
  const pyRound = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; }; // Python's round()
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  // Local wall-clock time as a "naive" timestamp (UTC fields hold local time), like Python's naive datetimes.
  const wall = (epochMs) => { const d = new Date(epochMs); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()); };
  const DAY = 86400000;

  function normalize(e, kind) {
    if (kind === 'basic') { // basic export: { endTime: "2024-01-31 18:04", artistName, trackName, msPlayed }
      return {
        ts: e.endTime ? e.endTime.replace(' ', 'T') + ':00Z' : null, ms: e.msPlayed, track: e.trackName,
        artist: e.artistName, album: '', reasonEnd: null, skipped: null, uri: null,
      };
    }
    return {
      ts: e.ts, ms: e.ms_played, track: e.master_metadata_track_name, artist: e.master_metadata_album_artist_name,
      album: e.master_metadata_album_album_name, reasonEnd: e.reason_end, skipped: e.skipped, uri: e.spotify_track_uri,
    };
  }

  async function process(files, progress) {
    const plays = []; // [songKey, startWall, ms, skipped]
    const songLen = new Map(), uris = new Map();
    for (let fi = 0; fi < files.length; fi++) {
      progress(`Reading ${base(files[fi].name)}`, (fi / files.length) * 0.6);
      await tick();
      let list;
      try { list = JSON.parse(await files[fi].text()); } catch { throw new Error(`${base(files[fi].name)} isn't valid JSON.`); }
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const e = normalize(raw, files[fi].kind);
        if (!e.track || !e.ts) continue;
        const ms = Math.trunc(Number(e.ms) || 0);
        if (ms < 1000) continue;
        const end = Date.parse(e.ts);
        if (!Number.isFinite(end)) continue;
        const key = `${e.track}\u0000${e.artist || 'Unknown artist'}\u0000${e.album || ''}`;
        const skipped = Boolean(e.skipped) || SKIP_ENDS.has(e.reasonEnd);
        plays.push([key, wall(end - ms), ms, skipped]);
        if (e.reasonEnd === 'trackdone' && ms > (songLen.get(key) || 0)) songLen.set(key, ms);
        if (typeof e.uri === 'string' && e.uri.startsWith('spotify:track:')) {
          let c = uris.get(key);
          if (!c) uris.set(key, (c = new Map()));
          const id = e.uri.slice(e.uri.lastIndexOf(':') + 1);
          c.set(id, (c.get(id) || 0) + 1);
        }
      }
      list = null;
    }
    if (!plays.length) throw new Error('No music plays found in those files.');

    // every month first..last, every day in those months
    let first = Infinity, last = -Infinity;
    for (const p of plays) { if (p[1] < first) first = p[1]; if (p[1] > last) last = p[1]; }
    const f = new Date(first), l = new Date(last);
    const months = [];
    for (let y = f.getUTCFullYear(), m = f.getUTCMonth(); y < l.getUTCFullYear() || (y === l.getUTCFullYear() && m <= l.getUTCMonth()); m === 11 ? (y++, m = 0) : m++) months.push(`${y}-${pad(m + 1)}`);
    const monthIx = new Map(months.map((mo, i) => [mo, i]));
    const day0 = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1);
    const nDays = Math.round((Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 1) - day0) / DAY);

    const totals = new Map(); // "key\0month" -> [plays, sec, skips, mPlays, heard, mSkips, skipHeard]
    const skipHist = {}, playHist = {};
    const daySec = new Array(nDays).fill(0), dayHeard = new Array(nDays).fill(0), dayLen = new Array(nDays).fill(0);
    const slots = new Array(nDays).fill(null);
    for (let i = 0; i < plays.length; i++) {
      if (i % 25000 === 0) { progress('Crunching numbers', 0.6 + (i / plays.length) * 0.35); await tick(); }
      const [key, start, ms, skipped] = plays[i];
      const sd = new Date(start);
      const month = `${sd.getUTCFullYear()}-${pad(sd.getUTCMonth() + 1)}`;
      const tk = `${key}\u0000${month}`;
      let t = totals.get(tk);
      if (!t) totals.set(tk, (t = [0, 0, 0, 0, 0, 0, 0]));
      t[0] += 1; t[1] += Math.floor(ms / 1000); t[2] += skipped ? 1 : 0;
      const d = Math.floor((Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate()) - day0) / DAY);
      daySec[d] += Math.floor(ms / 1000);
      const length = songLen.get(key);
      if (length) {
        const heard = Math.min(1000, pyRound((ms * 1000) / length));
        t[3] += 1; t[4] += heard;
        (playHist[month] ||= new Array(10).fill(0))[Math.min(9, Math.floor(heard / 100))] += 1;
        dayHeard[d] += Math.floor(Math.min(ms, length) / 1000);
        dayLen[d] += Math.floor(length / 1000);
        if (skipped) {
          t[5] += 1; t[6] += heard;
          (skipHist[month] ||= new Array(10).fill(0))[Math.min(9, Math.floor(heard / 100))] += 1;
        }
      }
      // spread the play over the 15-minute slots it covers
      let cur = start;
      const end = start + ms;
      while (cur < end) {
        const c = new Date(cur);
        const slot = Math.floor((c.getUTCHours() * 60 + c.getUTCMinutes()) / SLOT_MIN);
        const dayStart = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
        const segEnd = Math.min(end, dayStart + (slot + 1) * SLOT_MIN * 60000);
        const di = Math.floor((dayStart - day0) / DAY);
        if (di >= 0 && di < nDays) (slots[di] ||= new Array(SLOTS).fill(0))[slot] += (segEnd - cur) / 1000;
        cur = segEnd;
      }
    }
    progress('Packing it up', 0.96);
    await tick();
    const encode = (day) => (day ? day.map((s) => HEX[Math.min(15, pyRound(s / 60) || (s >= 10 ? 1 : 0))]).join('').replace(/0+$/, '') : '');

    // order like build.py: by month, then first-seen order
    const items = [...totals.entries()].map(([k, t], i) => { const parts = k.split('\u0000'); return { parts, t, i }; });
    items.sort((a, b) => (a.parts[3] < b.parts[3] ? -1 : a.parts[3] > b.parts[3] ? 1 : a.i - b.i));
    const artists = [], artistIx = new Map(), songs = [], songIx = new Map(), rows = [];
    for (const { parts: [song, artist, album, month], t } of items) {
      if (!artistIx.has(artist)) { artistIx.set(artist, artists.length); artists.push(artist); }
      const sk = `${song}\u0000${artist}\u0000${album}`;
      if (!songIx.has(sk)) {
        songIx.set(sk, songs.length);
        let best = '', bestN = 0;
        for (const [id, n] of uris.get(sk) || []) if (n > bestN) { best = id; bestN = n; }
        songs.push([song, artistIx.get(artist), album, Math.floor((songLen.get(sk) || 0) / 1000), best]);
      }
      rows.push(songIx.get(sk), monthIx.get(month), ...t);
    }
    return {
      months, artists, songs, cols: 9, rows, skipHist, playHist,
      days: { start: new Date(day0).toISOString().slice(0, 10), slotMin: SLOT_MIN, sec: daySec, heard: dayHeard, len: dayLen, slots: slots.map(encode) },
      _plays: plays.length,
    };
  }

  // ---------- UI ----------
  const src = window.SPOTIFY_SOURCE || { kind: 'default' };
  const D = window.SPOTIFY;
  const bar = document.getElementById('sourceBar');
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  bar.innerHTML = src.kind === 'mine'
    ? `<span><b>Your data</b> · loaded ${fmtDate(src.savedAt)} · ${src.basic ? 'last-year export · ' : ''}stays in this browser only</span>
       <span class="sb-actions"><button class="ghost" data-act="pick">Load newer data</button><button class="ghost" data-act="remove">Remove my data</button></span>`
    : `<span>You're looking at ${D.name ? `<b>${D.name}'s</b>` : 'an example'} Spotify history.</span>
       <span class="sb-actions"><button class="primary" data-act="pick">⬆ Load your own Spotify data</button></span>`;
  bar.hidden = false;

  const dlg = document.getElementById('importDlg');
  const input = document.getElementById('importFile');
  const show = (html) => { dlg.querySelector('.imp-body').innerHTML = html; if (!dlg.open) dlg.showModal(); };
  const intro = () => show(`
    <h2>Load your own Spotify data</h2>
    <p>Pick the <b>.zip</b> Spotify emailed you (or the .json files inside it). It's processed right here in your browser and saved in this browser only. Nothing is uploaded.</p>
    <div class="imp-drop" data-act="choose"><b>Choose file…</b><span>or drop it here</span></div>
    <details><summary>How do I get my data?</summary>
      <ol><li>On spotify.com go to <b>Account → Privacy settings</b> (“Download your data”).</li>
      <li>Tick <b>Extended streaming history</b> for your full history. (“Account data” also works but only covers about the last year.)</li>
      <li>Spotify emails you a zip, which can take a few days to a few weeks.</li></ol>
    </details>
    <div class="imp-foot"><button class="ghost" data-act="close">Cancel</button></div>`);

  async function run(fileList) {
    const t0 = performance.now();
    const step = (label, frac) => show(`<h2>Reading your data…</h2><p class="imp-step">${label}</p>
      <div class="imp-bar"><i style="width:${Math.round(frac * 100)}%"></i></div><p class="muted small">Keep this tab open. It usually takes a few seconds.</p>`);
    try {
      step('Opening the file', 0);
      const files = await collectFiles(fileList);
      if (!files.length) throw new Error("Couldn't find any listening history in that. Look for files named Streaming_History_Audio_….json (extended export) or StreamingHistory_music_….json (account data).");
      const data = await process(files, step);
      const basic = files.every((f) => f.kind === 'basic');
      const meta = { savedAt: Date.now(), plays: data._plays, from: data.months[0], to: data.months.at(-1), basic };
      delete data._plays;
      step('Saving in this browser', 0.99);
      try { await window.SpotifyStore.save(data, meta); } catch {
        throw new Error("Your browser wouldn't let this page save data (private window, or the page was opened as a file in a browser that blocks storage). Try a normal window, or open the page from a web address.");
      }
      window.__lastImport = data;
      show(`<h2>Done</h2><p>${meta.plays.toLocaleString()} plays from ${meta.from} to ${meta.to}, processed in ${((performance.now() - t0) / 1000).toFixed(1)} s.${basic ? ' This is the account-data export, so it only covers about the last year and has no skip or retention details.' : ''}</p>
        <div class="imp-foot"><button class="primary" data-act="reload">Show my stats</button></div>`);
    } catch (e) {
      show(`<h2>That didn't work</h2><p>${String(e.message || e)}</p><div class="imp-foot"><button class="ghost" data-act="close">Close</button><button class="primary" data-act="choose">Try another file</button></div>`);
    }
  }

  const reloadClean = () => { location.hash = ''; location.reload(); };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('#sourceBar [data-act], #importDlg [data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'pick') intro();
    if (act === 'choose') input.click();
    if (act === 'close') dlg.close();
    if (act === 'reload') reloadClean();
    if (act === 'remove') {
      if (!confirm('Remove your data from this browser and go back to the example?')) return;
      await window.SpotifyStore.remove();
      reloadClean();
    }
  });
  input.addEventListener('change', () => { if (input.files.length) run([...input.files]); input.value = ''; });
  // drag a zip anywhere onto the page
  window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    document.body.classList.remove('dropping');
    run([...e.dataTransfer.files]);
  });

  window.SpotifyImport = { process, collectFiles }; // used by the test page
})();
