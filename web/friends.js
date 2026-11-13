// Friends: share your stats with a link, and compare with people who shared theirs, several at once.
// A separate view (?friends) so the main charts stay exactly as they are.
(() => {
  const C = window.SpotifyCloud, SRC = window.SPOTIFY_SOURCE || { kind: 'default' }, ME = window.SPOTIFY;
  if (!C) return;
  const bar = $('sourceBar');
  const ownPage = location.pathname; // without ?s=…
  const MAX_FRIENDS = 5; // you + 5 = the 6 series colors
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const color = (i) => `var(--s${(i % 6) + 1})`;
  const avatar = (name, i, big) => `<span class="fr-av${big ? ' big' : ''}" style="background:${color(i)}" aria-hidden="true">${esc(initials(name))}</span>`;
  const pct1 = (x) => (x > 0 && x < 0.1 ? `${(x * 100).toFixed(1)}%` : pct(x)); // one decimal for small shares
  const shareMap = (entries) => { const mp = new Map(entries); mp.total = [...mp.values()].reduce((s, v) => s + v, 0) || 1; return mp; };
  // taste match: how much of each person's listening time goes to the same artists (0–100%)
  function match(a, b) {
    let m = 0;
    for (const [n, x] of a) { const y = b.get(n); if (y) m += Math.min(x / a.total, y / b.total); }
    return m;
  }
  const hl = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  const ME_TOP = 'spotifyStats.meTop';

  // ---------- profile of one history over a period ----------
  function profile(D, from, to) {
    const W = D.cols || 9, R = D.rows, inR = D.months.map((m) => m >= from && m <= to);
    const monthSkips = new Array(D.months.length).fill(0);
    for (let i = 0; i < R.length; i += W) monthSkips[R[i + 1]] += R[i + 4] || 0;
    const artists = new Map(), songs = new Map(), monthly = new Map(), songIds = new Set();
    const T = { plays: 0, sec: 0, skips: 0, tp: 0, mp: 0, heard: 0 };
    for (let i = 0; i < R.length; i += W) {
      const m = R[i + 1];
      if (!inR[m]) continue;
      const s = D.songs[R[i]], p = R[i + 2], t = R[i + 3];
      T.plays += p; T.sec += t; T.skips += R[i + 4] || 0; T.mp += R[i + 5] || 0; T.heard += R[i + 6] || 0;
      if (monthSkips[m] > 0) T.tp += p;
      songIds.add(R[i]);
      const an = D.artists[s[1]];
      const a = artists.get(an) || { sec: 0, plays: 0 }; a.sec += t; a.plays += p; artists.set(an, a);
      const key = s[4] || `${s[0]}\n${an}`.toLowerCase();
      const g = songs.get(key) || { title: s[0], artist: an, sec: 0, plays: 0 }; g.sec += t; g.plays += p; songs.set(key, g);
      monthly.set(D.months[m], (monthly.get(D.months[m]) || 0) + t);
    }
    // average minutes per hour of the day, over the days in the period
    let hourly = null;
    const dd = D.days;
    if (dd && dd.slots) {
      const per = 60 / (dd.slotMin || 15), h = new Array(24).fill(0), d0 = Date.parse(dd.start + 'T00:00:00Z');
      let n = 0;
      dd.slots.forEach((str, i) => {
        const key = new Date(d0 + i * 864e5).toISOString().slice(0, 7);
        if (key < from || key > to) return;
        n++;
        for (let k = 0; k < str.length; k++) { const v = parseInt(str[k], 16); if (v) h[Math.floor(k / per)] += v; }
      });
      if (n) hourly = h.map((v) => v / n);
    }
    const day = hourly ? hourly.reduce((a, b) => a + b, 0) || 1 : 1;
    const part = (hs) => (hourly ? hs.reduce((a, h) => a + hourly[h], 0) / day : null);
    let topA = null;
    for (const [n, v] of artists) if (!topA || v.sec > topA[1].sec) topA = [n, v];
    return {
      ...T, artists, songs, monthly, hourly, nSongs: songIds.size, nArtists: artists.size,
      skipRate: T.tp ? T.skips / T.tp : null, retention: T.mp ? T.heard / T.mp / 1000 : null,
      night: part([22, 23, 0, 1, 2, 3]), morning: part([5, 6, 7, 8]),
      topArtist: topA ? topA[0] : null, topShare: topA ? topA[1].sec / (T.sec || 1) : 0,
      peak: hourly ? hourly.indexOf(Math.max(...hourly)) : null,
    };
  }
  const top150 = (P) => shareMap([...P.artists].map(([n, v]) => [n, v.sec]).sort((x, y) => y[1] - x[1]).slice(0, 150));

  // ===================== a friend's shared page =====================
  if (SRC.kind === 'shared') {
    bar.innerHTML = `<span>You're looking at <b>${esc(SRC.name)}</b>'s shared stats · updated ${fmtDate(SRC.updated)}</span>
      <span class="sb-actions"><a class="ghost" href="${ownPage}?friends&amp;with=${SRC.id}">Compare with mine</a><a class="primary" href="${ownPage}">Back to my stats</a></span>`;
    sharedHero();
    return;
  }
  function sharedHero() {
    const P = profile(ME, '0000-00', '9999-99');
    const name = SRC.name;
    let mine = null;
    try { mine = JSON.parse(localStorage.getItem(ME_TOP)); } catch { /* none */ }
    const m = mine?.length ? match(shareMap(mine), top150(P)) : null;
    const topArtists = [...P.artists].sort((a, b) => b[1].sec - a[1].sec).slice(0, 5);
    const topSong = [...P.songs.values()].sort((a, b) => b.sec - a.sec)[0];
    const years = (ME.months.length / 12).toFixed(1).replace(/\.0$/, '');
    const hero = document.createElement('section');
    hero.className = 'card sh-hero';
    hero.id = 'sharedHero';
    hero.innerHTML = `
      <div class="sh-who">${avatar(name, 1, true)}<div><h2>${esc(name)}'s listening</h2>
        <p class="muted small">${monthLabel(ME.months[0])} – ${monthLabel(ME.months.at(-1))} · ${years} years · updated ${fmtDate(SRC.updated)}</p></div></div>
      <div class="sh-stats">
        <div><b>${hours(P.sec)}</b><span>listening</span></div>
        <div><b>${num(P.plays)}</b><span>plays</span></div>
        <div><b>${num(P.nArtists)}</b><span>artists</span></div>
        ${P.peak !== null ? `<div><b>${hl(P.peak)}</b><span>busiest hour</span></div>` : ''}
        ${m !== null ? `<div class="sh-match"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="bg"/><circle cx="18" cy="18" r="15.5" class="fg" stroke-dasharray="${(m * 97.4).toFixed(1)} 97.4"/></svg><b>${pct(m)}</b><span>taste match with you</span></div>` : ''}
      </div>
      <div class="sh-row"><span class="muted small">Top artists</span>${topArtists.map(([n, v], i) => `<span class="sh-chip"><em>${i + 1}</em>${esc(n)} <small class="muted">${hours(v.sec)}</small></span>`).join('')}</div>
      ${topSong ? `<div class="sh-row"><span class="muted small">Most-played song</span><span class="sh-chip"><b>${esc(topSong.title)}</b>&nbsp;<small class="muted">${esc(topSong.artist)} · ${num(topSong.plays)} plays</small></span></div>` : ''}
      <div class="sh-actions"><a class="primary" href="${ownPage}?friends&amp;with=${SRC.id}">Compare with mine</a><button class="ghost" type="button" data-sh="pl">Make a playlist from ${esc(name)}'s stats</button></div>`;
    document.querySelector('main > header').after(hero);
    const pl = document.createElement('section');
    pl.className = 'card pl-card';
    pl.id = 'sharedPlaylist';
    hero.after(pl);
    if (window.Playlists) {
      window.Playlists.mount(pl, () => ({ people: [{ name, short: name, D: ME, color: color(1) }], period: { from: '0000-00', to: '9999-99', label: 'All time', all: true } }));
    } else pl.hidden = true;
    hero.querySelector('[data-sh="pl"]').addEventListener('click', () => pl.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ===================== your own page: the Friends view =====================
  bar.querySelector('.sb-actions')?.insertAdjacentHTML('afterbegin', '<button class="ghost" id="friendsBtn" aria-pressed="false">Friends</button>');
  const sec = document.createElement('section');
  sec.id = 'friends';
  sec.hidden = true;
  bar.after(sec);

  const st = { with: [], period: 'all', cache: new Map(), infos: new Map() };
  const params = () => new URLSearchParams(location.search);
  const isOpen = () => params().has('friends');
  const urlFor = (ids) => `${ownPage}?friends${ids.length ? `&with=${ids.join(',')}` : ''}${location.hash}`;
  function go(ids) { history.pushState(null, '', urlFor(ids)); sync(); }
  // change who's being compared without leaving your place on the page
  function pick(ids) {
    st.with = ids;
    history.replaceState(null, '', urlFor(ids));
    renderPeople();
    renderGroup();
  }
  function leave() { history.pushState(null, '', ownPage + location.hash); sync(); }
  function sync() {
    const open = isOpen();
    document.body.classList.toggle('friends-mode', open);
    sec.hidden = !open;
    $('friendsBtn').setAttribute('aria-pressed', String(open));
    if (!open) { window.dispatchEvent(new Event('resize')); return; }
    const ids = (params().get('with') || '').split(',').map((x) => C.parseCode(x)).filter(Boolean);
    ids.forEach((id) => C.addFriend(id, null));
    st.with = [...new Set(ids)].filter((id) => id !== C.mine()?.id).slice(0, MAX_FRIENDS);
    render();
    scrollTo(0, 0);
    autoShare();
  }
  // Opening Friends puts your stats on the server, unless they're already there (same data) or you stopped sharing.
  const canShare = SRC.kind === 'mine' || !!SRC.own;
  // remember your top artists, so a friend's shared page can show your taste match
  const saveMeTop = () => { try { localStorage.setItem(ME_TOP, JSON.stringify(C.summarize(ME).top)); } catch { /* full */ } };
  if (canShare) setTimeout(saveMeTop, 800);
  let sharing = null;
  function autoShare() {
    const me = C.mine();
    if (!canShare || sharing || me?.stopped || (me?.at && me.fp === C.fingerprint(ME))) return;
    const name = me?.name || (ME.name && !/^default$/i.test(ME.name) ? cleanName(ME.name) : `Listener ${Math.random().toString(36).slice(2, 6)}`);
    sharing = C.share(ME, name, (label, f) => { st.progress = `${label}… ${Math.round(f * 100)}%`; status(st.progress); })
      .then(() => { st.progress = null; saveMeTop(); if (isOpen()) { renderTop(); status('Your stats are shared. Send friends the link.'); } })
      .catch((e) => { st.progress = null; st.shareError = e.message; if (isOpen()) renderTop(); })
      .finally(() => { sharing = null; });
  }
  addEventListener('popstate', sync);
  const myName = () => C.mine()?.name || (ME.name && !/^default$/i.test(ME.name) ? ME.name : '');
  const myTop = () => (st.myTop ||= shareMap(C.summarize(ME).top));

  // ---------- render ----------
  function render() {
    sec.innerHTML = `
      <div class="fr-head">
        <div><h2 class="fr-title">Friends</h2><p class="muted small">Pick friends to compare, see who listens to what, and make playlists together.</p></div>
        <button class="ghost" data-fr="back">← Back to stats</button>
      </div>
      <div id="frTop"></div>
      <section class="card" id="frPeople"></section>
      <div id="frGroup"></div>`;
    renderTop();
    renderPeople();
    refreshInfos();
    renderGroup();
  }
  function renderTop() {
    const el = $('frTop');
    if (!el) return;
    el.innerHTML = `<div class="two-col fr-top">
        <section class="card" id="frShare"><h2>Your link</h2>${shareCard(C.mine())}<p class="fr-status muted small" id="frStatus" role="status">${esc(st.progress || '')}</p></section>
        <section class="card" id="frAdd"><h2>Add a friend</h2><p class="muted small">Paste the link (or code) a friend sent you.</p>
          <form class="fr-link" data-fr-form><input id="frCode" placeholder="https://…?s=abc123… or abc123…" aria-label="Friend's link or code" autocomplete="off"><button class="primary">Add</button></form>
          <p class="fr-status muted small" id="frAddStatus" role="status"></p></section>
      </div>`;
  }
  function shareCard(me) {
    if (!canShare) {
      return `<p class="muted small">To share your stats and compare with friends, load your own Spotify data first.</p>
        <div class="fr-row"><button class="primary" data-fr="pick"><svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V4M6 7.5 10 3.5l4 4M4 13.5v2.5h12v-2.5"/></svg> Load your own data</button></div>`;
    }
    if (me?.at && !st.progress) {
      return `<p class="muted small">Your stats are shared${me.fp === C.fingerprint(ME) ? '' : ' (an older copy: updating…)'} · ${fmtDate(me.at)}. Anyone with this link can see them.</p>
        <div class="fr-link"><input readonly value="${esc(C.linkFor(me.id))}" aria-label="Your share link"><button class="primary" data-fr="copy">Copy link</button></div>
        <label class="fr-lab" for="frName">Name friends see</label>
        <div class="fr-link fr-name"><input id="frName" maxlength="40" value="${esc(me.name)}"><button class="ghost" data-fr="rename">Save name</button></div>
        <div class="fr-row"><button class="ghost danger" data-fr="unshare">Stop sharing</button></div>`;
    }
    if (me?.stopped) {
      return `<p class="muted small">You stopped sharing, so your link doesn't work. Share again to turn it back on (same link).</p>
        <div class="fr-link"><input id="frName" maxlength="40" value="${esc(me.name || myName())}" placeholder="Your name, as friends will see it" aria-label="Your name"><button class="primary" data-fr="share">Share again</button></div>`;
    }
    if (st.shareError) {
      return `<p class="muted small">Couldn't share your stats: ${esc(st.shareError)}</p><div class="fr-row"><button class="primary" data-fr="share">Try again</button></div>`;
    }
    return `<p class="muted small">Sharing your stats so friends can compare (a summary of your listening, not your raw Spotify files)…</p>`;
  }
  // everyone you've added, as cards you can tick to compare
  function renderPeople() {
    const el = $('frPeople');
    if (!el) return;
    const friends = C.friends();
    const n = st.with.length;
    el.innerHTML = `<div class="fr-people-head"><h2>Your friends</h2><span class="muted small">${friends.length ? `${n ? `Comparing ${n} of ${friends.length}` : 'Tick friends to compare'} · up to ${MAX_FRIENDS} at once` : ''}</span></div>
      ${friends.length ? `<div class="fr-people">${friends.map((f) => personCard(f)).join('')}</div>`
        : '<p class="muted small">No friends added yet. Send them your link, or paste theirs above.</p>'}`;
  }
  function personCard(f) {
    const inf = st.infos.get(f.id), s = inf?.summary, on = st.with.includes(f.id);
    const ci = on ? st.with.indexOf(f.id) + 1 : null;
    const m = s?.top ? match(myTop(), shareMap(s.top)) : null;
    const gone = inf === null;
    return `<div class="fr-person${on ? ' on' : ''}${gone ? ' gone' : ''}" data-id="${f.id}"${on ? ` style="--pc:${color(ci)}"` : ''}>
      <button class="fr-pick" type="button" data-fr="toggle" aria-pressed="${on}"${gone ? ' disabled' : ''} aria-label="${on ? 'Stop comparing with' : 'Compare with'} ${esc(inf?.name || f.name)}">
        ${on ? avatar(inf?.name || f.name, ci) : `<span class="fr-av off" aria-hidden="true">${esc(initials(inf?.name || f.name))}</span>`}
        <span class="fr-pn"><b>${esc(inf?.name || f.name)}</b><small class="muted">${gone ? 'not shared anymore' : s ? `${hours(s.sec)} · top: ${esc(s.top?.[0]?.[0] || '—')}` : 'loading…'}</small></span>
        ${m !== null ? `<span class="fr-pm" title="Taste match with you"><b>${pct(m)}</b><small>match</small></span>` : ''}
        <span class="fr-tick" aria-hidden="true">${on ? '✓' : '+'}</span>
      </button>
      <div class="fr-pacts">${gone ? '' : `<a href="${ownPage}?s=${f.id}">Their stats</a>`}<button type="button" class="fr-x" data-fr="remove" aria-label="Remove ${esc(f.name)}" title="Remove">Remove</button></div>
    </div>`;
  }
  let infoReq = 0;
  async function refreshInfos() {
    const ids = C.friends().map((f) => f.id).filter((id) => !st.infos.has(id));
    if (!ids.length) return;
    const req = ++infoReq;
    try {
      const rows = await C.info(ids);
      const got = new Map(rows.map((r) => [r.id, r]));
      ids.forEach((id) => st.infos.set(id, got.get(id) || null));
      const list = C.friends();
      list.forEach((f) => { const r = got.get(f.id); if (r) f.name = r.name; });
      C.saveFriends(list);
    } catch (e) {
      status(e.message, 'frAddStatus');
      return;
    }
    if (req === infoReq && isOpen()) renderPeople();
  }

  // ---------- comparing a group ----------
  async function loadFriend(id) {
    if (st.cache.has(id)) return st.cache.get(id);
    const got = await C.fetch(id, (i, n) => { const el = $(`frLoad-${id}`); if (el) el.textContent = `${Math.round((i / n) * 100)}%`; });
    st.cache.set(id, got);
    return got;
  }
  let groupReq = 0;
  async function renderGroup() {
    const box = $('frGroup');
    if (!box) return;
    const ids = st.with.slice(), req = ++groupReq;
    if (!ids.length) { // nobody ticked: playlists from your own stats
      box.innerHTML = '<section class="card pl-card" id="frPlaylist"></section>';
      st.people = [{ id: 'me', name: 'You', short: myName() || 'Me', D: ME, color: color(0), you: true }]; st.P = null;
      if (window.Playlists) window.Playlists.mount($('frPlaylist'), () => ({ people: st.people, period: { from: '0000-00', to: '9999-99', label: 'All time', all: true } }));
      return;
    }
    const missing = ids.filter((id) => !st.cache.has(id));
    if (missing.length) {
      box.innerHTML = `<section class="card"><p class="muted">Loading ${missing.map((id) => `${esc(st.infos.get(id)?.name || C.friends().find((f) => f.id === id)?.name || 'friend')} <span id="frLoad-${id}"></span>`).join(', ')}…</p></section>`;
    }
    const got = [];
    for (const id of ids) {
      try { got.push(await loadFriend(id)); } catch (e) {
        if (req !== groupReq) return;
        box.innerHTML = `<section class="card"><p>${esc(e.message)}</p></section>`;
        return;
      }
    }
    if (req !== groupReq || !isOpen()) return;
    const people = [{ id: 'me', name: 'You', short: myName() || 'Me', D: ME, color: color(0), you: true },
      ...got.map((F, i) => ({ id: F.id, name: F.name, short: F.name, D: F.data, color: color(i + 1) }))];
    const years = [...new Set(people.flatMap((p) => p.D.months.map((m) => m.slice(0, 4))))].sort();
    if (st.period !== 'all' && !years.includes(st.period)) st.period = 'all';
    const [from, to] = st.period === 'all' ? ['0000-00', '9999-99'] : [`${st.period}-01`, `${st.period}-12`];
    const label = st.period === 'all' ? 'All time' : st.period;
    const P = people.map((p) => profile(p.D, from, to));
    st.people = people; st.P = P;
    const names = people.map((p, i) => `<span class="fr-legend">${avatar(p.name, i)}${esc(p.name)}</span>`).join('');
    const title = people.length === 2 ? `You vs ${esc(people[1].name)}` : `You & ${people.length - 1} friends`;
    const firsts = foundFirst(people);
    st.wrapped = wrappedSlides(people, P, label, firsts);
    box.innerHTML = `
      <section class="card fr-wrapped" id="frWrapped" tabindex="0" aria-roledescription="carousel" aria-label="Your group's Wrapped"></section>
      <section class="card fr-cmp">
        <div class="fr-cmp-head">
          <div><h2>${title} <span class="period muted">${label}</span></h2><div class="fr-legends">${names}</div></div>
          <label class="fr-period">Period <select id="frPeriod"><option value="all">All time</option>${years.map((y) => `<option value="${y}"${st.period === y ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
        </div>
        <div class="fr-cmp-body${people.length > 2 ? ' wide' : ''}">${matchBlock(people, P)}${superlatives(people, P)}</div>
      </section>
      <section class="card"><h2>Head to head <span class="period muted">${label}</span></h2>${leaderboards(people, P)}</section>
      <div class="two-col fr-charts">
        <section class="card"><h2>Listening by month</h2><p class="muted small">Hours per month</p><div class="fr-chart" id="frMonthly"></div></section>
        <section class="card"><h2>Listening clock</h2><p class="muted small">Average minutes per day, by hour</p><div class="fr-clock" id="frClock"></div></section>
      </div>
      <section class="card"><h2>Who listens to whom <span class="period muted">${label}</span></h2><p class="muted small">The group's top artists. Bigger dot = bigger share of that person's listening time.</p>${overlap(people, P)}</section>
      <section class="card"><h2>Signature artists</h2><p class="muted small">Artists that take a much bigger share of one person's listening than anyone else's</p>${signature(people, P)}</section>
      <section class="card"><h2>Songs in common <span class="period muted">${label}</span></h2>${commonSongs(people, P)}</section>
      <section class="card" id="frFirst"><h2>Who found it first</h2><p class="muted small">Songs you have in common: who played them first, and how long it took the others. Only counts songs first played after everyone's history starts (${monthLabel(firsts.guard)}).</p>${foundFirstHtml(people, firsts)}</section>
      <section class="card" id="frAfter"><h2>Who started after whom</h2><p class="muted small">Artists one of you started playing within six months after another did. It doesn't mean one told the other, but it's a fun guess.</p>${influenceHtml(people)}</section>
      <section class="card pl-card" id="frPlaylist"></section>`;
    st.slide = 0;
    renderWrapped();
    drawCharts();
    if (window.Playlists) window.Playlists.mount($('frPlaylist'), () => ({ people: st.people, period: { from, to, label, all: st.period === 'all' } }));
  }

  function matchBlock(people, P) {
    const T = P.map(top150);
    if (people.length === 2) {
      const m = match(T[0], T[1]);
      const shared = [...P[0].artists.keys()].filter((n) => P[1].artists.has(n));
      const both = shared.map((n) => [n, Math.min(P[0].artists.get(n).sec / (P[0].sec || 1), P[1].artists.get(n).sec / (P[1].sec || 1))]).sort((a, b) => b[1] - a[1]);
      return `<div class="fr-match-big"><svg class="fr-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="bg"/><circle cx="18" cy="18" r="15.5" class="fg" stroke-dasharray="${(m * 97.4).toFixed(1)} 97.4"/></svg>
        <b>${pct(m)}</b><span>taste match<br><small class="muted">${num(shared.length)} artists in common${both[0] ? ` · most shared: ${both.slice(0, 3).map(([n]) => esc(n)).join(', ')}` : ''}</small></span></div>`;
    }
    // everyone against everyone
    const n = people.length, M = [];
    let best = null;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = i === j ? null : match(T[i], T[j]);
      (M[i] ||= [])[j] = v;
      if (i < j && (!best || v > best[2])) best = [i, j, v];
    }
    const mx = Math.max(...M.flat().filter((v) => v !== null), 0.01);
    return `<div class="fr-matrix-wrap"><table class="fr-matrix"><thead><tr><th></th>${people.map((p, i) => `<th>${avatar(p.name, i)}<span>${esc(p.name)}</span></th>`).join('')}</tr></thead>
      <tbody>${people.map((p, i) => `<tr><th><span class="fr-mh">${avatar(p.name, i)}<span>${esc(p.name)}</span></span></th>${M[i].map((v, j) => (v === null ? '<td class="self"></td>'
        : `<td style="--a:${(0.12 + 0.88 * (v / mx)).toFixed(2)}" data-tip="${esc(`<b>${esc(people[i].name)} & ${esc(people[j].name)}</b><br>${pct(v)} taste match`)}"><span>${pct(v)}</span></td>`)).join('')}</tr>`).join('')}</tbody></table>
      <p class="fr-best">${best ? `Closest taste: <b>${esc(people[best[0]].name)}</b> & <b>${esc(people[best[1]].name)}</b> (${pct(best[2])})` : ''}</p></div>`;
  }

  // fun "awards": who's the biggest listener, night owl, etc.
  function superlatives(people, P) {
    const award = (title, icon, pick, fmt, lowest) => {
      let w = -1;
      P.forEach((x, i) => { const v = pick(x); if (v === null || v === undefined || Number.isNaN(v)) return; if (w < 0 || (lowest ? v < pick(P[w]) : v > pick(P[w]))) w = i; });
      return w < 0 ? '' : `<div class="fr-award"><span class="fr-aw-i" aria-hidden="true">${icon}</span><span class="fr-aw-t">${title}</span>
        <span class="fr-aw-w">${avatar(people[w].name, w)}<b>${esc(people[w].name)}</b></span><span class="fr-aw-v muted small">${fmt(P[w])}</span></div>`;
    };
    return `<div class="fr-awards">${[
      award('Biggest listener', '🎧', (x) => x.sec, (x) => hours(x.sec)),
      award('Explorer', '🧭', (x) => x.nArtists, (x) => `${num(x.nArtists)} artists`),
      award('Superfan', '⭐', (x) => (x.sec ? x.topShare : null), (x) => `${pct1(x.topShare)} on ${esc(x.topArtist)}`),
      award('Most patient', '🧘', (x) => x.skipRate, (x) => `skips only ${pct(x.skipRate)}`, true),
      award('Night owl', '🦉', (x) => x.night, (x) => `${pct(x.night)} after 10pm`),
      award('Early bird', '🌅', (x) => x.morning, (x) => `${pct(x.morning)} from 5–9am`),
      award('Completionist', '✅', (x) => x.retention, (x) => `hears ${pct(x.retention)} of a song on average`),
    ].join('')}</div>`;
  }

  function leaderboards(people, P) {
    const rows = [
      ['Listening time', (x) => x.sec, hours],
      ['Plays', (x) => x.plays, num],
      ['Different songs', (x) => x.nSongs, num],
      ['Artists', (x) => x.nArtists, num],
      ['Skip rate', (x) => x.skipRate, pct],
      ['Retention', (x) => x.retention, pct],
    ];
    return `<div class="fr-boards">${rows.map(([t, f, fmt]) => {
      const vals = P.map(f), mx = Math.max(...vals.filter((v) => v !== null), 1e-9);
      return `<div class="fr-board"><h3>${t}</h3>${people.map((p, i) => `<div class="fr-bar"><span class="fr-bn">${esc(p.name)}</span>
        <span class="fr-bt"><i style="width:${vals[i] === null ? 0 : Math.max(1, (vals[i] / mx) * 100)}%;background:${p.color}"></i></span><span class="fr-bv">${vals[i] === null ? '—' : fmt(vals[i])}</span></div>`).join('')}</div>`;
    }).join('')}</div>`;
  }

  // dot matrix: rows = the group's top artists, columns = people
  function overlap(people, P) {
    const score = new Map();
    P.forEach((x) => x.artists.forEach((v, n) => score.set(n, (score.get(n) || 0) + v.sec / (x.sec || 1))));
    const rows = [...score].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n]) => n);
    if (!rows.length) return '<p class="muted small">Nothing in this period.</p>';
    const share = (i, n) => (P[i].artists.get(n)?.sec || 0) / (P[i].sec || 1);
    const mx = Math.max(...rows.flatMap((n) => P.map((_, i) => share(i, n))), 1e-9);
    return `<div class="fr-ov" style="--cols:${people.length}"><div class="fr-ov-h"><span></span>${people.map((p, i) => `<span>${avatar(p.name, i)}<small>${esc(p.name)}</small></span>`).join('')}</div>
      ${rows.map((n) => `<div class="fr-ov-r"><span class="fr-ov-n" title="${esc(n)}">${esc(n)}</span>${people.map((p, i) => {
        const s = share(i, n), v = P[i].artists.get(n);
        const d = s ? 6 + 26 * Math.sqrt(s / mx) : 0;
        return `<span class="fr-ov-c"${s ? ` data-tip="${esc(`<b>${esc(n)}</b><br>${esc(p.name)}: ${pct1(s)} of listening · ${hours(v.sec)} · ${num(v.plays)} plays`)}"` : ''}>${s ? `<i style="width:${d.toFixed(1)}px;height:${d.toFixed(1)}px;background:${p.color}"></i>` : '<i class="none"></i>'}</span>`;
      }).join('')}</div>`).join('')}</div>`;
  }

  function signature(people, P) {
    const share = (i, n) => (P[i].artists.get(n)?.sec || 0) / (P[i].sec || 1);
    return `<div class="fr-sig" style="--cols:${Math.min(people.length, 3)}">${people.map((p, i) => {
      const list = [...P[i].artists.keys()].map((n) => {
        const mine = share(i, n), others = Math.max(0, ...P.map((_, j) => (j === i ? 0 : share(j, n))));
        return [n, mine, others, mine - others];
      }).filter(([, a, b]) => a > 2 * b && a > 0.002).sort((a, b) => b[3] - a[3]).slice(0, 5);
      return `<div class="fr-sig-col"><h3>${avatar(p.name, i)}${esc(p.name)}</h3>${list.length ? `<ol>${list.map(([n, a, b]) => `<li><span>${esc(n)}</span><small class="muted">${pct1(a)} of ${p.you ? 'your' : 'their'} listening${b ? ` · others ≤${b < 0.001 ? '0.1%' : pct1(b)}` : ` · only ${p.you ? 'you' : 'them'}`}</small></li>`).join('')}</ol>` : '<p class="muted small">Nothing that stands out.</p>'}</div>`;
    }).join('')}</div>`;
  }

  // ---------- all-time firsts (when each person first played a song / artist) ----------
  const firstCache = new WeakMap();
  function firstsOf(D) {
    if (firstCache.has(D)) return firstCache.get(D);
    const W = D.cols || 9, R = D.rows, songs = new Map(), artists = new Map();
    let start = null;
    for (let i = 0; i < R.length; i += W) {
      const mk = D.months[R[i + 1]], s = D.songs[R[i]], an = D.artists[s[1]];
      if (!start || mk < start) start = mk;
      const key = s[4] || `${s[0]}\n${an}`.toLowerCase();
      const g = songs.get(key) || { title: s[0], artist: an, first: mk, plays: 0 };
      if (mk < g.first) g.first = mk;
      g.plays += R[i + 2]; songs.set(key, g);
      const a = artists.get(an) || { first: mk, sec: 0 };
      if (mk < a.first) a.first = mk;
      a.sec += R[i + 3]; artists.set(an, a);
    }
    const out = { songs, artists, start: start || D.months[0] };
    firstCache.set(D, out);
    return out;
  }
  const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));
  const later = (n) => (n === 0 ? 'same month' : n < 24 ? `${n} month${n === 1 ? '' : 's'} later` : `${Math.round(n / 12)} years later`);
  function foundFirst(people) {
    const F = people.map((p) => firstsOf(p.D));
    const guard = F.map((f) => f.start).sort().at(-1);
    const all = new Map();
    F.forEach((f, i) => f.songs.forEach((g, k) => { if (g.plays >= 3) { const e = all.get(k) || { ...g, who: [] }; e.who.push([i, g.first, g.plays]); all.set(k, e); } }));
    const score = people.map(() => 0), list = [];
    for (const e of all.values()) {
      if (e.who.length < 2) continue;
      e.who.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      const firstM = e.who[0][1];
      if (firstM <= guard) continue; // someone may have known it before their history starts
      const finders = e.who.filter((w) => w[1] === firstM);
      if (finders.length === 1) score[finders[0][0]]++;
      list.push({ ...e, finders, weight: Math.min(...e.who.map((w) => w[2])) });
    }
    list.sort((a, b) => b.weight - a.weight);
    return { guard, score, list };
  }
  function foundFirstHtml(people, ff) {
    if (!ff.list.length) return '<p class="muted small">No songs in common that started after everyone\'s history begins.</p>';
    const mx = Math.max(...ff.score, 1);
    return `<div class="ff-score">${people.map((p, i) => `<div class="fr-bar"><span class="fr-bn">${esc(p.name)}</span><span class="fr-bt"><i style="width:${Math.max(1, (ff.score[i] / mx) * 100)}%;background:${p.color}"></i></span><span class="fr-bv">${num(ff.score[i])} first</span></div>`).join('')}</div>
      <ol class="ff-list">${ff.list.slice(0, 8).map((e) => {
        const [fi, fm] = e.who[0];
        const rest = e.who.slice(1).map(([i, m]) => `${people[i].you ? 'You' : esc(people[i].name)} ${later(monthsBetween(fm, m))}`).join(' · ');
        return `<li><span class="ff-t"><b>${esc(e.title)}</b> <span class="muted">${esc(e.artist)}</span></span>
          <span class="ff-w">${e.finders.length > 1 ? `<span class="muted">Tie:</span> ${e.finders.map(([i]) => `${avatar(people[i].name, i)}`).join('')}` : `${avatar(people[fi].name, fi)}<b>${esc(people[fi].name)}</b>`} <span class="muted">in ${monthLabel(fm)}</span></span>
          <small class="muted ff-rest">${rest}</small></li>`;
      }).join('')}</ol>`;
  }
  function influenceHtml(people) {
    const F = people.map((p) => firstsOf(p.D));
    const guard = F.map((f) => f.start).sort().at(-1);
    const names = new Set(F.flatMap((f) => [...f.artists.keys()]));
    const out = [], led = people.map(() => 0);
    const mid = (i) => (people[i].you ? 'you' : esc(people[i].name));
    for (const n of names) {
      const has = F.map((f, i) => [i, f.artists.get(n)]).filter(([, a]) => a && a.sec >= 2 * 3600);
      if (has.length < 2) continue;
      has.sort((a, b) => (a[1].first < b[1].first ? -1 : 1));
      const [li, la] = has[0];
      if (la.first <= guard || has[1][1].first === la.first) continue;
      const followers = has.slice(1).map(([fi, fa]) => ({ fi, gap: monthsBetween(la.first, fa.first), sec: fa.sec })).filter((f) => f.gap >= 1 && f.gap <= 6);
      if (!followers.length) continue;
      led[li]++;
      out.push({ n, li, from: la.first, followers, sec: followers.reduce((x, f) => x + f.sec, 0) });
    }
    if (!out.length) return '<p class="muted small">Nothing like that in your histories.</p>';
    out.sort((a, b) => b.sec - a.sec);
    const mx = Math.max(...led, 1);
    return `<div class="ff-score">${people.map((p, i) => `<div class="fr-bar"><span class="fr-bn">${esc(p.name)}</span><span class="fr-bt"><i style="width:${Math.max(1, (led[i] / mx) * 100)}%;background:${p.color}"></i></span><span class="fr-bv">${plural(led[i], 'artist')}</span></div>`).join('')}</div>
      <p class="muted small">How many artists each person got to first.</p>
      <ol class="ff-list">${out.slice(0, 10).map((e) => `<li><span class="ff-t"><b>${esc(e.n)}</b> <span class="muted">· ${people[e.li].you ? 'you' : esc(people[e.li].name)} first, ${monthLabel(e.from)}</span></span>
        <span class="ff-w">${avatar(people[e.li].name, e.li)}<span class="ff-arrow" aria-hidden="true">→</span>${e.followers.map((f) => avatar(people[f.fi].name, f.fi)).join('')}</span>
        <small class="muted ff-rest">${e.followers.map((f) => `${people[f.fi].you ? 'You' : esc(people[f.fi].name)} started ${later(f.gap)} (${hours(f.sec)} since)`).join(' · ')}</small></li>`).join('')}</ol>`;
  }
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;

  // ---------- the group's Wrapped: a few slides to click through ----------
  function wrappedSlides(people, P, label, ff) {
    const inv = (i) => `<span class="fr-av inv" style="color:${people[i].color}" aria-hidden="true">${esc(initials(people[i].name))}</span>`;
    const slides = [], who = (i) => `<span class="wr-who">${inv(i)}${esc(people[i].name)}</span>`;
    const total = P.reduce((s, x) => s + x.sec, 0);
    if (!total) return [];
    slides.push({ k: label === 'All time' ? 'Your group, all time' : `Your group in ${label}`, big: hours(total), sub: 'of music between you',
      extra: `<div class="wr-split">${P.map((x, i) => `<i style="width:${(x.sec / total) * 100}%;background:${people[i].color}" title="${esc(people[i].name)}: ${hours(x.sec)}"></i>`).join('')}</div>
        <div class="wr-legend">${people.map((p, i) => `<span>${inv(i)}${esc(p.name)} ${pct(P[i].sec / total)}</span>`).join('')}</div>` });
    const score = new Map();
    P.forEach((x) => x.artists.forEach((v, n) => score.set(n, (score.get(n) || 0) + v.sec / (x.sec || 1))));
    const topA = [...score].sort((a, b) => b[1] - a[1])[0];
    if (topA) {
      const fan = P.map((x, i) => [i, (x.artists.get(topA[0])?.sec || 0) / (x.sec || 1)]).sort((a, b) => b[1] - a[1])[0];
      slides.push({ k: "The group's #1 artist", big: esc(topA[0]), sub: `Biggest fan: ${who(fan[0])} (${pct1(fan[1])} of their listening)` });
    }
    const common = new Map();
    P.forEach((x, i) => x.songs.forEach((g, k) => { const e = common.get(k) || { ...g, n: 0, min: Infinity }; e.n++; e.min = Math.min(e.min, g.plays); common.set(k, e); }));
    const song = [...common.values()].filter((e) => e.n === people.length).sort((a, b) => b.min - a.min)[0];
    if (song) slides.push({ k: 'The song you all keep coming back to', big: esc(song.title), sub: `${esc(song.artist)} · at least ${num(song.min)} plays each` });
    const big = P.map((x, i) => [i, x.sec]).sort((a, b) => b[1] - a[1])[0];
    slides.push({ k: 'Biggest listener', big: who(big[0]), sub: `${hours(big[1])} · ${pct(big[1] / total)} of the group's listening` });
    const T = P.map(top150);
    let best = null;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const m = match(T[i], T[j]); if (!best || m > best[2]) best = [i, j, m]; }
    if (best) slides.push({ k: people.length > 2 ? 'Closest taste' : 'Your taste match', big: pct(best[2]), sub: `${who(best[0])} & ${who(best[1])}` });
    const owl = P.map((x, i) => [i, x.night]).filter((x) => x[1] !== null).sort((a, b) => b[1] - a[1])[0];
    const bird = P.map((x, i) => [i, x.morning]).filter((x) => x[1] !== null).sort((a, b) => b[1] - a[1])[0];
    if (owl && bird) slides.push({ k: 'Night owl & early bird', big: `🦉 ${who(owl[0])}`, sub: `${pct(owl[1])} of their listening after 10pm`, extra: `<p class="wr-sub">🌅 ${who(bird[0])} · ${pct(bird[1])} between 5 and 9am</p>` });
    const ts = ff.score.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1])[0];
    if (ts && ts[1] > 0) slides.push({ k: 'Trendsetter', big: who(ts[0]), sub: `found ${plural(ts[1], 'shared song')} before anyone else` });
    slides.push({ k: 'Now make it a playlist', big: 'Blend', sub: 'Songs you have in common, then everyone\'s favorites taking turns.', extra: '<button class="primary wr-go" type="button" data-fr="toPlaylist">Make the Blend</button>' });
    return slides;
  }
  function renderWrapped() {
    const el = $('frWrapped'), S = st.wrapped || [];
    if (!el) return;
    if (!S.length) { el.hidden = true; return; }
    const i = Math.max(0, Math.min(S.length - 1, st.slide)), sl = S[i];
    st.slide = i;
    el.style.setProperty('--wa', st.people[i % st.people.length].color);
    el.innerHTML = `<div class="wr-top"><span class="wr-label">Your group's Wrapped</span><span class="wr-count">${i + 1} / ${S.length}</span></div>
      <div class="wr-slide" aria-live="polite"><p class="wr-k">${sl.k}</p><p class="wr-big">${sl.big}</p><p class="wr-sub">${sl.sub}</p>${sl.extra || ''}</div>
      <div class="wr-nav"><button type="button" class="wr-btn" data-wr="-1" aria-label="Previous"${i ? '' : ' disabled'}>‹</button>
        <span class="wr-dots">${S.map((_, k) => `<button type="button" data-wr-go="${k}" aria-label="Slide ${k + 1}"${k === i ? ' aria-current="true"' : ''}></button>`).join('')}</span>
        <button type="button" class="wr-btn" data-wr="1" aria-label="Next"${i < S.length - 1 ? '' : ' disabled'}>›</button></div>`;
  }

  function commonSongs(people, P) {
    const all = new Map();
    P.forEach((x, i) => x.songs.forEach((g, k) => { const e = all.get(k) || { ...g, who: new Map() }; e.who.set(i, g); all.set(k, e); }));
    const list = [...all.values()].filter((e) => e.who.size > 1)
      .sort((a, b) => b.who.size - a.who.size || Math.min(...[...b.who.values()].map((g) => g.plays)) - Math.min(...[...a.who.values()].map((g) => g.plays))).slice(0, 12);
    if (!list.length) return '<p class="muted small">No songs in common in this period.</p>';
    return `<table class="fr-table fr-songs"><thead><tr><th>Song</th>${people.map((p, i) => `<th class="num">${avatar(p.name, i)}<span class="sr">${esc(p.name)}</span></th>`).join('')}</tr></thead><tbody>
      ${list.map((e) => `<tr><td><b>${esc(e.title)}</b> <span class="muted small">${esc(e.artist)}</span></td>${people.map((p, i) => `<td class="num">${e.who.has(i) ? num(e.who.get(i).plays) : '<span class="muted">·</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table><p class="muted small">Plays each, in this period.</p>`;
  }

  // multi-line chart, drawn as SVG
  function lines(el, xs, series, fmtY, xLabel, tipX) {
    if (!el) return;
    const Wd = Math.max(260, el.clientWidth), H = 220, left = 40, right = 8, top = 8, bottom = 22, pw = Wd - left - right, ph = H - top - bottom;
    const max = Math.max(1e-9, ...series.flatMap((s) => s.vals)), step = niceStep(max), hi = Math.ceil(max / step) * step;
    const x = (i) => left + (xs.length === 1 ? pw / 2 : (i / (xs.length - 1)) * pw), y = (v) => top + ph - (v / hi) * ph;
    let g = '';
    for (let v = 0; v <= hi + 1e-9; v += step) g += `<line class="grid" x1="${left}" x2="${Wd - right}" y1="${y(v)}" y2="${y(v)}"/><text class="ylab" x="${left - 6}" y="${y(v) + 4}">${fmtY(v)}</text>`;
    let lastX = -1e9;
    xs.forEach((l, i) => { const t = xLabel(l, i); if (t && x(i) - lastX > 34) { g += `<text class="xlab" text-anchor="middle" x="${x(i)}" y="${H - 4}">${t}</text>`; lastX = x(i); } });
    const path = (v) => v.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d).toFixed(1)}`).join('');
    g += series.map((s) => `<path class="fr-line" style="stroke:${s.color}" d="${path(s.vals)}"/>`).join('');
    const hw = xs.length > 1 ? pw / (xs.length - 1) : pw;
    g += xs.map((l, i) => `<rect class="hit" data-i="${i}" x="${x(i) - hw / 2}" y="0" width="${hw}" height="${H}"/>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="Listening by month for each person">${g}</svg>`;
    el._tip = (i) => `<b>${tipX(xs[i])}</b>${series.map((s) => `<br><span class="tip-dot" style="background:${s.color}"></span>${esc(s.name)}: ${fmtY(s.vals[i], true)}`).join('')}`;
  }
  // 24-hour radial chart: each person's day as a closed shape
  function clock(el, people, P) {
    if (!el) return;
    if (!P.every((x) => x.hourly)) { el.innerHTML = '<p class="muted small">Not available for this group.</p>'; return; }
    const S = Math.min(340, Math.max(240, el.clientWidth)), c = S / 2, r0 = S * 0.1, R = S / 2 - 26;
    const mx = Math.max(...P.flatMap((x) => x.hourly), 1e-9);
    const ang = (h) => ((h + 0.5) / 24) * 2 * Math.PI - Math.PI / 2;
    const pt = (h, v) => { const r = r0 + (v / mx) * (R - r0); return [c + r * Math.cos(ang(h)), c + r * Math.sin(ang(h))]; };
    let g = '';
    [0.25, 0.5, 0.75, 1].forEach((f) => { g += `<circle class="grid" cx="${c}" cy="${c}" r="${(r0 + f * (R - r0)).toFixed(1)}" fill="none"/>`; });
    g += `<text class="ylab" x="${c + 3}" y="${(c - R + 10).toFixed(1)}" text-anchor="start">${Math.round(mx)} min</text>`;
    [0, 3, 6, 9, 12, 15, 18, 21].forEach((h) => {
      const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
      g += `<line class="grid" x1="${(c + r0 * Math.cos(a)).toFixed(1)}" y1="${(c + r0 * Math.sin(a)).toFixed(1)}" x2="${(c + R * Math.cos(a)).toFixed(1)}" y2="${(c + R * Math.sin(a)).toFixed(1)}"/>`;
      g += `<text class="xlab" text-anchor="middle" x="${(c + (R + 14) * Math.cos(a)).toFixed(1)}" y="${(c + (R + 14) * Math.sin(a) + 4).toFixed(1)}">${hl(h)}</text>`;
    });
    g += P.map((x, i) => `<path class="fr-blob" style="stroke:${people[i].color};fill:${people[i].color}" d="${x.hourly.map((v, h) => `${h ? 'L' : 'M'}${pt(h, v).map((n) => n.toFixed(1)).join(',')}`).join('')}Z"/>`).join('');
    for (let h = 0; h < 24; h++) {
      const a0 = (h / 24) * 2 * Math.PI - Math.PI / 2, a1 = ((h + 1) / 24) * 2 * Math.PI - Math.PI / 2;
      g += `<path class="hit" data-i="${h}" d="M${c},${c}L${(c + R * Math.cos(a0)).toFixed(1)},${(c + R * Math.sin(a0)).toFixed(1)}A${R},${R} 0 0 1 ${(c + R * Math.cos(a1)).toFixed(1)},${(c + R * Math.sin(a1)).toFixed(1)}Z"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Listening by hour of day for each person">${g}</svg>`;
    el._tip = (h) => `<b>${hl(h)}–${hl((h + 1) % 24)}</b>${P.map((x, i) => `<br><span class="tip-dot" style="background:${people[i].color}"></span>${esc(people[i].name)}: ${x.hourly[h] < 1 ? x.hourly[h].toFixed(1) : Math.round(x.hourly[h])} min`).join('')}`;
  }
  function drawCharts() {
    if (!st.P || !$('frMonthly')) return;
    const keys = [...new Set(st.P.flatMap((x) => [...x.monthly.keys()]))].sort();
    const allKeys = [];
    if (keys.length) { // every month between the first and last, so gaps show as zero
      let [yy, mm] = keys[0].split('-').map(Number);
      const end = keys.at(-1);
      for (;;) { const k = `${yy}-${String(mm).padStart(2, '0')}`; allKeys.push(k); if (k >= end) break; mm++; if (mm > 12) { mm = 1; yy++; } }
    }
    const hrs = (v, tip) => (tip ? hours(v * 3600) : `${num(v)} h`);
    lines($('frMonthly'), allKeys, st.people.map((p, i) => ({ name: p.name, color: p.color, vals: allKeys.map((k) => (st.P[i].monthly.get(k) || 0) / 3600) })), hrs,
      (k) => (allKeys.length > 24 ? (k.endsWith('-01') ? k.slice(0, 4) : '') : MONTHS[+k.slice(5) - 1]), monthLabel);
    clock($('frClock'), st.people, st.P);
  }

  // tooltips: chart hit areas, and anything with data-tip
  sec.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) { placeTip(t.dataset.tip, e); return; }
    const r = e.target.closest?.('.hit');
    const host = r?.closest('.fr-chart, .fr-clock');
    if (r && host?._tip) placeTip(host._tip(+r.dataset.i), e);
  });
  sec.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  sec.addEventListener('mouseover', (e) => { if (!e.target.closest('.fr-chart, .fr-clock, [data-tip]')) $('tip').hidden = true; });
  sec.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const t = e.target.closest('[data-tip]'), r = e.target.closest('.hit'), host = r?.closest('.fr-chart, .fr-clock');
    const html = t ? t.dataset.tip : host?._tip ? host._tip(+r.dataset.i) : null;
    if (html) { lastTouch = performance.now(); placeTip(html, e); tipTouched = true; tipScrollY = scrollY; }
  });
  if (window.ResizeObserver) {
    let w = 0;
    new ResizeObserver(() => { if (sec.hidden || sec.clientWidth === w) return; w = sec.clientWidth; drawCharts(); }).observe(sec);
  }

  // ---------- actions ----------
  const status = (t, id = 'frStatus') => { const el = $(id); if (el) el.textContent = t; };
  async function doShare() {
    const name = cleanName($('frName')?.value || C.mine()?.name) || `Listener ${Math.random().toString(36).slice(2, 6)}`;
    st.shareError = null;
    sec.querySelectorAll('[data-fr="share"]').forEach((b) => { b.disabled = true; });
    try {
      await C.share(ME, name, (label, f) => status(`${label}… ${Math.round(f * 100)}%`));
      renderTop();
      status('Shared. Copy the link and send it to friends.');
    } catch (e) {
      status(`Couldn't share: ${e.message}`);
      sec.querySelectorAll('[data-fr]').forEach((b) => { b.disabled = false; });
    }
  }
  sec.addEventListener('click', (e) => {
    const w = e.target.closest('[data-wr], [data-wr-go]');
    if (!w) return;
    st.slide = w.dataset.wrGo !== undefined ? +w.dataset.wrGo : st.slide + +w.dataset.wr;
    renderWrapped();
    $('frWrapped').focus({ preventScroll: true });
  });
  sec.addEventListener('keydown', (e) => {
    if (!e.target.closest?.('#frWrapped') || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    st.slide += e.key === 'ArrowRight' ? 1 : -1;
    renderWrapped();
  });
  sec.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fr]');
    if (!b) return;
    const act = b.dataset.fr, card = b.closest('[data-id]');
    if (act === 'toPlaylist') { $('frPlaylist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (act === 'back') leave();
    if (act === 'share') doShare();
    if (act === 'pick') document.querySelector('#sourceBar [data-act="pick"]')?.click();
    if (act === 'rename') {
      const name = cleanName($('frName').value);
      if (!name) { status('Enter a name.'); return; }
      try { await C.rename(name); status('Name saved.'); } catch (err) { status(`Couldn't save the name: ${err.message}`); }
    }
    if (act === 'copy') {
      const inp = sec.querySelector('#frShare .fr-link input');
      try { await navigator.clipboard.writeText(inp.value); status('Link copied.'); } catch { inp.select(); status('Press Ctrl+C (⌘C) to copy.'); }
    }
    if (act === 'unshare') {
      if (!confirm('Stop sharing? Your link will stop working for everyone.')) return;
      try { await C.unshare(); renderTop(); status('Stopped sharing. Your link no longer works.'); } catch (err) { status(`Couldn't stop sharing: ${err.message}`); }
    }
    if (act === 'toggle' && card) {
      const id = card.dataset.id;
      if (st.with.includes(id)) pick(st.with.filter((x) => x !== id));
      else if (st.with.length >= MAX_FRIENDS) status(`You can compare up to ${MAX_FRIENDS} friends at once. Untick one first.`, 'frAddStatus');
      else pick([...st.with, id]);
    }
    if (act === 'remove' && card) {
      C.removeFriend(card.dataset.id);
      st.infos.delete(card.dataset.id);
      pick(st.with.filter((x) => x !== card.dataset.id));
    }
  });
  sec.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-fr-form]')) return;
    e.preventDefault();
    const id = C.parseCode($('frCode').value);
    if (!id) { status("That doesn't look like a share link or code.", 'frAddStatus'); return; }
    if (id === C.mine()?.id) { status("That's your own link.", 'frAddStatus'); return; }
    status('Checking…', 'frAddStatus');
    try {
      const [row] = await C.info([id]);
      if (!row) { status('Nothing is shared at that link (they may have stopped sharing).', 'frAddStatus'); return; }
      C.addFriend(id, row.name);
      st.infos.set(id, row);
      $('frCode').value = '';
      status(`Added ${row.name}.`, 'frAddStatus');
      pick(st.with.includes(id) ? st.with : [...st.with, id].slice(-MAX_FRIENDS));
    } catch (err) { status(err.message, 'frAddStatus'); }
  });
  sec.addEventListener('change', (e) => {
    if (e.target.id === 'frPeriod') { st.period = e.target.value; renderGroup(); }
  });
  sec.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.id !== 'frName') return;
    sec.querySelector('[data-fr="rename"], [data-fr="share"]')?.click();
  });
  $('friendsBtn').addEventListener('click', () => (isOpen() ? leave() : go([])));
  if (isOpen()) sync();
})();
