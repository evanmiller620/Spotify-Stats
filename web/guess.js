// Guess the song: pick some filters (or a preset), get a shuffled queue of songs from this listening
// history, hear a clip of each and name it from a box that completes titles as you type.
// Only songs with English titles are asked (english.js decides). Uses app.js's data and helpers
// (D, N, years, aggregate, songFirst, songLast, hay, libraryRows, loadSpotifyApi, …).
//
// Sound: Spotify's embedded player, covered up until the answer is shown. If that can't load, or a
// song has no Spotify id, a 30-second preview from the iTunes catalogue is used instead.
(() => {
  const E = window.EnglishTitle, body = $('guessBody'), foot = $('guessFoot'), stage = $('ggStage');
  if (!E || !body || !foot || !stage) return;

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };
  const KEY = 'spotifyStats.guess', SAVED_KEY = 'spotifyStats.guessPresets';
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
  const shuffle = (list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  // ---------- filters ----------
  // period: 'all' | 'l12' | a year. top: keep the N most-listened that match. pmin/pmax: plays in the period.
  // fy0/fy1: year first played. last: any | recent (played in the last 12 months) | old (not).
  // fresh: first played in the period. per: at most this many songs per artist. lib: use the Library's own filters.
  const blank = () => ({ period: 'all', top: 0, pmin: null, pmax: null, fy0: '', fy1: '', last: 'any', fresh: false, artist: '', exclude: '', per: 0, lib: false });
  const lastYear = years.at(-1), hasL12 = typeof LAST12 !== 'undefined' && !!LAST12;
  const PRESETS = [
    ['★ Top 100', { top: 100 }, 'The 100 songs with the most listening time'],
    ['🔁 On repeat', { pmin: 30 }, 'Songs played 30 times or more'],
    [`📅 Best of ${lastYear}`, { period: lastYear, top: 100 }, `The 100 most-listened songs of ${lastYear}`],
    hasL12 && ['🌱 New finds', { period: 'l12', fresh: true, pmin: 3 }, 'First played in the last 12 months, 3+ plays'],
    years.length > 5 && ['⏪ Throwbacks', { fy1: String(+lastYear - 5), pmin: 5 }, `First played in ${+lastYear - 5} or earlier, 5+ plays`],
    N > 24 && ['🕸 Forgotten favorites', { pmin: 10, last: 'old' }, '10+ plays, none in the last 12 months'],
    ['🎭 One per artist', { top: 300, per: 1 }, 'The top song of each of the 300 biggest artists'],
    ['💎 Deep cuts', { pmin: 2, pmax: 5 }, 'Played only 2 to 5 times. Hard.'],
    ['🎲 Anything', {}, 'Every song'],
  ].filter(Boolean);

  function clean(f) { // settings saved from other data may name years this data doesn't have
    const o = Object.assign(blank(), f);
    if (!['all', ...(hasL12 ? ['l12'] : []), ...years].includes(o.period)) o.period = 'all';
    for (const k of ['fy0', 'fy1']) if (!years.includes(o[k])) o[k] = '';
    for (const k of ['pmin', 'pmax']) o[k] = Number.isFinite(o[k]) && o[k] >= 0 ? o[k] : null;
    if (!['any', 'recent', 'old'].includes(o.last)) o.last = 'any';
    o.top = +o.top || 0; o.per = +o.per || 0; o.fresh = !!o.fresh; o.lib = !!o.lib;
    o.artist = String(o.artist || ''); o.exclude = String(o.exclude || '');
    return o;
  }
  const stored = read(KEY, {});
  const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
  const G = {
    view: 'setup', f: clean(stored.f || PRESETS[0][1]),
    rounds: pick(stored.rounds, [5, 10, 20, 30, 50], 10), clip: pick(stored.clip, [3, 5, 10, 15, 30], 10), tries: pick(stored.tries, [1, 3, 5], 3),
    mode: pick(stored.mode, ['normal', 'five'], 'normal'), start: pick(stored.start, ['begin', 'random'], 'begin'),
    pool: null,
  };
  const remember = () => write(KEY, { f: G.f, rounds: G.rounds, clip: G.clip, tries: G.tries, mode: G.mode, start: G.start });
  // 5-second mode: five seconds of the song and no more
  const clipLen = () => (G.mode === 'five' ? 5 : G.clip);
  const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

  const rangeOf = (p) => (p === 'all' ? [0, N - 1] : p === 'l12' ? LAST12 : yearRange(p));
  const aggs = new Map();
  const aggFor = (p) => { if (!aggs.has(p)) aggs.set(p, aggregate(rangeOf(p))); return aggs.get(p); };
  const artistLc = D.artists.map((a) => a.toLowerCase());

  // The songs the filters leave, most-listened first: one entry per title + artist (other versions are folded in).
  function buildPool(f) {
    let rows = [];
    if (f.lib) {
      const v = L.view;
      L.view = 'songs';
      try { rows = filterRows(libraryRows()).map((r) => ({ s: r.id, plays: r.plays, sec: r.sec })); } finally { L.view = v; }
    } else {
      const [from] = rangeOf(f.period);
      const arts = f.artist.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
      const outs = f.exclude.toLowerCase().split(/[\s,]+/).filter(Boolean);
      for (const [s, v] of aggFor(f.period).songs) {
        if (f.pmin !== null && v[0] < f.pmin) continue;
        if (f.pmax !== null && v[0] > f.pmax) continue;
        const fy = monthYear[songFirst[s]];
        if ((f.fy0 && fy < f.fy0) || (f.fy1 && fy > f.fy1)) continue;
        if (f.fresh && from > 0 && songFirst[s] < from) continue;
        if (f.last === 'recent' && songLast[s] < N - 12) continue;
        if (f.last === 'old' && songLast[s] >= N - 12) continue;
        if (arts.length && !arts.some((t) => artistLc[D.songs[s][1]].includes(t))) continue;
        if (outs.length && outs.some((w) => hay[s].includes(w))) continue;
        rows.push({ s, plays: v[0], sec: v[1] });
      }
    }
    rows.sort((x, y) => y.sec - x.sec || x.s - y.s);
    const seen = new Map();
    let list = [], foreign = 0;
    for (const r of rows) {
      const [name, a, album, , id] = D.songs[r.s];
      if (!E.is(name)) { foreign++; continue; }
      const key = E.key(name);
      if (!key) continue; // nothing to type: "$$$", ". . ."
      const dup = seen.get(`${key}|${a}`);
      if (dup) { dup.plays += r.plays; dup.sec += r.sec; continue; }
      const o = { s: r.s, key, title: E.core(name), a, artist: D.artists[a], album, id: id || '', len: D.songs[r.s][3] || 0, plays: r.plays, sec: r.sec };
      seen.set(`${key}|${a}`, o);
      list.push(o);
    }
    if (f.lib) return { list, foreign }; // the Library's view as it is
    if (f.per) { const c = new Map(); list = list.filter((o) => { const n = (c.get(o.a) || 0) + 1; c.set(o.a, n); return n <= f.per; }); }
    if (f.top) list = list.slice(0, f.top);
    return { list, foreign };
  }

  // ---------- titles the guess box completes: every English-titled song in this history ----------
  let titles = null;
  function allTitles() {
    if (titles) return titles;
    const by = new Map();
    D.songs.forEach(([name, a], s) => {
      if (!E.is(name)) return;
      const key = E.key(name);
      if (!key) return;
      const k = `${key}|${a}`, o = by.get(k);
      if (o) { o.w += songAllSec[s]; return; }
      const title = E.core(name);
      by.set(k, { key, title, a, artist: D.artists[a], t: plain(title), lc: plain(`${title} ${D.artists[a]}`), w: songAllSec[s] });
    });
    return (titles = [...by.values()]);
  }
  // Best matches first: title starts with what you typed, then a word in it does, then anywhere, then the artist.
  function suggest(q, max = 8) {
    const text = plain(q).trim(), toks = text.split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    const out = [];
    for (const c of allTitles()) {
      if (!toks.every((t) => c.lc.includes(t))) continue;
      const at = c.t.indexOf(text);
      out.push([at === 0 ? 0 : at > 0 && /[^a-z0-9]/.test(c.t[at - 1]) ? 1 : at > 0 ? 2 : 3, c]);
    }
    return out.sort((x, y) => x[0] - y[0] || y[1].w - x[1].w).slice(0, max).map((x) => x[1]);
  }
  function mark(text, q) { // bold the part you typed
    const toks = plain(q).split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!toks.length || plain(text).length !== text.length) return esc(text);
    return text.split(new RegExp(`(${toks.join('|')})`, 'gi')).map((p, i) => (i % 2 ? `<b>${esc(p)}</b>` : esc(p))).join('');
  }

  // ---------- the clip player ----------
  // One interface over two sources. load(song) → true when it can be played; play(fromStart); pause();
  // limit = seconds to stop at (0 = no limit); onChange is called whenever position or state changes.
  const Clip = (() => {
    // pos and limit count from start, the spot in the song where the clip begins (0, or a random one)
    const st = { mode: null, pos: 0, at: 0, paused: true, started: false, ended: false, stuck: false, limit: 0, start: 0, dur: 0, random: false, rand: 0, base: 0 };
    let onChange = () => {}, cut = 0, stuck = 0, again = [], jumped = 0;
    // A random spot: past the first tenth of the song, with room left for the clip and a couple of +5s.
    const startFor = (dur) => {
      const room = dur - st.base - 12;
      if (!st.random || room < 4) return 0;
      const lo = Math.min(room, dur * 0.1);
      return Math.round((lo + st.rand * (room - lo)) * 10) / 10;
    };
    const now = () => performance.now();
    function update(abs, paused, dur) {
      if (dur > 0 && Math.abs(dur - st.dur) > 1 && st.limit) { // the player's own idea of the length (a preview is 30 s) wins
        const had = st.dur;
        st.dur = dur;
        if (!had || st.start + st.base > dur - 2) st.start = startFor(dur); // no length on file, or the spot we picked is past the end
      }
      // playing from before (or well past) the clip: put it where the clip starts, and don't count what leaked
      if (st.mode === 'spotify' && st.limit && st.start > 0 && !paused && (abs < st.start - 0.7 || abs > st.start + st.limit + 2) && !st.ended) {
        if (now() - jumped > 1200) {
          jumped = now();
          if (++st.jumps > 3) st.start = 0; // it won't go there: play it from wherever it is
          else call('seek', st.start);
        }
        if (st.start) return;
      }
      const pos = Math.max(0, abs - st.start);
      Object.assign(st, { pos, paused, at: now() });
      if (!paused) { st.started = true; clearTimeout(stuck); again.forEach(clearTimeout); }
      clearTimeout(cut);
      if (st.limit && !paused) {
        if (pos >= st.limit - 0.03) { st.ended = true; pause(); } else cut = setTimeout(() => { st.ended = true; pause(); onChange(); }, (st.limit - pos) * 1000);
      }
      onChange();
    }

    // Spotify's embed. It stays in the page under a cover (it has to be on screen to keep playing reliably).
    let ctrlP = null, ctrl = null, track = null, off = false, wantPlay = false;
    const call = (name, ...args) => { try { if (ctrl && typeof ctrl[name] === 'function') { ctrl[name](...args); return true; } } catch { /* not ready */ } return false; };
    function spotify(id) {
      if (!ctrlP) {
        ctrlP = (async () => {
          const api = await loadSpotifyApi();
          if (!api) return null;
          return new Promise((resolve) => {
            const t = setTimeout(() => resolve(null), 8000);
            try {
              api.createController($('ggFrame'), { uri: `spotify:track:${id}`, width: '100%', height: 80 }, (c) => {
                ctrl = c; track = id;
                c.addListener('ready', () => { if (wantPlay) { wantPlay = false; call('play'); } });
                c.addListener('playback_update', (e) => { if (st.mode === 'spotify') update((e.data.position || 0) / 1000, !!e.data.isPaused, (e.data.duration || 0) / 1000); });
                clearTimeout(t); resolve(c);
              });
            } catch { clearTimeout(t); resolve(null); }
          });
        })();
      }
      return ctrlP;
    }

    // iTunes previews: look the song up by title and artist, play the 30-second clip.
    const audio = new Audio();
    audio.preload = 'auto';
    for (const ev of ['timeupdate', 'playing', 'pause', 'ended']) audio.addEventListener(ev, () => { if (st.mode === 'apple') update(audio.currentTime, audio.paused); });
    const jsonp = (url) => new Promise((resolve, reject) => {
      const cb = `__gg${Math.random().toString(36).slice(2)}`, sc = document.createElement('script');
      const done = () => { clearTimeout(t); window[cb] = () => {}; sc.remove(); };
      const t = setTimeout(() => { done(); reject(new Error('timeout')); }, 9000);
      window[cb] = (d) => { done(); resolve(d); };
      sc.onerror = () => { done(); reject(new Error('network')); };
      sc.src = `${url}&callback=${cb}`;
      document.head.appendChild(sc);
    });
    const previews = new Map();
    async function preview(song) {
      if (previews.has(song.s)) return previews.get(song.s);
      let url = null;
      try {
        const data = await jsonp(`https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(`${song.title} ${song.artist}`)}`);
        const want = plain(song.artist).replace(/[^a-z0-9]/g, '');
        const hit = (data.results || []).find((r) => {
          if (!r.previewUrl || !r.trackName || E.key(r.trackName) !== song.key) return false;
          const a = plain(r.artistName || '').replace(/[^a-z0-9]/g, '');
          return a && (a.includes(want) || want.includes(a));
        });
        url = hit ? hit.previewUrl : null;
      } catch { /* offline or blocked */ }
      previews.set(song.s, url);
      return url;
    }

    function pause() {
      clearTimeout(cut); again.forEach(clearTimeout); wantPlay = false;
      if (st.mode === 'spotify') call('pause'); else if (st.mode === 'apple') audio.pause();
    }
    return {
      st,
      set onChange(fn) { onChange = fn; },
      async load(song, random) {
        pause(); clearTimeout(stuck);
        Object.assign(st, { pos: 0, at: now(), paused: true, started: false, ended: false, stuck: false, start: 0, dur: 0, jumps: 0, random: !!random, rand: Math.random(), base: st.limit });
        if (song.id && !off) {
          const c = await spotify(song.id);
          if (c) {
            audio.pause(); st.mode = 'spotify';
            st.dur = song.len; st.start = song.len ? startFor(song.len) : 0;
            if (track !== song.id) { track = song.id; call('loadUri', `spotify:track:${song.id}`, false, st.start); }
            return true;
          }
          off = true; // Spotify's player didn't load: previews from here on
        }
        const url = await preview(song);
        if (!url) return false;
        st.mode = 'apple';
        st.dur = 30; st.start = startFor(30);
        audio.src = url;
        return true;
      },
      play(fromStart) {
        st.ended = false;
        clearTimeout(stuck);
        if (!st.started) stuck = setTimeout(() => { if (!st.started) { st.stuck = true; onChange(); } }, 8000);
        st.stuck = false;
        if (st.mode === 'spotify') {
          if (fromStart || !st.started) {
            if (st.started) call('seek', st.start); // again from where the clip starts
            wantPlay = true; call('play');
            // a song that was only just handed to the player can miss the first request
            again.forEach(clearTimeout);
            if (!st.started) again = [900, 2500].map((ms) => setTimeout(() => { if (!st.started && st.mode === 'spotify') call('play'); }, ms));
          } else if (!call('resume')) call('togglePlay');
        } else if (st.mode === 'apple') {
          if (fromStart) { try { audio.currentTime = st.start; } catch { /* not loaded yet */ } }
          audio.play().catch(() => { st.stuck = true; onChange(); });
        }
      },
      pause,
      // where the clip is right now (the sources only report every so often)
      position() { const p = st.paused ? st.pos : st.pos + (now() - st.at) / 1000; return st.limit ? Math.min(p, st.limit) : p; },
      usePreviews() { off = true; },
      // is there song left for 5 more seconds?
      canExtend() { return !st.dur || st.start + st.limit + 5 <= st.dur; },
      get spotifyOff() { return off; },
    };
  })();

  // ---------- setup screen ----------
  const sel = (name, opts, cur) => `<select data-f="${name}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const savedPresets = () => read(SAVED_KEY, []).filter((p) => Array.isArray(p) && typeof p[0] === 'string');
  function presetsHtml() {
    return PRESETS.map(([name, f, tip], i) => `<button type="button" data-preset="${i}" title="${esc(tip)}" aria-pressed="${same(f, G.f)}">${name}</button>`).join('') +
      savedPresets().map(([name, f], i) => `<span class="saved"><button type="button" data-saved="${i}" aria-pressed="${same(f, G.f)}">${esc(name)}</button><button type="button" class="del" data-del="${i}" aria-label="Delete preset ${esc(name)}">×</button></span>`).join('');
  }
  function renderSetup() {
    G.view = 'setup';
    stage.hidden = true; foot.innerHTML = '';
    const f = G.f, whose = window.SPOTIFY_SOURCE?.kind === 'mine' ? 'your' : 'this';
    const yearOpts = [['', 'Any'], ...years.map((y) => [y, y])];
    body.innerHTML = `
      <h2>Guess the song</h2>
      <p class="muted small">A clip plays, you name the song. Pick a preset or set your own filters; the songs come from ${whose} listening history, in a random order. Only songs with English titles are asked.</p>
      <h3>Presets</h3>
      <div class="presets gg-presets" id="ggPresets">${presetsHtml()}</div>
      <h3>Filters</h3>
      <div class="gg-filters" id="ggFilters">
        <label>Period ${sel('period', [['all', 'All time'], ...(hasL12 ? [['l12', 'Last 12 months']] : []), ...years.map((y) => [y, y]).reverse()], f.period)}</label>
        <label>Keep the ${sel('top', [[0, 'whole list'], [25, 'top 25'], [50, 'top 50'], [100, 'top 100'], [250, 'top 250'], [500, 'top 500'], [1000, 'top 1,000']], f.top)}</label>
        <label>Plays <input type="number" min="0" inputmode="numeric" data-f="pmin" value="${f.pmin ?? ''}" placeholder="min"><span class="to">to</span><input type="number" min="0" inputmode="numeric" data-f="pmax" value="${f.pmax ?? ''}" placeholder="max"></label>
        <label>First played ${sel('fy0', yearOpts, f.fy0)}<span class="to">to</span>${sel('fy1', yearOpts, f.fy1)}</label>
        <label>Last played ${sel('last', [['any', 'any time'], ['recent', 'in the last 12 months'], ['old', 'not in the last 12 months']], f.last)}</label>
        <label>Per artist ${sel('per', [[0, 'any number'], [1, '1 song'], [2, 'up to 2'], [3, 'up to 3'], [5, 'up to 5']], f.per)}</label>
        <label class="wide">Artist <input type="text" data-f="artist" value="${esc(f.artist)}" placeholder="e.g. queen, eminem" autocomplete="off" spellcheck="false"></label>
        <label class="wide">Leave out <input type="text" data-f="exclude" value="${esc(f.exclude)}" placeholder="words in the title, artist or album: remix, live, op." autocomplete="off" spellcheck="false"></label>
        <label class="gg-check"><input type="checkbox" data-f="fresh"${f.fresh ? ' checked' : ''}> Only songs first played in this period</label>
        <label class="gg-check"><input type="checkbox" data-f="lib"${f.lib ? ' checked' : ''}> Use the Library's search and filters instead</label>
      </div>
      <h3>Game</h3>
      <div class="gg-filters">
        <label>Songs ${sel('rounds', [5, 10, 20, 30, 50].map((n) => [n, n]), G.rounds)}</label>
        <label>Mode ${sel('mode', [['normal', 'Normal'], ['five', '5 seconds only']], G.mode)}</label>
        <label>Clip length ${sel('clip', [3, 5, 10, 15, 30].map((n) => [n, `${n} seconds`]), G.clip)}</label>
        <label>Clip starts ${sel('start', [['begin', 'at the beginning'], ['random', 'at a random spot']], G.start)}</label>
        <label>Guesses per song ${sel('tries', [[1, '1'], [3, '3'], [5, '5']], G.tries)}</label>
      </div>
      <p class="gg-pool" id="ggPool" aria-live="polite"></p>
      <div class="gg-go">
        <button type="button" class="primary gg-start" data-act="start">▶ Start</button>
        <span id="ggSave"><button type="button" class="linkish" data-act="save">Save these filters as a preset…</button></span>
        <button type="button" class="linkish" data-act="reset">Reset</button>
      </div>`;
    refreshSetup();
  }
  function refreshSetup() {
    const f = G.f, box = $('ggFilters');
    if (!box) return;
    G.pool = buildPool(f);
    const n = G.pool.list.length, out = G.pool.foreign;
    // what doesn't apply right now is greyed out
    box.querySelectorAll('[data-f]').forEach((el) => {
      const k = el.dataset.f;
      el.disabled = (f.lib && k !== 'lib') || (k === 'fresh' && f.period === 'all');
      el.closest('label').classList.toggle('off', el.disabled);
    });
    const clipSel = body.querySelector('[data-f="clip"]'); // 5-second mode sets the length itself
    clipSel.disabled = G.mode === 'five';
    clipSel.closest('label').classList.toggle('off', clipSel.disabled);
    const rounds = Math.min(G.rounds, n);
    $('ggPool').innerHTML = (n ? `<b>${plural(n, 'song')}</b> to draw from` : 'No songs match these filters') +
      (f.lib ? ' (the Library\'s current view)' : '') +
      (out ? ` · ${plural(out, 'song')} left out because the title isn't in English` : '') +
      (n && n < G.rounds ? ` · the game will be ${plural(rounds, 'song')} long` : '') +
      (n > 0 && n < 4 ? ' · widen the filters for a real game' : '');
    body.querySelector('[data-act="start"]').disabled = n < 1;
    $('ggPresets').innerHTML = presetsHtml();
    remember();
  }

  // ---------- a game ----------
  const P = { queue: [], spare: [], i: 0, score: 0, log: [], cur: null, tries: [], extra: 0, hinted: false, over: false, loading: false, pickKey: null, sugg: [], hi: 0 };
  const points = () => Math.max(10, Math.round((100 * (G.tries - P.tries.length)) / G.tries) - 10 * P.extra - (P.hinted ? 20 : 0));

  function startGame() {
    const list = shuffle(buildPool(G.f).list);
    if (!list.length) return;
    try { if (PL.mode === 'dock') plStop(); } catch { /* the corner player isn't up */ }
    Object.assign(P, { queue: list.slice(0, G.rounds), spare: list.slice(G.rounds), i: 0, score: 0, log: [] });
    G.view = 'play';
    stage.hidden = false;
    allTitles();
    startRound();
  }

  async function startRound() {
    const song = P.queue[P.i];
    Object.assign(P, { cur: song, tries: [], extra: 0, hinted: false, over: false, loading: true, pickKey: null, sugg: [], hi: 0 });
    Clip.st.limit = clipLen();
    renderRound();
    const ok = await Clip.load(song, G.start === 'random');
    if (P.cur !== song || G.view !== 'play') return; // quit or moved on while it loaded
    if (!ok) { // no clip for this one: quietly use another song
      const sub = P.spare.shift();
      if (sub) { P.queue[P.i] = sub; return startRound(); }
      P.queue.splice(P.i, 1);
      if (P.i >= P.queue.length) return renderDone();
      return startRound();
    }
    P.loading = false;
    stage.classList.toggle('previews', Clip.st.mode === 'apple');
    Clip.play(true);
    paint();
    $('ggInput')?.focus({ preventScroll: true });
  }

  function renderRound() {
    stage.classList.remove('open');
    body.innerHTML = `<div class="gg-head">
        <div><h2>Guess the song</h2><p class="muted small">Song <b>${P.i + 1}</b> of ${P.queue.length} · worth <b id="ggWorth">${points()}</b> points</p></div>
        <div class="gg-score"><span class="muted small">Score</span><b>${num(P.score)}</b></div>
        <button type="button" class="ghost" data-act="quit">Quit</button>
      </div>`;
    $('ggCover').innerHTML = `<button type="button" class="gg-play" id="ggPlay" data-act="play" aria-label="Play the clip">▶</button>
      <div class="gg-prog"><div class="gg-track"><i id="ggBar"></i></div><div class="gg-time"><span id="ggState">Loading…</span><span id="ggClock"></span></div></div>
      <button type="button" class="ghost" id="ggMore" data-act="more" title="Hear 5 more seconds (costs 10 points)">+5 s</button>`;
    foot.innerHTML = `<div class="gg-guess">
        <div class="gg-box">
          <input id="ggInput" type="text" role="combobox" aria-expanded="false" aria-controls="ggList" aria-autocomplete="list" placeholder="Type the song title…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
          <ul class="gg-list" id="ggList" role="listbox" hidden></ul>
        </div>
        <button type="button" class="primary" data-act="guess">Guess</button>
      </div>
      <p class="gg-msg" id="ggMsg" aria-live="polite"></p>
      <ol class="gg-tries" id="ggTries"></ol>
      <div class="gg-actions">
        <button type="button" class="ghost" data-act="hint">Show the artist (−20)</button>
        <button type="button" class="ghost" data-act="skip">Give up</button>
      </div>`;
    paint();
  }

  // the cover over the player: button, progress, messages
  let raf = 0;
  function paint() {
    cancelAnimationFrame(raf);
    if (G.view !== 'play' || (P.over && Clip.st.mode !== 'apple')) return;
    const st = Clip.st, btn = $('ggPlay');
    if (!btn) return;
    const pos = Clip.position(), playing = !st.paused && !P.loading;
    $('ggBar').style.width = `${Math.min(100, (pos / (st.limit || 30)) * 100)}%`;
    $('ggClock').textContent = `${mmss(pos)} / ${mmss(st.limit || 30)}`;
    btn.textContent = playing ? '❚❚' : st.ended ? '↺' : '▶';
    btn.setAttribute('aria-label', playing ? 'Pause' : st.ended ? 'Play the clip again' : 'Play the clip');
    btn.disabled = P.loading;
    $('ggMore').hidden = G.mode === 'five';
    $('ggMore').disabled = P.loading || P.over || !st.limit || st.limit >= 30 || !Clip.canExtend();
    $('ggState').innerHTML = P.loading ? 'Loading…'
      : st.stuck && !st.started ? `It isn't starting. <button type="button" class="linkish" data-act="swap">Try another song</button>${Clip.spotifyOff ? '' : ' · <button type="button" class="linkish" data-act="previews">Use preview clips instead</button>'}`
        : playing ? 'Playing…' : st.ended ? 'That\'s the clip. Play it again?' : st.started ? 'Paused' : 'Press play';
    if (playing) raf = requestAnimationFrame(paint);
  }
  Clip.onChange = paint;

  // ----- the guess box -----
  function showList() {
    const input = $('ggInput'), ul = $('ggList');
    if (!input || !ul) return;
    P.sugg = P.pickKey ? [] : suggest(input.value);
    P.hi = Math.min(P.hi, Math.max(0, P.sugg.length - 1));
    ul.hidden = !P.sugg.length;
    input.setAttribute('aria-expanded', !ul.hidden);
    ul.innerHTML = P.sugg.map((c, i) => `<li role="option" id="ggOpt${i}" data-i="${i}" aria-selected="${i === P.hi}"><span>${mark(c.title, input.value)}</span><small>${esc(c.artist)}</small></li>`).join('') +
      (P.sugg.length ? '<li class="gg-keys" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Tab</kbd> fill in · <kbd>Enter</kbd> guess</li>' : '');
    if (P.sugg.length) input.setAttribute('aria-activedescendant', `ggOpt${P.hi}`); else input.removeAttribute('aria-activedescendant');
  }
  function choose(i) { // put a suggestion in the box; Guess (or Enter) then submits it
    const c = P.sugg[i], input = $('ggInput');
    if (!c) return;
    input.value = c.title;
    say('Enter to guess it.');
    P.pickKey = c.key; P.pickArtist = c.artist; P.pickA = c.a;
    showList();
    input.focus();
  }
  function say(text) { const m = $('ggMsg'); if (m) m.textContent = text; }
  function submitGuess() {
    if (P.over || P.loading) return;
    const input = $('ggInput'), text = input.value.trim();
    if (!text) { say('Type part of the title, then pick the song from the list.'); input.focus(); return; }
    let key = P.pickKey, artist = P.pickArtist, a = P.pickA, title = text;
    if (!key) { // typed out in full instead of picked
      const k = E.key(text), hit = k && allTitles().find((c) => c.key === k);
      if (!hit) {
        if (P.sugg.length) { choose(P.hi); return; }
        say('That isn\'t a song in this library. Pick one from the list.'); return;
      }
      key = hit.key; title = hit.title;
      ({ artist, a } = P.cur.key === key ? P.cur : hit);
    }
    if (P.tries.some((t) => t.key === key)) { say('You already tried that one.'); input.select(); return; }
    if (key === P.cur.key) return endRound('ok');
    P.tries.push({ key, title, artist, a });
    if (P.tries.length >= G.tries) return endRound('miss');
    input.value = ''; P.pickKey = null; showList();
    const left = G.tries - P.tries.length;
    say(`Not that one. ${left} guess${left === 1 ? '' : 'es'} left.`);
    $('ggTries').innerHTML = triesHtml();
    $('ggWorth').textContent = points();
    input.focus();
  }
  // an artist's name, as a link to that artist in the Library
  const artistLink = (a, name) => `<button type="button" class="gg-artist" data-ga="${a}" title="Show ${esc(name)} in the Library">${esc(name)}</button>`;
  const triesHtml = (links) => P.tries.map((t) => `<li><span class="x" aria-hidden="true">✕</span> ${esc(t.title)} <small class="muted">${links ? artistLink(t.a, t.artist) : esc(t.artist || '')}</small></li>`).join('');

  // ----- answer, next, results -----
  function endRound(result) {
    const song = P.cur, pts = result === 'ok' ? points() : 0;
    P.over = true;
    P.score += pts;
    P.log.push({ song, result, pts, wrong: P.tries.length });
    Clip.st.limit = 0; // let the song play on
    if (!Clip.st.started || Clip.st.paused) Clip.play(!Clip.st.started);
    stage.classList.add('open');
    body.querySelector('.gg-score b').textContent = num(P.score);
    const last = P.i + 1 >= P.queue.length;
    const s = song.s, first = monthLabel(D.months[songFirst[s]]);
    foot.innerHTML = `<div class="gg-answer ${result}">
        <p class="gg-verdict">${result === 'ok' ? `Correct! <b>+${pts}</b>` : result === 'skip' ? 'It was' : 'Out of guesses. It was'}</p>
        <p class="gg-title">${esc(song.title)}</p>
        <p class="gg-by">${artistLink(song.a, song.artist)}${song.album ? ` <span class="muted">· ${esc(song.album)}</span>` : ''}</p>
        <p class="muted small">Played ${plural(songAllPlays[s], 'time')} (${hours(songAllSec[s])}) · first in ${first}</p>
        ${P.tries.length ? `<ol class="gg-tries">${triesHtml(true)}</ol>` : ''}
      </div>
      <div class="gg-actions">
        <button type="button" class="primary" data-act="next" id="ggNext">${last ? 'See your score →' : 'Next song →'}</button>
        <button type="button" class="ghost" data-act="open">Open in the Library</button>
      </div>`;
    $('ggNext').focus({ preventScroll: true });
    paint();
  }

  function renderDone() {
    G.view = 'done';
    Clip.pause();
    stage.hidden = true; stage.classList.remove('open');
    foot.innerHTML = '';
    const n = P.log.length, right = P.log.filter((l) => l.result === 'ok').length, firstTry = P.log.filter((l) => l.result === 'ok' && !l.wrong).length;
    const line = !n ? 'No clips could be played for these songs.' : right === n ? 'A perfect game.' : right >= n * 0.7 ? 'You know these well.' : right >= n * 0.4 ? 'Not bad.' : 'Tough crowd.';
    body.innerHTML = `<h2>Guess the song</h2>
      <div class="gg-result">
        <div class="gg-big">${num(P.score)}<small>points</small></div>
        <p><b>${right}</b> of ${n} right${firstTry ? ` · ${firstTry} on the first guess` : ''}. ${line}</p>
      </div>
      <ol class="st-list gg-log">${P.log.map((l) => `<li data-gs="${l.song.s}" title="Open in the Library"><span><i class="${l.result === 'ok' ? 'ok' : 'no'}" aria-hidden="true">${l.result === 'ok' ? '✓' : '✕'}</i> <b>${esc(l.song.title)}</b> <span class="muted">${artistLink(l.song.a, l.song.artist)}</span></span><small class="muted">${l.result === 'ok' ? `+${l.pts}${l.wrong ? ` · guess ${l.wrong + 1}` : ''}` : l.result === 'skip' ? 'gave up' : 'missed'}</small></li>`).join('')}</ol>
      <div class="gg-actions">
        <button type="button" class="primary" data-act="again">Play again</button>
        <button type="button" class="ghost" data-act="setup">Change the filters</button>
      </div>`;
  }

  // ---------- events ----------
  const card = $('guessCard');
  card.addEventListener('click', (e) => {
    const li = e.target.closest('#ggList li');
    if (li) { choose(+li.dataset.i); return; }
    const who = e.target.closest('[data-ga]');
    if (who) { libraryArtistFresh(+who.dataset.ga); return; }
    const row = e.target.closest('.gg-log li[data-gs]');
    if (row) { librarySearch(D.songs[+row.dataset.gs][0]); return; }
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.preset !== undefined) { G.f = clean(PRESETS[+b.dataset.preset][1]); renderSetup(); return; }
    if (b.dataset.saved !== undefined) { const p = savedPresets()[+b.dataset.saved]; if (p) { G.f = clean(p[1]); renderSetup(); } return; }
    if (b.dataset.del !== undefined) { const l = savedPresets(); l.splice(+b.dataset.del, 1); write(SAVED_KEY, l); refreshSetup(); return; }
    switch (b.dataset.act) {
      case 'start': case 'again': startGame(); break;
      case 'reset': G.f = blank(); renderSetup(); break;
      case 'save':
        $('ggSave').innerHTML = `<input type="text" id="ggSaveName" placeholder="Preset name" maxlength="40"> <button type="button" class="ghost" data-act="doSave">Save</button>`;
        $('ggSaveName').focus();
        break;
      case 'doSave': {
        const name = $('ggSaveName').value.trim();
        if (!name) { $('ggSaveName').focus(); break; }
        write(SAVED_KEY, [...savedPresets().filter((p) => p[0] !== name), [name, G.f]]);
        renderSetup();
        break;
      }
      case 'setup': case 'quit': Clip.pause(); renderSetup(); break;
      case 'play':
        if (!Clip.st.paused) Clip.pause(); else Clip.play(Clip.st.ended || !Clip.st.started);
        break;
      case 'more':
        P.extra++; Clip.st.limit = Math.min(30, Clip.st.limit + 5);
        $('ggWorth').textContent = points();
        Clip.play(false);
        break;
      case 'previews': Clip.usePreviews(); startRound(); break;
      case 'swap': { const sub = P.spare.shift(); if (sub) P.queue[P.i] = sub; else P.queue.splice(P.i, 1); if (P.i >= P.queue.length) renderDone(); else startRound(); break; }
      case 'guess': submitGuess(); break;
      case 'hint':
        P.hinted = true; b.disabled = true; b.textContent = `Artist: ${P.cur.artist}`;
        $('ggWorth').textContent = points();
        $('ggInput').focus();
        break;
      case 'skip': endRound('skip'); break;
      case 'next': P.i++; if (P.i >= P.queue.length) renderDone(); else startRound(); break;
      case 'open': librarySearch(D.songs[P.cur.s][0]); break;
      default:
    }
  });
  function readFilter(el) {
    const k = el.dataset.f;
    if (k === 'rounds' || k === 'clip' || k === 'tries') { G[k] = +el.value; return; }
    if (k === 'mode' || k === 'start') { G[k] = el.value; return; }
    const f = G.f;
    if (el.type === 'checkbox') f[k] = el.checked;
    else if (k === 'pmin' || k === 'pmax') f[k] = el.value === '' || !(+el.value >= 0) ? null : Math.floor(+el.value);
    else if (k === 'top' || k === 'per') f[k] = +el.value;
    else f[k] = el.value;
  }
  let typing = 0;
  card.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'ggInput') { P.pickKey = null; P.hi = 0; say(''); showList(); return; }
    if (el.dataset.f === undefined) return;
    readFilter(el);
    clearTimeout(typing);
    if (el.type === 'text' || el.type === 'number') typing = setTimeout(refreshSetup, 200); else refreshSetup();
  });
  card.addEventListener('keydown', (e) => {
    if (e.target.id === 'ggSaveName' && e.key === 'Enter') { card.querySelector('[data-act="doSave"]').click(); return; }
    if (e.target.id !== 'ggInput') return;
    const open = P.sugg.length > 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) { showList(); return; }
      e.preventDefault();
      P.hi = (P.hi + (e.key === 'ArrowDown' ? 1 : -1) + P.sugg.length) % P.sugg.length;
      showList();
      $(`ggOpt${P.hi}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Tab' && open && !e.shiftKey) { // complete it and stay in the box
      e.preventDefault();
      choose(P.hi);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open) choose(P.hi); else submitGuess();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation();
      P.sugg = []; $('ggList').hidden = true; e.target.setAttribute('aria-expanded', 'false');
    }
  });
  card.addEventListener('focusout', (e) => { // tabbing or clicking away closes the list
    if (e.target.id !== 'ggInput') return;
    setTimeout(() => { const ul = $('ggList'); if (ul && document.activeElement?.id !== 'ggInput') { ul.hidden = true; P.sugg = []; } }, 150);
  });
  card.addEventListener('focusin', (e) => { if (e.target.id === 'ggInput' && !P.over) showList(); });
  card.addEventListener('pointerdown', (e) => { if (e.target.closest('#ggList')) e.preventDefault(); }); // keep the box focused while picking

  // leaving the page stops the clip; coming back to the setup screen recounts (the Library's filters may have changed)
  const pane = card.closest('.pane');
  new MutationObserver(() => { if (pane.hidden && G.view === 'play') Clip.pause(); }).observe(pane, { attributes: true, attributeFilter: ['hidden'] });
  REDRAW.guess = () => { if (G.view === 'setup') refreshSetup(); };

  renderSetup();
})();
