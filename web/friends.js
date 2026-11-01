// Friends: share your stats with a link, and compare with people who shared theirs.
// A separate view (?friends) so the main charts stay exactly as they are.
(() => {
  const C = window.SpotifyCloud, SRC = window.SPOTIFY_SOURCE || { kind: 'default' }, ME = window.SPOTIFY;
  if (!C) return;
  const bar = $('sourceBar');
  const ownPage = location.pathname; // without ?s=…
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // ---------- source bar ----------
  if (SRC.kind === 'shared') {
    bar.innerHTML = `<span>You're looking at <b>${esc(SRC.name)}</b>'s shared stats · updated ${fmtDate(SRC.updated)}</span>
      <span class="sb-actions"><a class="ghost" href="${ownPage}?friends&amp;with=${SRC.id}">Compare with mine</a><a class="primary" href="${ownPage}">Back to my stats</a></span>`;
    return; // comparing happens from your own page
  }
  bar.querySelector('.sb-actions')?.insertAdjacentHTML('afterbegin', '<button class="ghost" id="friendsBtn" aria-pressed="false">Friends</button>');

  // ---------- the view ----------
  const sec = document.createElement('section');
  sec.id = 'friends';
  sec.hidden = true;
  bar.after(sec);

  const st = { with: null, period: 'all', cache: new Map(), loading: null, infos: new Map() };
  const params = () => new URLSearchParams(location.search);
  const isOpen = () => params().has('friends');
  function go(withId, push = true) {
    const q = new URLSearchParams(); q.set('friends', '');
    if (withId) q.set('with', withId);
    const url = `${ownPage}?${q.toString().replace('friends=', 'friends')}${location.hash}`;
    if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    sync();
  }
  function leave() { history.pushState(null, '', ownPage + location.hash); sync(); }
  function sync() {
    const open = isOpen();
    document.body.classList.toggle('friends-mode', open);
    sec.hidden = !open;
    $('friendsBtn').setAttribute('aria-pressed', String(open));
    if (!open) { window.dispatchEvent(new Event('resize')); return; }
    const w = params().get('with');
    if (w && C.parseCode(w)) C.addFriend(w, null);
    st.with = w && C.parseCode(w) ? w : null;
    render();
    scrollTo(0, 0);
    autoShare();
  }
  // Opening Friends puts your stats on the server, unless they're already there (same data) or you stopped sharing.
  const canShare = SRC.kind === 'mine' || !!SRC.own;
  let sharing = null;
  function autoShare() {
    const me = C.mine();
    if (!canShare || sharing || me?.stopped || (me?.at && me.fp === C.fingerprint(ME))) return;
    const name = me?.name || (ME.name && !/^default$/i.test(ME.name) ? cleanName(ME.name) : `Listener ${Math.random().toString(36).slice(2, 6)}`);
    sharing = C.share(ME, name, (label, f) => { st.progress = `${label}… ${Math.round(f * 100)}%`; status(st.progress); })
      .then(() => { st.progress = null; if (isOpen()) { render(); status('Your stats are shared. Send friends the link.'); } })
      .catch((e) => { st.progress = null; st.shareError = e.message; if (isOpen()) render(); })
      .finally(() => { sharing = null; });
  }
  addEventListener('popstate', sync);

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
    return {
      ...T, artists, songs, monthly, hourly, nSongs: songIds.size, nArtists: artists.size,
      skipRate: T.tp ? T.skips / T.tp : null, retention: T.mp ? T.heard / T.mp / 1000 : null,
    };
  }
  // taste match: how much of each person's listening time goes to the same artists (0–100%)
  function match(a, b) {
    let m = 0;
    for (const [n, x] of a) { const y = b.get(n); if (y) m += Math.min(x / a.total, y / b.total); }
    return m;
  }
  const pct1 = (x) => (x > 0 && x < 0.1 ? `${(x * 100).toFixed(1)}%` : pct(x)); // one decimal for small shares
  const shareMap = (entries) => { const mp = new Map(entries); mp.total = [...mp.values()].reduce((s, v) => s + v, 0) || 1; return mp; };
  const myTop = () => (st.myTop ||= shareMap(C.summarize(ME).top));

  // ---------- render ----------
  function render() {
    const me = C.mine(), friends = C.friends();
    const myName = me?.name || (ME.name && !/^default$/i.test(ME.name) ? ME.name : '');
    sec.innerHTML = `
      <div class="fr-head">
        <div><h2 class="fr-title">Friends</h2><p class="muted small">Your stats are shared here so friends can compare with you. Send them your link, or add theirs.</p></div>
        <button class="ghost" data-fr="back">← Back to my stats</button>
      </div>
      <div class="two-col fr-top">
        <section class="card" id="frShare">
          <h2>Your link</h2>
          ${shareCard(me, myName)}
          <p class="fr-status muted small" id="frStatus" role="status">${esc(st.progress || '')}</p>
        </section>
        <section class="card" id="frAdd">
          <h2>Add a friend</h2>
          <p class="muted small">Paste the link (or code) a friend sent you.</p>
          <form class="fr-link" data-fr-form><input id="frCode" placeholder="https://…?s=abc123… or abc123…" aria-label="Friend's link or code" autocomplete="off"><button class="primary">Add</button></form>
          <p class="fr-status muted small" id="frAddStatus" role="status"></p>
        </section>
      </div>
      <section class="card" id="frList">
        <h2>Your friends</h2>
        ${friends.length ? `<table class="fr-table"><thead><tr><th>Name</th><th class="num">Listening time</th><th class="num">Plays</th><th class="num">Artists</th><th>Top artist</th><th class="num" title="How much of your listening time goes to the same artists">Taste match</th><th></th></tr></thead>
          <tbody>${friends.map((f) => friendRow(f)).join('')}</tbody></table>`
          : '<p class="muted small">No friends added yet. Send them your link, or paste theirs above.</p>'}
      </section>
      <div id="frCompare"></div>`;
    refreshInfos();
    if (st.with) renderCompare();
  }
  function shareCard(me, myName) {
    if (!canShare) {
      return `<p class="muted small">To share your stats and compare with friends, load your own Spotify data first.</p>
        <div class="fr-row"><button class="primary" data-fr="pick">⬆ Load your own Spotify data</button></div>`;
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
        <div class="fr-link"><input id="frName" maxlength="40" value="${esc(me.name || myName)}" placeholder="Your name, as friends will see it" aria-label="Your name"><button class="primary" data-fr="share">Share again</button></div>`;
    }
    if (st.shareError) {
      return `<p class="muted small">Couldn't share your stats: ${esc(st.shareError)}</p>
        <div class="fr-row"><button class="primary" data-fr="share">Try again</button></div>`;
    }
    return `<p class="muted small">Sharing your stats so friends can compare (a summary of your listening, not your raw Spotify files)…</p>`;
  }
  function friendRow(f) {
    const inf = st.infos.get(f.id), s = inf?.summary;
    const m = s?.top ? match(myTop(), shareMap(s.top)) : null;
    return `<tr data-id="${f.id}" class="${st.with === f.id ? 'on' : ''}">
      <td><b>${esc(inf?.name || f.name)}</b>${inf === null ? ' <span class="muted small">· not shared anymore</span>' : ''}</td>
      <td class="num">${s ? hours(s.sec) : '…'}</td><td class="num">${s ? num(s.plays) : ''}</td><td class="num">${s ? num(s.artists) : ''}</td>
      <td>${s?.top?.[0] ? esc(s.top[0][0]) : ''}</td>
      <td class="num">${m === null ? '' : `<span class="fr-match"><i style="width:${Math.round(m * 100)}%"></i></span>${pct(m)}`}</td>
      <td class="fr-acts">${inf === null ? '' : `<button class="ghost" data-fr="compare">Compare</button><a class="ghost" href="${ownPage}?s=${f.id}">Their stats</a>`}<button class="ghost icon" data-fr="remove" title="Remove" aria-label="Remove ${esc(f.name)}">×</button></td></tr>`;
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
      if ($('frAddStatus')) $('frAddStatus').textContent = e.message;
      return;
    }
    if (req === infoReq && isOpen()) {
      const tb = sec.querySelector('.fr-table tbody');
      if (tb) tb.innerHTML = C.friends().map((f) => friendRow(f)).join('');
    }
  }

  // ---------- compare ----------
  async function loadFriend(id) {
    if (st.cache.has(id)) return st.cache.get(id);
    const box = $('frCompare');
    box.innerHTML = `<section class="card"><p class="muted">Loading their stats… <span id="frLoad"></span></p></section>`;
    const got = await C.fetch(id, (i, n) => { const el = $('frLoad'); if (el) el.textContent = `${Math.round((i / n) * 100)}%`; });
    st.cache.set(id, got);
    return got;
  }
  async function renderCompare() {
    const id = st.with;
    let F;
    try { F = await loadFriend(id); } catch (e) {
      $('frCompare').innerHTML = `<section class="card"><p>${esc(e.message)}</p></section>`;
      return;
    }
    if (st.with !== id || !isOpen()) return;
    const FD = F.data;
    const years = [...new Set([...ME.months, ...FD.months].map((m) => m.slice(0, 4)))].sort();
    if (st.period !== 'all' && !years.includes(st.period)) st.period = 'all';
    const [from, to] = st.period === 'all' ? ['0000-00', '9999-99'] : [`${st.period}-01`, `${st.period}-12`];
    const A = profile(ME, from, to), B = profile(FD, from, to);
    st.A = A; st.B = B; st.F = F;
    const name = esc(F.name);
    // same method as the friends list (each person's top 150 artists), so the two numbers agree
    const top150 = (P) => shareMap([...P.artists].map(([n, v]) => [n, v.sec]).sort((x, y) => y[1] - x[1]).slice(0, 150));
    const m = match(top150(A), top150(B));
    const sharedArtists = [...A.artists].filter(([n]) => B.artists.has(n));
    const shareOf = (P, n) => (P.artists.get(n)?.sec || 0) / (P.sec || 1);
    const both = sharedArtists.map(([n]) => [n, Math.min(shareOf(A, n), shareOf(B, n))]).sort((x, y) => y[1] - x[1]);
    const label = st.period === 'all' ? 'All time' : st.period;

    const tiles = [
      ['Listening time', A.sec, B.sec, hours],
      ['Plays', A.plays, B.plays, num],
      ['Songs', A.nSongs, B.nSongs, num],
      ['Artists', A.nArtists, B.nArtists, num],
      ['Skip rate', A.skipRate, B.skipRate, pct],
      ['Retention', A.retention, B.retention, pct],
    ];
    const big = (x, y) => (x !== null && y !== null && x > y ? ' win' : '');
    // artists that take a much bigger share of one person's listening than the other's
    const top = (P, Q, k = 8) => [...P.artists].map(([n, v]) => [n, v, shareOf(P, n) - shareOf(Q, n)])
      .filter(([n, , d]) => d > 0 && shareOf(P, n) > 2 * shareOf(Q, n)).sort((x, y) => y[2] - x[2]).slice(0, k);
    const butterfly = both.slice(0, 12);
    const maxShare = Math.max(1e-9, ...butterfly.map(([n]) => Math.max(shareOf(A, n), shareOf(B, n))));
    const songsBoth = [...A.songs].filter(([k]) => B.songs.has(k)).map(([k, v]) => [v, B.songs.get(k)])
      .sort((x, y) => Math.min(y[0].plays, y[1].plays) - Math.min(x[0].plays, x[1].plays)).slice(0, 10);

    $('frCompare').innerHTML = `
      <section class="card fr-cmp">
        <div class="fr-cmp-head">
          <div><h2>You vs ${name} <span class="period muted">${label}</span></h2>
            <p class="muted small"><span class="fr-key you"></span>You <span class="fr-key them"></span>${name} · ${name}'s history covers ${monthLabel(FD.months[0])} – ${monthLabel(FD.months.at(-1))}</p></div>
          <label class="fr-period">Period <select id="frPeriod"><option value="all">All time</option>${years.map((y) => `<option value="${y}"${st.period === y ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
        </div>
        <div class="fr-match-big"><b>${pct(m)}</b><span>taste match<br><small class="muted">${num(sharedArtists.length)} artists in common${both[0] ? ` · most shared: ${both.slice(0, 3).map(([n]) => esc(n)).join(', ')}` : ''}</small></span></div>
        <div class="fr-tiles">${tiles.map(([l, x, y, f]) => `<div class="fr-tile"><span>${l}</span>
          <div class="fr-vs"><b class="you${big(x, y)}">${x === null ? '—' : f(x)}</b><b class="them${big(y, x)}">${y === null ? '—' : f(y)}</b></div>
          <div class="fr-split">${x !== null && y !== null && x + y > 0 ? `<i class="you" style="width:${(x / (x + y)) * 100}%"></i><i class="them"></i>` : ''}</div></div>`).join('')}</div>
      </section>
      <section class="card"><h2>Listening by month <span class="period muted">${label}</span></h2><p class="muted small">Hours per month</p><div class="fr-chart" id="frMonthly"></div></section>
      <section class="card"><h2>Time of day <span class="period muted">${label}</span></h2><p class="muted small">Average minutes of listening per day, by hour</p><div class="fr-chart" id="frHours"></div></section>
      <section class="card"><h2>Artists you both love <span class="period muted">${label}</span></h2><p class="muted small">Share of each person's listening time</p>
        ${butterfly.length ? `<div class="fr-bf"><div class="fr-bf-h"><span>You</span><span></span><span>${name}</span></div>${butterfly.map(([n]) => `<div class="fr-bf-row">
          <span class="fr-bf-l"><em>${pct1(shareOf(A, n))}</em><i class="you" style="width:${(shareOf(A, n) / maxShare) * 100}%"></i></span>
          <span class="fr-bf-n">${esc(n)}</span>
          <span class="fr-bf-r"><i class="them" style="width:${(shareOf(B, n) / maxShare) * 100}%"></i><em>${pct1(shareOf(B, n))}</em></span></div>`).join('')}</div>`
        : '<p class="muted small">No artists in common in this period.</p>'}
      </section>
      <div class="two-col">
        <section class="card"><h2>More you than ${name}</h2><p class="muted small">Artists that take a much bigger share of your listening</p>${list(top(A, B), A, B)}</section>
        <section class="card"><h2>More ${name} than you</h2><p class="muted small">Artists that take a much bigger share of ${name}'s listening</p>${list(top(B, A), B, A)}</section>
      </div>
      <section class="card"><h2>Songs you both play <span class="period muted">${label}</span></h2>
        ${songsBoth.length ? `<table class="fr-table"><thead><tr><th>Song</th><th class="num">Your plays</th><th class="num">${name}'s plays</th></tr></thead><tbody>
          ${songsBoth.map(([a, b]) => `<tr><td><b>${esc(a.title)}</b> <span class="muted small">${esc(a.artist)}</span></td><td class="num">${num(a.plays)}</td><td class="num">${num(b.plays)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted small">No songs in common in this period.</p>'}
      </section>`;
    drawCharts();
  }
  function list(items, P, Q) {
    if (!items.length) return '<p class="muted small">Nothing stands out: you overlap a lot.</p>';
    return `<ol class="toplist">${items.map(([n, v], i) => `<li><span class="rank">${i + 1}</span><span class="name">${esc(n)}</span><span class="val">${hours(v.sec)}<small class="muted"> vs ${Q.artists.get(n) ? hours(Q.artists.get(n).sec) : 'none'}</small></span></li>`).join('')}</ol>`;
  }

  // two-line chart, drawn as SVG
  function lines(el, xs, a, b, fmtY, xLabel, tipX) {
    if (!el) return;
    const Wd = Math.max(280, el.clientWidth), H = 200, left = 40, right = 8, top = 8, bottom = 22, pw = Wd - left - right, ph = H - top - bottom;
    const max = Math.max(1e-9, ...a, ...b), step = niceStep(max), hi = Math.ceil(max / step) * step;
    const x = (i) => left + (xs.length === 1 ? pw / 2 : (i / (xs.length - 1)) * pw), y = (v) => top + ph - (v / hi) * ph;
    let g = '';
    for (let v = 0; v <= hi + 1e-9; v += step) g += `<line class="grid" x1="${left}" x2="${Wd - right}" y1="${y(v)}" y2="${y(v)}"/><text class="ylab" x="${left - 6}" y="${y(v) + 4}">${fmtY(v)}</text>`;
    let lastX = -1e9;
    xs.forEach((l, i) => { const t = xLabel(l, i); if (t && x(i) - lastX > 34) { g += `<text class="xlab" text-anchor="middle" x="${x(i)}" y="${H - 4}">${t}</text>`; lastX = x(i); } });
    const path = (v) => v.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d).toFixed(1)}`).join('');
    g += `<path class="fr-line you" d="${path(a)}"/><path class="fr-line them" d="${path(b)}"/>`;
    const hw = xs.length > 1 ? pw / (xs.length - 1) : pw;
    g += xs.map((l, i) => `<rect class="hit" data-i="${i}" x="${x(i) - hw / 2}" y="0" width="${hw}" height="${H}"/>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="Chart comparing you and ${esc(st.F.name)}">${g}</svg>`;
    el._tip = (i) => `<b>${tipX(xs[i])}</b><br>You: ${fmtY(a[i], true)}<br>${esc(st.F.name)}: ${fmtY(b[i], true)}`;
  }
  function drawCharts() {
    if (!st.A || !$('frMonthly')) return;
    const keys = [...new Set([...st.A.monthly.keys(), ...st.B.monthly.keys()])].sort();
    const allKeys = [];
    if (keys.length) { // every month between the first and last, so gaps show as zero
      let [yy, mm] = keys[0].split('-').map(Number);
      const end = keys.at(-1);
      for (;;) { const k = `${yy}-${String(mm).padStart(2, '0')}`; allKeys.push(k); if (k >= end) break; mm++; if (mm > 12) { mm = 1; yy++; } }
    }
    const hrs = (v, tip) => (tip ? hours(v * 3600) : `${num(v)} h`);
    lines($('frMonthly'), allKeys, allKeys.map((k) => (st.A.monthly.get(k) || 0) / 3600), allKeys.map((k) => (st.B.monthly.get(k) || 0) / 3600), hrs,
      (k) => (allKeys.length > 24 ? (k.endsWith('-01') ? k.slice(0, 4) : '') : MONTHS[+k.slice(5) - 1]), monthLabel);
    const hEl = $('frHours');
    if (st.A.hourly && st.B.hourly) {
      const H = [...Array(24).keys()], hl = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
      lines(hEl, H, st.A.hourly, st.B.hourly, (v, tip) => (tip ? `${v < 1 ? v.toFixed(1) : Math.round(v)} min` : `${num(v)}m`), (h) => (h % 3 === 0 ? hl(h) : ''), (h) => `${hl(h)}–${hl((h + 1) % 24)}`);
    } else hEl.innerHTML = '<p class="muted small">Not available for this pair.</p>';
  }
  for (const id of ['frMonthly', 'frHours']) {
    sec.addEventListener('mousemove', (e) => {
      const r = e.target.closest?.(`#${id} .hit`);
      if (!r) return;
      placeTip($(id)._tip(+r.dataset.i), e);
    });
  }
  sec.addEventListener('mouseleave', () => { $('tip').hidden = true; });
  sec.addEventListener('mouseover', (e) => { if (!e.target.closest('.fr-chart')) $('tip').hidden = true; });
  sec.addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.fr-chart .hit');
    if (r && e.pointerType === 'touch') { lastTouch = performance.now(); placeTip(r.closest('.fr-chart')._tip(+r.dataset.i), e); tipTouched = true; tipScrollY = scrollY; }
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
      render();
      status('Shared. Copy the link and send it to friends.');
    } catch (e) {
      status(`Couldn't share: ${e.message}`);
      sec.querySelectorAll('[data-fr]').forEach((b) => { b.disabled = false; });
    }
  }
  sec.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fr]');
    if (!b) return;
    const act = b.dataset.fr, row = b.closest('tr[data-id]');
    if (act === 'back') leave();
    if (act === 'share') doShare();
    if (act === 'pick') document.querySelector('#sourceBar [data-act="pick"]')?.click();
    if (act === 'rename') {
      const name = cleanName($('frName').value);
      if (!name) { status('Enter a name.'); return; }
      try { await C.rename(name); status('Name saved.'); } catch (err) { status(`Couldn't save the name: ${err.message}`); }
    }
    if (act === 'copy') {
      const inp = sec.querySelector('.fr-link input');
      try { await navigator.clipboard.writeText(inp.value); status('Link copied.'); } catch { inp.select(); status('Press Ctrl+C (⌘C) to copy.'); }
    }
    if (act === 'unshare') {
      if (!confirm('Stop sharing? Your link will stop working for everyone.')) return;
      try { await C.unshare(); render(); status('Stopped sharing. Your link no longer works.'); } catch (err) { status(`Couldn't stop sharing: ${err.message}`); }
    }
    if (act === 'compare' && row) go(row.dataset.id);
    if (act === 'remove' && row) {
      C.removeFriend(row.dataset.id);
      st.infos.delete(row.dataset.id);
      if (st.with === row.dataset.id) go(null, false); else render();
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
      if (!row) { status("Nothing is shared at that link (they may have stopped sharing).", 'frAddStatus'); return; }
      C.addFriend(id, row.name);
      st.infos.set(id, row);
      go(id);
    } catch (err) { status(err.message, 'frAddStatus'); }
  });
  sec.addEventListener('change', (e) => {
    if (e.target.id === 'frPeriod') { st.period = e.target.value; renderCompare(); }
  });
  sec.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.id !== 'frName') return;
    sec.querySelector('[data-fr="rename"], [data-fr="share"]')?.click();
  });
  $('friendsBtn').addEventListener('click', () => (isOpen() ? leave() : go(null)));
  if (isOpen()) sync();
})();
