// Stories: extra views of the same data. Obsessions, taste drift, discovery, streaks, song length,
// loyalty, songs that grew on you, comebacks, how each artist gets played, this month in past years,
// and the cards that sit on other pages: records & milestones, year by year, your week.
// Uses app.js's data and helpers (D, R, W, N, agg, state, …); renderStories() runs with renderAll().
(() => {
  const S = {}; // cached all-time work
  const mShort = (m) => MONTHS[+D.months[m].slice(5) - 1];
  const mLab = (m) => monthLabel(D.months[m]);
  const span = (a, b) => (a === b ? mLab(a) : D.months[a].slice(0, 4) === D.months[b].slice(0, 4) ? `${mShort(a)}–${mShort(b)} ${D.months[b].slice(0, 4)}` : `${mLab(a)} – ${mLab(b)}`);
  const songName = (s) => `<b>${esc(D.songs[s][0])}</b> <span class="muted">${esc(D.artists[D.songs[s][1]])}</span>`;
  const artistOf = (s) => D.songs[s][1];
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; return el; };

  // per song: [[month, plays, skips], …] in month order (rows are already in month order)
  function songRows() {
    if (S.rows) return S.rows;
    const out = Array.from({ length: D.songs.length }, () => []);
    for (let i = 0; i < R.length; i += W) out[R[i]].push([R[i + 1], R[i + 2], R[i + 4] || 0]);
    return (S.rows = out);
  }

  // ---------- this month in past years ----------
  function renderAgo() {
    const last = N - 1, back = [1, 3, 5].map((k) => [k, last - 12 * k]).filter(([, m]) => m >= 0);
    const card = show('agoCard', back.length > 0);
    if (!back.length) return;
    const cols = back.map(([k, m]) => {
      const songs = new Map();
      let sec = 0;
      for (let i = 0; i < R.length; i += W) if (R[i + 1] === m) { songs.set(R[i], (songs.get(R[i]) || 0) + R[i + 3]); sec += R[i + 3]; }
      const top = [...songs].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return `<div class="ago-col"><h3>${k} year${k > 1 ? 's' : ''} ago <span class="muted">${mLab(m)}</span></h3>
        <p class="muted small">${sec ? `${hours(sec)} that month` : 'Nothing that month'}</p>
        <ol class="st-list">${top.map(([s, t]) => `<li data-song="${s}"><span>${songName(s)}</span><small class="muted">${hours(t)}</small></li>`).join('')}</ol></div>`;
    }).join('');
    card.querySelector('.ago-cols').innerHTML = cols;
    card.querySelector('.ago-sub').textContent = `What you played in ${MONTHS[+D.months[last].slice(5) - 1]} in earlier years.`;
  }

  // ---------- obsessions: short, intense phases with one song ----------
  function phases() {
    if (S.phases) return S.phases;
    const out = [];
    songRows().forEach((rows, s) => {
      let total = 0;
      for (const r of rows) total += r[1];
      if (total < 25) return;
      // best run of up to 3 consecutive months
      let best = null;
      for (let i = 0; i < rows.length; i++) {
        let sum = 0;
        for (let j = i; j < rows.length && rows[j][0] - rows[i][0] < 3; j++) {
          if (j > i && rows[j][0] !== rows[j - 1][0] + 1) break;
          sum += rows[j][1];
          if (!best || sum > best.plays) best = { from: rows[i][0], to: rows[j][0], plays: sum };
        }
      }
      if (!best || best.plays < 20 || best.plays / total < 0.35) return;
      let after = 0;
      for (const r of rows) if (r[0] > best.to) after += r[1];
      const status = best.to >= N - 3 ? 'now' : after < best.plays * 0.2 ? 'faded' : 'stayed';
      out.push({ s, ...best, total, after, status, score: best.plays * (best.plays / total) });
    });
    return (S.phases = out.sort((a, b) => b.score - a.score));
  }
  // the song's plays per month, from 6 months before the phase to 12 after
  function spark(s, from, to) {
    const a = Math.max(0, from - 6), b = Math.min(N - 1, to + 12), n = b - a + 1;
    const rows = songRows()[s].filter((r) => r[0] >= a && r[0] <= b), max = Math.max(...rows.map((r) => r[1]), 1), w = 160, h = 28, bw = w / n;
    return `<svg class="st-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Plays per month, ${mLab(a)} to ${mLab(b)}" role="img">
      <line x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}" class="base"/>${rows.map(([m, p]) =>
      `<rect x="${((m - a) * bw + 0.5).toFixed(2)}" width="${Math.max(bw - 1, 1).toFixed(2)}" y="${(h - (p / max) * h).toFixed(1)}" height="${((p / max) * h).toFixed(1)}" class="${m >= from && m <= to ? 'hot' : ''}"/>`).join('')}</svg>`;
  }
  function renderObsessions() {
    const [a, b] = state.range;
    const list = phases().filter((p) => p.to >= a && p.from <= b).slice(0, 8);
    const card = show('obsCard', true);
    const tag = { faded: ['then faded', 'faded'], stayed: ['stuck around', 'stayed'], now: ['happening now', 'now'] };
    card.querySelector('.obs-list').innerHTML = list.length ? list.map((p) => `<li data-song="${p.s}">
        <div class="obs-main"><span class="obs-t">${songName(p.s)}</span>
          <span class="obs-d">${num(p.plays)} plays in ${span(p.from, p.to)} · ${pct(p.plays / p.total)} of all its plays</span></div>
        ${spark(p.s, p.from, p.to)}<span class="st-tag ${tag[p.status][1]}">${tag[p.status][0]}</span></li>`).join('')
      : '<li class="muted small">No song had an intense phase in this period.</li>';
  }

  // ---------- taste drift: how much each year carries over from the last ----------
  function yearArtists() {
    if (S.years) return S.years;
    const by = new Map();
    for (let i = 0; i < R.length; i += W) {
      const y = D.months[R[i + 1]].slice(0, 4), a = artistOf(R[i]);
      let m = by.get(y);
      if (!m) by.set(y, (m = new Map()));
      m.set(a, (m.get(a) || 0) + R[i + 3]);
    }
    const ys = [...by.keys()].sort();
    const out = ys.map((y) => {
      const m = by.get(y), total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
      const ranked = [...m].sort((p, q) => q[1] - p[1]);
      return { y, m, total, rank: new Map(ranked.map(([a], i) => [a, i + 1])), top: ranked.slice(0, 10).map(([a]) => a), top50: new Set(ranked.slice(0, 50).map(([a]) => a)) };
    });
    out.forEach((Y, i) => {
      if (!i) return;
      const P = out[i - 1];
      let carried = 0;
      for (const [a, v] of Y.m) if (P.top50.has(a)) carried += v;
      Y.carry = carried / Y.total;
      Y.prev = P;
    });
    return (S.years = out);
  }
  let driftYear = null;
  function renderDrift() {
    const ys = yearArtists().filter((Y) => Y.prev);
    const card = show('driftCard', ys.length > 0);
    if (!ys.length) return;
    const inRange = new Set(D.months.slice(state.range[0], state.range[1] + 1).map((m) => m.slice(0, 4)));
    if (!driftYear || !ys.some((Y) => Y.y === driftYear)) driftYear = [...ys].reverse().find((Y) => inRange.has(Y.y))?.y || ys.at(-1).y;
    card.querySelector('.drift-bars').innerHTML = ys.map((Y) => `<button type="button" class="drift-b${Y.y === driftYear ? ' on' : ''}" data-year="${Y.y}" aria-pressed="${Y.y === driftYear}"
        data-tip="${esc(`<b>${Y.y}</b><br>${pct(Y.carry)} of your listening went to ${Y.prev.y}'s top 50 artists`)}">
        <span class="drift-v">${pct(Y.carry)}</span><span class="drift-bar"><i style="height:${(Y.carry * 100).toFixed(1)}%"></i></span><span class="drift-y">${Y.y}</span></button>`).join('');
    const Y = ys.find((x) => x.y === driftYear), P = Y.prev;
    const kept = Y.top.filter((a) => P.top.includes(a));
    const fresh = Y.top.filter((a) => !P.top.includes(a));
    const dropped = P.top.filter((a) => !Y.top.includes(a));
    const was = (a) => (P.rank.get(a) ? `was #${P.rank.get(a)}` : 'new');
    const now = (a) => (Y.rank.get(a) ? `now #${Y.rank.get(a)}` : 'not played');
    card.querySelector('.drift-detail').innerHTML = `
      <p class="drift-sum">In <b>${Y.y}</b>, ${pct(Y.carry)} of your listening went to ${P.y}'s top 50 artists. Of ${P.y}'s top 10, you kept <b>${kept.length}</b>.</p>
      <div class="drift-cols">
        <div><h3>Picked up</h3><ul>${fresh.map((a) => `<li data-artist="${a}"><span>${esc(D.artists[a])}</span><small class="up">${was(a)}</small></li>`).join('') || '<li class="muted small">None</li>'}</ul></div>
        <div><h3>Kept</h3><ul>${kept.map((a) => `<li data-artist="${a}"><span>${esc(D.artists[a])}</span><small class="muted">#${P.rank.get(a)} → #${Y.rank.get(a)}</small></li>`).join('') || '<li class="muted small">None</li>'}</ul></div>
        <div><h3>Dropped</h3><ul>${dropped.map((a) => `<li data-artist="${a}"><span>${esc(D.artists[a])}</span><small class="down">${now(a)}</small></li>`).join('') || '<li class="muted small">None</li>'}</ul></div>
      </div>`;
  }

  // ---------- discovery ----------
  function renderDiscovery() {
    const [a, b] = state.range, card = show('discCard', true);
    const perMonth = new Array(N).fill(0);
    const artSec = new Float64Array(D.artists.length), lastYear = new Float64Array(D.artists.length);
    for (let i = 0; i < R.length; i += W) { const ar = artistOf(R[i]); artSec[ar] += R[i + 3]; if (R[i + 1] >= N - 12) lastYear[ar] += R[i + 3]; }
    artistFirst.forEach((m, ar) => { if (m < N) perMonth[m]++; });
    const found = []; for (let ar = 0; ar < D.artists.length; ar++) if (artistFirst[ar] >= a && artistFirst[ar] <= b) found.push(ar);
    const regulars = found.filter((ar) => artSec[ar] >= 5 * 3600).length;
    card.querySelector('.disc-sum').innerHTML = `<b>${num(found.length)}</b> new artists ${isAll() ? 'since your history starts' : `in ${esc(rangeLabel(state.range))}`} · <b>${num(regulars)}</b> became regulars (5+ hours)`;
    // bars: new artists per month in the period (the very first month is everything you'd ever heard, so it's left out)
    const from = Math.max(a, 1), months = []; for (let m = from; m <= b; m++) months.push(m);
    const max = Math.max(1, ...months.map((m) => perMonth[m]));
    card.querySelector('.disc-bars').innerHTML = months.map((m) => `<span class="disc-b" style="height:${((perMonth[m] / max) * 100).toFixed(1)}%" data-tip="${esc(`<b>${mLab(m)}</b><br>${plural(perMonth[m], 'new artist')}`)}"></span>`).join('');
    card.querySelector('.disc-axis').innerHTML = months.length > 1 ? `<span>${mLab(months[0])}</span><span>${mLab(months.at(-1))}</span>` : '';
    // best finds of the period
    const best = found.sort((x, y) => artSec[y] - artSec[x]).slice(0, 6);
    card.querySelector('.disc-best').innerHTML = best.map((ar) => `<li data-artist="${ar}"><span><b>${esc(D.artists[ar])}</b> <small class="muted">found ${mLab(artistFirst[ar])}</small></span><small class="muted">${hours(artSec[ar])} since</small></li>`).join('') || '<li class="muted small">No new artists in this period.</li>';
    // do you keep what you find? share of each year's finds you still played in the last 12 months
    const byYear = new Map();
    for (let ar = 0; ar < D.artists.length; ar++) {
      const m = artistFirst[ar];
      if (m >= N || m === 0) continue;
      const y = D.months[m].slice(0, 4), e = byYear.get(y) || { n: 0, kept: 0 };
      e.n++; if (lastYear[ar] > 0) e.kept++; byYear.set(y, e);
    }
    const lastY = D.months[N - 1].slice(0, 4);
    card.querySelector('.disc-keep').innerHTML = [...byYear].sort().map(([y, e]) => `<div class="keep-row${y === lastY ? ' cur' : ''}"><span>${y}</span>
      <span class="keep-bar"><i style="width:${((e.kept / e.n) * 100).toFixed(1)}%"></i></span><span class="keep-v">${y === lastY ? '<small class="muted">this year</small>' : `${pct(e.kept / e.n)} <small class="muted">of ${num(e.n)}</small>`}</span></div>`).join('');
  }

  // ---------- streaks ----------
  function renderStreaks() {
    const card = show('streakCard', !!DD);
    if (!DD) return;
    const [d0, d1] = dayRange(state.range);
    const runs = [], gaps = [];
    let start = null, gapStart = null;
    for (let d = d0; d <= d1 + 1; d++) {
      const on = d <= d1 && DD.sec[d] > 0;
      if (on && start === null) start = d;
      if (!on && start !== null) { runs.push([start, d - 1]); start = null; }
      const off = d <= d1 && DD.sec[d] === 0;
      if (off && gapStart === null) gapStart = d;
      if (!off && gapStart !== null) { gaps.push([gapStart, d - 1]); gapStart = null; }
    }
    const len = ([x, y]) => y - x + 1;
    runs.sort((p, q) => len(q) - len(p)); gaps.sort((p, q) => len(q) - len(p));
    const days = d1 - d0 + 1, on = runs.reduce((s, r) => s + len(r), 0);
    const cur = d1 === lastDataDay ? runs.find((r) => r[1] === d1) : null;
    const range = ([x, y]) => (x === y ? fmtDay(x) : `${fmtDay(x, { month: 'short', day: 'numeric', ...(dayDate(x).getUTCFullYear() !== dayDate(y).getUTCFullYear() ? { year: 'numeric' } : {}) })} – ${fmtDay(y)}`);
    card.querySelector('.streak-tiles').innerHTML = `
      <div><b>${runs[0] ? plural(len(runs[0]), 'day') : '—'}</b><span>longest streak</span>${runs[0] ? `<small class="muted">${range(runs[0])}</small>` : ''}</div>
      <div><b>${cur ? plural(len(cur), 'day') : '—'}</b><span>current streak</span>${cur ? `<small class="muted">since ${fmtDay(cur[0])}</small>` : '<small class="muted">at the end of this period</small>'}</div>
      <div><b>${gaps[0] ? plural(len(gaps[0]), 'day') : 'none'}</b><span>longest break</span>${gaps[0] ? `<small class="muted">${range(gaps[0])}</small>` : ''}</div>
      <div><b>${pct(on / days)}</b><span>of days had music</span><small class="muted">${num(on)} of ${num(days)}</small></div>`;
    const top = runs.slice(0, 5), mx = top[0] ? len(top[0]) : 1;
    card.querySelector('.streak-list').innerHTML = top.map((r) => `<li><span class="sl-l">${range(r)}</span><span class="sl-bar"><i style="width:${((len(r) / mx) * 100).toFixed(1)}%"></i></span><span class="sl-v">${plural(len(r), 'day')}</span></li>`).join('');
  }

  // ---------- song length ----------
  const LEN_BUCKETS = [[0, 120, '<2'], [120, 180, '2–3'], [180, 240, '3–4'], [240, 300, '4–5'], [300, 360, '5–6'], [360, 480, '6–8'], [480, 720, '8–12'], [720, 1e9, '12+']];
  function renderLength() {
    const card = show('lenCard', true);
    const B = LEN_BUCKETS.map(() => ({ plays: 0, tp: 0, skips: 0 }));
    const weighted = [];
    for (const [s, v] of agg.songs) {
      const L = D.songs[s][3];
      if (!L) continue;
      const k = LEN_BUCKETS.findIndex(([x, y]) => L >= x && L < y);
      B[k].plays += v[0]; B[k].tp += v[7]; B[k].skips += v[7] ? v[2] : 0;
      weighted.push([L, v[0]]);
    }
    const total = B.reduce((s, b) => s + b.plays, 0);
    if (!total) { card.querySelector('.len-body').innerHTML = '<p class="muted small">No song lengths known for this period.</p>'; return; }
    weighted.sort((p, q) => p[0] - q[0]);
    let acc = 0, median = 0;
    for (const [L, p] of weighted) { acc += p; if (acc >= total / 2) { median = L; break; } }
    const mx = Math.max(...B.map((b) => b.plays / total));
    card.querySelector('.len-body').innerHTML = `<p class="len-sum">The typical song you play is <b>${mmss(median)}</b> long.</p>
      <div class="len-chart">${B.map((b, i) => `<div class="len-col" data-tip="${esc(`<b>${LEN_BUCKETS[i][2]} min songs</b><br>${num(b.plays)} plays (${pct(b.plays / total)})${b.tp ? `<br>skipped ${pct(b.skips / b.tp)}` : ''}`)}">
        <span class="len-skip">${b.tp >= 20 ? pct(b.skips / b.tp) : ''}</span><span class="len-bar"><i style="height:${((b.plays / total / mx) * 100).toFixed(1)}%"></i></span><span class="len-x">${LEN_BUCKETS[i][2]}</span></div>`).join('')}</div>
      <p class="muted small">Bars: share of plays by song length (minutes). Above each: how often you skip songs that long.</p>`;
  }

  // ---------- loyalty vs. one-song artists ----------
  function renderLoyalty() {
    const card = show('loyalCard', true);
    const by = new Map(); // artist -> { songs, plays, sec, top: [song, plays] }
    for (const [s, v] of agg.songs) {
      const a = artistOf(s);
      const e = by.get(a) || { songs: 0, plays: 0, sec: 0, top: [s, 0] };
      e.songs++; e.plays += v[0]; e.sec += v[1]; if (v[0] > e.top[1]) e.top = [s, v[0]];
      by.set(a, e);
    }
    const all = [...by];
    const one = all.filter(([, e]) => e.songs === 1);
    const deep = all.sort((p, q) => q[1].songs - p[1].songs || q[1].plays - p[1].plays).slice(0, 7);
    const hits = one.filter(([, e]) => e.plays >= 10).sort((p, q) => q[1].plays - p[1].plays).slice(0, 7);
    card.querySelector('.loyal-sum').innerHTML = all.length ? `For <b>${pct(one.length / all.length)}</b> of the artists you played, you only ever played one song.` : '';
    card.querySelector('.loyal-deep').innerHTML = deep.map(([a, e]) => `<li data-artist="${a}"><span><b>${esc(D.artists[a])}</b></span><small class="muted">${plural(e.songs, 'song')} · ${hours(e.sec)}</small></li>`).join('');
    card.querySelector('.loyal-one').innerHTML = hits.map(([a, e]) => `<li data-song="${e.top[0]}"><span><b>${esc(D.songs[e.top[0]][0])}</b> <span class="muted">${esc(D.artists[a])}</span></span><small class="muted">${num(e.plays)} plays</small></li>`).join('') || '<li class="muted small">None with 10+ plays.</li>';
  }

  // ---------- songs that grew on you / wore out (skip rate early vs. late) ----------
  function skipTurns() {
    if (S.turns) return S.turns;
    const grew = [], wore = [];
    songRows().forEach((rows, s) => {
      const tr = rows.filter((r) => tracked[r[0]]);
      const total = tr.reduce((x, r) => x + r[1], 0);
      if (total < 16) return;
      let acc = 0, i = 0;
      while (i < tr.length && acc + tr[i][1] <= total / 2) acc += tr[i++][1];
      if (i === 0) i = 1;
      const early = tr.slice(0, i), late = tr.slice(i);
      const sum = (rs, k) => rs.reduce((x, r) => x + r[k], 0);
      const ep = sum(early, 1), lp = sum(late, 1);
      if (ep < 6 || lp < 6) return;
      const er = sum(early, 2) / ep, lr = sum(late, 2) / lp, w = Math.sqrt(total);
      const e = { s, er, lr, from: early[0][0], to: late.at(-1)[0], plays: total };
      if (er - lr >= 0.3 && er >= 0.4) grew.push({ ...e, score: (er - lr) * w });
      if (lr - er >= 0.3 && lr >= 0.4) wore.push({ ...e, score: (lr - er) * w });
    });
    grew.sort((a, b) => b.score - a.score); wore.sort((a, b) => b.score - a.score);
    return (S.turns = { grew, wore });
  }
  function renderGrew() {
    const card = show('grewCard', firstTracked >= 0);
    if (firstTracked < 0) return;
    const { grew, wore } = skipTurns();
    const li = (e) => `<li data-song="${e.s}"><span>${songName(e.s)}</span><small class="st-turn">skipped <b>${pct(e.er)}</b> → <b>${pct(e.lr)}</b></small></li>`;
    card.querySelector('.grew-up').innerHTML = grew.slice(0, 6).map(li).join('') || '<li class="muted small">None yet.</li>';
    card.querySelector('.grew-down').innerHTML = wore.slice(0, 6).map(li).join('') || '<li class="muted small">None yet.</li>';
    card.querySelector('.grew-note').textContent = `${firstTracked > 0 ? `All time, from ${mLab(firstTracked)} (when skips start being recorded)` : 'All time'}. Compares how often you skipped a song in the first half of its plays vs. the second half.`;
  }

  // ---------- how each artist gets played (from the build: plays per start reason, and on shuffle) ----------
  const PICK_COLORS = ['var(--s1)', 'var(--s3)', 'var(--s2)', 'var(--s4)'];
  const PICK_LABELS = ['You picked it', 'Played next on its own', 'You skipped to it', 'Play button / other'];
  function renderPick() {
    const AH = D.artHow;
    const card = show('pickCard', !!AH);
    if (!AH) return;
    const rows = [];
    for (let a = 0; a < D.artists.length; a++) {
      const o = a * 6, g = [AH[o], AH[o + 1], AH[o + 2], AH[o + 3] + AH[o + 4]], n = g[0] + g[1] + g[2] + g[3];
      if (n) rows.push({ a, g, n, shuf: AH[o + 5] / n });
    }
    rows.sort((p, q) => q.n - p.n);
    const top = rows.slice(0, 12), big = rows.filter((r) => r.n >= 100);
    const most = (k) => [...big].sort((p, q) => q.g[k] / q.n - p.g[k] / p.n)[0];
    const picked = most(0), auto = most(1), shuf = [...big].sort((p, q) => q.shuf - p.shuf)[0];
    const T = rows.reduce((t, r) => t.map((x, i) => x + r.g[i]), [0, 0, 0, 0]), TN = T.reduce((s, x) => s + x, 0) || 1;
    card.querySelector('.pick-sum').innerHTML = `Overall, ${pct(T[0] / TN)} of your plays were songs you picked, ${pct(T[1] / TN)} came on by themselves, and ${pct(T[2] / TN)} you skipped to.`
      + (picked ? ` Most hand-picked: <b>${esc(D.artists[picked.a])}</b> (${pct(picked.g[0] / picked.n)}).` : '')
      + (auto ? ` Mostly comes on by itself: <b>${esc(D.artists[auto.a])}</b> (${pct(auto.g[1] / auto.n)}).` : '')
      + (shuf && shuf.shuf > 0 ? ` Most shuffled: <b>${esc(D.artists[shuf.a])}</b> (${pct(shuf.shuf)} on shuffle).` : '');
    card.querySelector('.pick-key').innerHTML = PICK_LABELS.map((l, i) => `<span><i style="background:${PICK_COLORS[i]}"></i>${l}</span>`).join('');
    card.querySelector('.pick-rows').innerHTML = top.map((r) => `<div class="pick-row" data-artist="${r.a}"><span class="pick-n">${esc(D.artists[r.a])}</span>
      <span class="pick-bar">${r.g.map((x, i) => (x ? `<i style="width:${((x / r.n) * 100).toFixed(2)}%;background:${PICK_COLORS[i]}" data-tip="${esc(`<b>${esc(D.artists[r.a])}</b><br>${PICK_LABELS[i]}: ${pct(x / r.n)} (${num(x)} plays)`)}"></i>` : '')).join('')}</span>
      <span class="pick-s" title="Plays on shuffle">${pct(r.shuf)} <small class="muted">shuffle</small></span></div>`).join('');
  }

  // ---------- records & milestones ----------
  const HOUR_MARKS = [100, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 30000, 50000];
  const PLAY_MARKS = [10000, 50000, 100000, 250000, 500000, 1000000];
  // when each round number was passed: [{ at: day index, label, when }], all time
  function milestones() {
    if (S.miles) return S.miles;
    const out = [];
    let acc = 0, k = 0;
    if (DD) {
      for (let d = 0; d < NDAYS && k < HOUR_MARKS.length; d++) {
        acc += DD.sec[d];
        while (k < HOUR_MARKS.length && acc >= HOUR_MARKS[k] * 3600) out.push({ at: d, label: `${num(HOUR_MARKS[k++])} hours`, when: fmtDay(d) });
      }
    } else {
      for (let m = 0; m < N && k < HOUR_MARKS.length; m++) {
        acc += monthTotals[m].sec;
        while (k < HOUR_MARKS.length && acc >= HOUR_MARKS[k] * 3600) out.push({ at: monthDay[m + 1] - 1, label: `${num(HOUR_MARKS[k++])} hours`, when: mLab(m) });
      }
    }
    const totalSec = monthTotals.reduce((t, x) => t + x.sec, 0);
    const nextHours = HOUR_MARKS.find((h) => h * 3600 > totalSec);
    acc = 0; k = 0;
    for (let m = 0; m < N && k < PLAY_MARKS.length; m++) {
      acc += monthTotals[m].plays;
      while (k < PLAY_MARKS.length && acc >= PLAY_MARKS[k]) out.push({ at: monthDay[m + 1] - 1.5, label: `${num(PLAY_MARKS[k++])} plays`, when: mLab(m) });
    }
    out.sort((x, y) => x.at - y.at);
    // the next one, at the pace of the last 12 months
    let next = null;
    const pace = monthTotals.slice(-12).reduce((t, x) => t + x.sec, 0) / Math.min(12, N);
    if (nextHours && pace > 0) {
      const months = Math.ceil((nextHours * 3600 - totalSec) / pace);
      if (months <= 120) {
        const [y, mo] = D.months[N - 1].split('-').map(Number), t = y * 12 + (mo - 1) + months;
        next = { label: `${num(nextHours)} hours`, when: `around ${MONTHS[t % 12]} ${Math.floor(t / 12)}` };
      }
    }
    return (S.miles = { list: out, next });
  }
  function renderRecords() {
    const [a, b] = state.range, card = show('recCard', true);
    const tiles = []; // [label, value, sub, action]
    // one song in one month, one artist in one month
    let bestRow = -1;
    const artMonth = new Map();
    for (let i = 0; i < R.length; i += W) {
      const m = R[i + 1];
      if (m < a || m > b) continue;
      if (bestRow < 0 || R[i + 2] > R[bestRow + 2]) bestRow = i;
      const key = artistOf(R[i]) * N + m;
      artMonth.set(key, (artMonth.get(key) || 0) + R[i + 3]);
    }
    if (DD) {
      const [d0, d1] = dayRange(state.range);
      if (d1 >= d0) {
        let big = d0;
        for (let d = d0; d <= d1; d++) if (DD.sec[d] > DD.sec[big]) big = d;
        tiles.push(['Biggest day', hm(DD.sec[big]), fmtDay(big, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), 'go:calCard']);
        // longest sitting: quarter-hours in a row that were at least half music
        const half = DD.slotMin / 2;
        let run = 0, mins = 0, best = { mins: 0, start: 0 };
        for (let j = d0 * SLOTS, end = (d1 + 1) * SLOTS; j <= end; j++) {
          const v = j < end ? slotMin[j] : 0;
          if (v >= half) { run++; mins += v; } else { if (mins > best.mins) best = { mins, start: j - run }; run = 0; mins = 0; }
        }
        if (best.mins >= 30) {
          const d = Math.floor(best.start / SLOTS);
          tiles.push(['Longest sitting', hm(best.mins * 60), `${fmtDay(d)}, from ${clockLabel((best.start % SLOTS) * DD.slotMin)}`, 'go:clockCard']);
        }
      }
    }
    if (b > a) {
      let m = a;
      for (let i = a; i <= b; i++) if (monthTotals[i].sec > monthTotals[m].sec) m = i;
      tiles.push(['Biggest month', hours(monthTotals[m].sec), mLab(m), `month:${m}`]);
    }
    if (bestRow >= 0) {
      const sng = R[bestRow];
      tiles.push(['Most replayed in a month', D.songs[sng][0], `${plural(R[bestRow + 2], 'play')} in ${mLab(R[bestRow + 1])} · ${D.artists[artistOf(sng)]}`, `song:${sng}`]);
    }
    let am = null;
    for (const [key, sec] of artMonth) if (!am || sec > am[1]) am = [key, sec];
    if (am) {
      const ar = Math.floor(am[0] / N), m = am[0] % N;
      tiles.push(['Biggest month for one artist', D.artists[ar], `${hours(am[1])} in ${mLab(m)}`, `artist:${ar}`]);
    }
    const perMonth = new Array(N).fill(0);
    artistFirst.forEach((m) => { if (m < N) perMonth[m]++; });
    let nm = -1;
    for (let m = Math.max(a, 1); m <= b; m++) if (nm < 0 || perMonth[m] > perMonth[nm]) nm = m; // month 0 is everything you'd heard before
    if (nm >= 0 && perMonth[nm] > 0 && b > a) tiles.push(['Most new artists in a month', plural(perMonth[nm], 'new artist'), mLab(nm), `month:${nm}`]);
    card.querySelector('.rec-tiles').innerHTML = tiles.map(([l, v, sub, act]) =>
      `<button type="button" data-rec="${act}"><span>${l}</span><b>${esc(v)}</b><small>${esc(sub)}</small></button>`).join('');
    // milestones passed in this period
    const { list, next } = milestones();
    const lo = monthDay[a], hi = monthDay[b + 1] - 1;
    const mine = list.filter((x) => x.at >= lo && x.at <= hi).slice(-8);
    card.querySelector('.rec-miles').innerHTML = (mine.map((x) => `<li><b>${x.label}</b><small class="muted">${x.when}</small></li>`).join('')
      + (next && b === N - 1 ? `<li class="next" title="At the pace of your last 12 months"><span>${next.label}</span><small>${next.when}</small></li>` : ''))
      || '<li class="next"><span>No round numbers passed in this period.</span></li>';
  }

  // ---------- year by year ----------
  function yearTable() {
    if (S.ytab) return S.ytab;
    const by = new Map(years.map((y) => [y, { y, sec: 0, plays: 0, skips: 0, tp: 0, songs: new Map(), fresh: 0 }]));
    for (let i = 0; i < R.length; i += W) {
      const m = R[i + 1], e = by.get(monthYear[m]);
      e.sec += R[i + 3]; e.plays += R[i + 2];
      if (tracked[m]) { e.tp += R[i + 2]; e.skips += R[i + 4] || 0; }
      e.songs.set(R[i], (e.songs.get(R[i]) || 0) + R[i + 3]);
    }
    artistFirst.forEach((m) => { if (m > 0 && m < N) by.get(monthYear[m]).fresh++; });
    const YA = new Map(yearArtists().map((Y) => [Y.y, Y]));
    const out = years.map((y) => {
      const e = by.get(y), Y = YA.get(y), [a, b] = yearRange(y);
      let topSong = -1, best = 0;
      for (const [sng, sec] of e.songs) if (sec > best) { best = sec; topSong = sng; }
      const days = monthDay[b + 1] - monthDay[a];
      return {
        y, a, b, sec: e.sec, plays: e.plays, perDay: e.sec / days, part: b - a + 1 < 12, fresh: a === 0 ? null : e.fresh,
        skip: e.tp ? e.skips / e.tp : null, nSongs: e.songs.size, topSong,
        topArtist: Y?.top[0] ?? -1, topShare: Y && Y.top.length ? Y.m.get(Y.top[0]) / Y.total : 0,
        top10: Y ? Y.top.reduce((t, ar) => t + Y.m.get(ar), 0) / Y.total : 0,
      };
    });
    return (S.ytab = out.reverse());
  }
  function renderYearTable() {
    const card = show('yearsCard', years.length > 1);
    if (years.length < 2) return;
    const rows = yearTable(), max = Math.max(...rows.map((r) => r.sec), 1);
    const span = (r) => (r.part ? `<small class="muted">${mShort(r.a)}–${mShort(r.b)}</small>` : '');
    card.querySelector('thead').innerHTML = `<tr><th>Year</th><th>Listening</th><th class="num">A day</th><th>Top artist</th><th>Top song</th>
      <th class="num" title="Different songs played">Songs</th><th class="num" title="Artists you played for the first time">New artists</th>
      <th class="num" title="Share of the year's listening that went to its 10 biggest artists">Top 10 share</th><th class="num">Skipped</th></tr>`;
    card.querySelector('tbody').innerHTML = rows.map((r) => `<tr data-year="${r.y}" class="${r.part ? 'part' : ''}${sameRange(state.range, [r.a, r.b]) ? ' on' : ''}" tabindex="0">
      <td class="yr-y">${r.y}${span(r)}</td>
      <td class="yr-h"><span>${hours(r.sec)}</span><i style="width:${((r.sec / max) * 90).toFixed(1)}px"></i></td>
      <td class="num">${hm(r.perDay)}</td>
      <td>${r.topArtist >= 0 ? `${esc(D.artists[r.topArtist])} <small>${pct(r.topShare)}</small>` : '—'}</td>
      <td>${r.topSong >= 0 ? `${esc(D.songs[r.topSong][0])} <small>${esc(D.artists[artistOf(r.topSong)])}</small>` : '—'}</td>
      <td class="num">${num(r.nSongs)}</td>
      <td class="num">${r.fresh === null ? '—' : num(r.fresh)}</td>
      <td class="num">${pct(r.top10)}</td>
      <td class="num">${r.skip === null ? '—' : pct(r.skip)}</td></tr>`).join('');
    $('yearsNote').textContent = `Each year side by side. Click a year to look at just that year, on every page${rows.some((r) => r.part) ? '; lighter bars are part years' : ''}.`;
  }

  // ---------- your week: day of week x hour ----------
  const DAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  function renderRhythm() {
    const card = show('rhythmCard', !!DD);
    if (!DD) return;
    const [d0, d1] = dayRange(state.range);
    const acc = Array.from({ length: 7 }, () => new Float64Array(24)), wdN = new Array(7).fill(0), wdSec = new Array(7).fill(0);
    for (let d = d0; d <= d1; d++) {
      const w = (dayDate(d).getUTCDay() + 6) % 7; // Monday = 0
      wdN[w]++; wdSec[w] += DD.sec[d];
      for (let j = 0; j < SLOTS; j++) { const v = slotMin[d * SLOTS + j]; if (v) acc[w][Math.floor((j * DD.slotMin) / 60)] += v; }
    }
    let max = 0, peak = [0, 0], total = 0, night = 0;
    const byHour = new Float64Array(24);
    acc.forEach((row, w) => row.forEach((v, h) => {
      const avg = wdN[w] ? v / wdN[w] : 0;
      row[h] = avg; total += v; byHour[h] += v; if (h < 6) night += v;
      if (avg > max) { max = avg; peak = [w, h]; }
    }));
    if (!(max > 0)) { card.hidden = true; return; }
    const hourName = (h) => clockLabel(h * 60), hourSpan = (h) => `${hourName(h)}–${hourName((h + 1) % 24)}`;
    let html = '<span></span>' + [0, 6, 12, 18].map((h) => `<span class="rh-h" style="grid-column: span 6">${hourName(h)}</span>`).join('');
    acc.forEach((row, w) => {
      html += `<span class="rh-d">${DAYS[w]}</span>`;
      row.forEach((v, h) => {
        html += `<i class="rh-c"${v >= 0.05 ? ` style="background:rgba(var(--heat), ${(0.1 + 0.9 * (v / max)).toFixed(3)})"` : ''} data-tip="${esc(`<b>${DAY_NAMES[w]}, ${hourSpan(h)}</b><br>${v >= 0.5 ? `${Math.round(v)} min on average` : v > 0 ? 'under a minute on average' : 'No listening'}`)}"></i>`;
      });
    });
    $('rhythm').innerHTML = html;
    $('rhythmMax').textContent = `${Math.round(max)} min an hour`;
    const avgDay = (ws) => { const n = ws.reduce((t, w) => t + wdN[w], 0); return n ? ws.reduce((t, w) => t + wdSec[w], 0) / n : 0; };
    let topHour = 0; byHour.forEach((v, h) => { if (v > byHour[topHour]) topHour = h; });
    $('rhythmNote').innerHTML = `Busiest: <b>${DAY_NAMES[peak[0]]}, ${hourSpan(peak[1])}</b> · most listening overall around <b>${hourName(topHour)}</b>`
      + ` · weekdays ${hm(avgDay([0, 1, 2, 3, 4]))} a day, weekends ${hm(avgDay([5, 6]))} · ${pct(night / total)} of it between midnight and 6am`;
  }

  // ---------- comebacks & forgotten favorites ----------
  function comebacks() {
    if (S.back) return S.back;
    const out = [];
    songRows().forEach((rows, s) => {
      let before = 0, best = null;
      for (let i = 0; i < rows.length; i++) {
        const gap = i ? rows[i][0] - rows[i - 1][0] - 1 : 0;
        if (gap >= 12 && before >= 8) {
          let soon = 0, since = 0;
          for (let j = i; j < rows.length; j++) { since += rows[j][1]; if (rows[j][0] - rows[i][0] < 6) soon += rows[j][1]; }
          if (soon >= 10 && (!best || soon > best.soon)) best = { s, at: rows[i][0], gap, before, soon, since };
        }
        before += rows[i][1];
      }
      if (best) out.push(best);
    });
    return (S.back = out.sort((x, y) => y.soon - x.soon));
  }
  const away = (months) => (months < 24 ? `${months} months` : `${(months / 12).toFixed(1).replace(/\.0$/, '')} years`);
  function renderComebacks() {
    const [a, b] = state.range, long = N > 15;
    const back = show('backCard', long), lost = show('lostCard', long);
    if (!long) return;
    const list = comebacks().filter((c) => c.at >= a && c.at <= b).slice(0, 7);
    back.querySelector('.back-list').innerHTML = list.map((c) => `<li data-song="${c.s}"><span><span>${songName(c.s)}</span>
        <span class="sub">back in ${mLab(c.at)} after ${away(c.gap)} away</span></span><small class="muted">${plural(c.since, 'play')} since</small></li>`).join('')
      || '<li class="muted small">No comebacks in this period.</li>';
    const gone = [];
    for (const [s, v] of agg.songs) if (v[0] >= 15 && songLast[s] < N - 12) gone.push([s, v[0]]);
    gone.sort((x, y) => y[1] - x[1]);
    lost.querySelector('.lost-note').textContent = `Your most-played songs ${isAll() ? '' : 'of this period '}that you haven't played once in the last 12 months.`;
    lost.querySelector('.lost-list').innerHTML = gone.slice(0, 7).map(([s, plays]) => `<li data-song="${s}"><span><span>${songName(s)}</span>
        <span class="sub">last played ${mLab(songLast[s])}</span></span><small class="muted">${plural(plays, 'play')}</small></li>`).join('')
      || '<li class="muted small">None: you still play your favorites from this period.</li>';
  }

  // ---------- interactions ----------
  const ids = ['agoCard', 'obsCard', 'driftCard', 'discCard', 'streakCard', 'lenCard', 'loyalCard', 'grewCard', 'pickCard', 'recCard', 'yearsCard', 'rhythmCard', 'backCard', 'lostCard'];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    tooltip(el, '[data-tip]', (t) => t.dataset.tip);
    el.addEventListener('click', (e) => {
      const y = e.target.closest('[data-year]');
      if (y && id === 'driftCard') { driftYear = y.dataset.year; renderDrift(); return; }
      if (y && id === 'yearsCard') { setRange(sameRange(state.range, yearRange(y.dataset.year)) ? [0, N - 1] : yearRange(y.dataset.year)); return; }
      const rec = e.target.closest('[data-rec]');
      if (rec) {
        const [kind, v] = rec.dataset.rec.split(':');
        if (kind === 'go') goSection(v);
        else if (kind === 'month') setRange([+v, +v]);
        else if (kind === 'song') librarySearch(D.songs[+v][0]);
        else if (kind === 'artist') libraryArtistFresh(+v);
        return;
      }
      const s = e.target.closest('[data-song]'), a = e.target.closest('[data-artist]');
      if (s) librarySearch(D.songs[+s.dataset.song][0]);
      else if (a) libraryArtistFresh(+a.dataset.artist);
    });
  }
  $('yearsCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr[data-year]')) e.target.click(); });
  window.renderStories = () => {
    renderRecords(); renderAgo(); renderYearTable(); renderRhythm();
    renderObsessions(); renderDrift(); renderDiscovery(); renderStreaks(); renderLength(); renderLoyalty(); renderGrew(); renderComebacks(); renderPick();
  };
  window.renderStories();
  window.refreshSideLinks?.();
})();
