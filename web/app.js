// Spotify Stats — plain JS, no build step. Data comes from data.js (made by build.py).
const D = window.SPOTIFY;
const $ = (id) => document.getElementById(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- formatting ----------
const num = (n) => Math.round(n).toLocaleString();
const hours = (s) => {
  const h = s / 3600;
  return h >= 100 ? `${num(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
};
const pct = (x) => `${Math.round(x * 100)}%`;
const monthLabel = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- one pass over the raw rows ----------
// rows is flat, W numbers per row: song, month, plays, seconds, skips,
// then (if present) measured plays, heard sum, measured skips, heard-before-skip sum (heard in thousandths).
const R = D.rows;
const W = D.cols || 5;
const HAS_RET = W >= 9;
const nSongs = D.songs.length;
const monthYear = D.months.map((m) => m.slice(0, 4));
const years = [...new Set(monthYear)];
const monthTotals = D.months.map(() => ({ sec: 0, plays: 0, skips: 0, artist: new Map() }));
const songFirst = new Int32Array(nSongs).fill(1e9);
const artistFirst = new Int32Array(D.artists.length).fill(1e9);
const songMonths = Array.from({ length: nSongs }, () => []); // [month, seconds] pairs, for sparklines

for (let i = 0; i < R.length; i += W) {
  const s = R[i], m = R[i + 1], sec = R[i + 3];
  const a = D.songs[s][1];
  const t = monthTotals[m];
  t.sec += sec;
  t.plays += R[i + 2];
  t.skips += R[i + 4];
  t.artist.set(a, (t.artist.get(a) || 0) + sec);
  if (m < songFirst[s]) songFirst[s] = m;
  if (m < artistFirst[a]) artistFirst[a] = m;
  songMonths[s].push(m, sec);
}
monthTotals.forEach((t) => {
  let best = -1, bestSec = 0;
  t.artist.forEach((sec, a) => { if (sec > bestSec) { best = a; bestSec = sec; } });
  t.top = best;
  delete t.artist;
});
// Spotify didn't record skips for every month (none before Oct 2022 in the old export).
// A month counts as "tracked" if it has any skips; skip rates only use plays from tracked months.
const tracked = monthTotals.map((t) => t.skips > 0);
const firstTracked = tracked.indexOf(true);
const NO_SKIP_DATA = firstTracked > 0 ? `No skip data before ${monthLabel(D.months[firstTracked])}` : 'No skip data';

// ---------- state ----------
const N = D.months.length;
// range = [first month index, last month index], inclusive
const state = { range: [0, N - 1] };
const yearRange = (y) => [monthYear.indexOf(y), monthYear.lastIndexOf(y)];
const sameRange = (a, b) => a[0] === b[0] && a[1] === b[1];
const isAll = () => sameRange(state.range, [0, N - 1]);

// Aggregate songs and artists for months a..b.
function aggregate([from, to]) {
  const songs = new Map(); // song -> [plays, sec, skips, mPlays, heard, mSkips, skipHeard, trackedPlays]
  const artists = new Map(); // artist -> [plays, sec]
  const T = [0, 0, 0, 0, 0, 0, 0, 0]; // same fields, all songs
  for (let i = 0; i < R.length; i += W) {
    const m = R[i + 1];
    if (m < from || m > to) continue;
    const s = R[i];
    let v = songs.get(s);
    if (!v) songs.set(s, v = [0, 0, 0, 0, 0, 0, 0, 0]);
    for (let f = 0; f < 7; f++) { const x = f + 2 < W ? R[i + 2 + f] : 0; v[f] += x; T[f] += x; }
    if (tracked[m]) { v[7] += R[i + 2]; T[7] += R[i + 2]; }
    const a = D.songs[s][1];
    const w = artists.get(a);
    if (w) { w[0] += R[i + 2]; w[1] += R[i + 3]; } else artists.set(a, [R[i + 2], R[i + 3]]);
  }
  const hist = new Array(10).fill(0);
  for (const [key, h] of Object.entries(D.skipHist || {})) {
    const m = D.months.indexOf(key);
    if (m >= from && m <= to) h.forEach((c, b) => { hist[b] += c; });
  }
  return {
    songs, artists, hist, plays: T[0], sec: T[1], skips: T[2],
    skipRate: T[7] ? T[2] / T[7] : null,                // skips per play, tracked months only
    retention: T[3] ? T[4] / T[3] / 1000 : null,       // avg share of a song heard, per play
    skipPoint: T[5] ? T[6] / T[5] / 1000 : null,       // avg share heard before skipping
  };
}

let agg, prevAgg;

// ---------- render: year buttons ----------
function renderYears() {
  const opts = ['all', ...years];
  $('years').innerHTML = opts.map((y) =>
    `<button data-year="${y}" aria-pressed="${sameRange(state.range, y === 'all' ? [0, N - 1] : yearRange(y))}">${y === 'all' ? 'All time' : y}</button>`).join('');
}
$('years').addEventListener('click', (e) => {
  const y = e.target.dataset?.year;
  if (y) setRange(y === 'all' ? [0, N - 1] : yearRange(y));
});

// The period right before the selection, same length — what the tiles compare against.
function prevRange([a, b]) {
  const len = b - a + 1;
  return a - len >= 0 ? [a - len, a - 1] : null;
}
function rangeLabel([a, b]) {
  if (a === 0 && b === N - 1) return 'All time';
  const y = monthYear[a];
  if (sameRange([a, b], yearRange(y))) return y;
  if (a === b) return monthLabel(D.months[a]);
  return `${monthLabel(D.months[a])} – ${monthLabel(D.months[b])}`;
}
const monthsCount = ([a, b]) => { const n = b - a + 1; return `${n} month${n > 1 ? 's' : ''}`; };

function setRange(r, { full = true } = {}) {
  state.range = r;
  agg = aggregate(r);
  const p = isAll() ? null : prevRange(r);
  prevAgg = p ? aggregate(p) : null;
  if (!full) { renderTiles(); renderSelection(); return; } // cheap live update while dragging
  L.shown = 50;
  L.open = null;
  renderAll();
}

// ---------- render: tiles ----------
function renderTiles() {
  const [from, to] = state.range;
  const isYear = !isAll();
  let newArtists = 0, newSongs = 0;
  if (isYear) {
    agg.artists.forEach((_, a) => { if (artistFirst[a] >= from) newArtists++; });
    agg.songs.forEach((_, s) => { if (songFirst[s] >= from) newSongs++; });
  }
  const prevName = () => {
    const p = prevRange(state.range);
    return sameRange(p, yearRange(monthYear[p[0]])) || p[0] === p[1] ? rangeLabel(p) : `previous ${monthsCount(p)}`;
  };
  const delta = (cur, prev) => {
    if (from === 0) return 'start of your history';
    if (!prevAgg) return 'no earlier period this long';
    if (!prev) return 'nothing in the period before';
    const d = (cur - prev) / prev;
    return `${d >= 0 ? '+' : '−'}${pct(Math.abs(d))} vs ${prevName()}`;
  };
  const newText = (n) => from === 0 ? 'since you started' : `${num(n)} new in this period`;
  const tiles = [
    ['Listening time', hours(agg.sec), isYear ? delta(agg.sec, prevAgg?.sec) : `${num(agg.sec / 86400)} days of music`],
    ['Plays', num(agg.plays), isYear ? delta(agg.plays, prevAgg?.plays) : `${num(agg.plays / N)} a month`],
    ['Songs', num(agg.songs.size), isYear ? newText(newSongs) : 'different tracks'],
    ['Artists', num(agg.artists.size), isYear ? newText(newArtists) : 'different artists'],
    agg.skipRate != null ? ['Skip rate', pct(agg.skipRate), agg.skipPoint != null ? `skips come ${pct(agg.skipPoint)} into a song` : `${num(agg.skips)} skips`]
      : ['Skip rate', '—', NO_SKIP_DATA.replace('No skip data', 'not recorded')],
    agg.retention != null ? ['Retention', pct(agg.retention), 'of each song heard, on average']
      : ['Retention', '—', HAS_RET ? 'not in the data for this period' : 'run build.py to add this'],
  ];
  $('tiles').innerHTML = tiles.map(([l, v, s]) =>
    `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
}

// ---------- render: monthly timeline ----------
function niceStep(max) {
  if (!(max > 0)) return 1;
  const raw = max / 3, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= raw);
}
function renderTimeline() {
  const hrs = monthTotals.map((t) => t.sec / 3600);
  const step = niceStep(Math.max(...hrs));
  const top = Math.ceil(Math.max(...hrs) / step) * step;
  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<div class="grid" style="bottom:${(v / top) * 100}%"><span>${num(v)} h</span></div>`;
  }
  const bars = D.months.map((m, i) => {
    const showYear = m.endsWith('-01') || i === 0;
    return `<div class="bar" data-i="${i}">` +
      `<i style="height:${(hrs[i] / top) * 100}%"></i>${showYear ? `<b>${m.slice(0, 4)}</b>` : ''}</div>`;
  }).join('');
  $('timeline').innerHTML = grid + `<div class="sel" id="sel"></div><div class="bars">${bars}</div>`;
  renderSelection();
}

// Highlight the selected months and update the label above the chart.
function renderSelection() {
  const [a, b] = state.range;
  document.querySelectorAll('#timeline .bar').forEach((el, i) => el.classList.toggle('on', i >= a && i <= b));
  const sel = $('sel');
  sel.hidden = isAll();
  sel.style.left = `${(a / N) * 100}%`;
  sel.style.width = `${((b - a + 1) / N) * 100}%`;
  $('selLabel').textContent = isAll() ? `All time · ${monthsCount(state.range)}` : `${rangeLabel(state.range)} · ${monthsCount(state.range)}`;
  $('selReset').hidden = isAll();
  for (const el of document.querySelectorAll('.period')) el.textContent = rangeLabel(state.range);
}

// Drag across the chart to pick months; a plain click picks one month.
let drag = null, dragFrame = 0;
const monthAt = (x) => {
  const r = $('timeline').querySelector('.bars').getBoundingClientRect();
  return Math.max(0, Math.min(N - 1, Math.floor(((x - r.left) / r.width) * N)));
};
$('timeline').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const i = monthAt(e.clientX);
  drag = { start: i, last: i, before: state.range };
  $('timeline').setPointerCapture(e.pointerId);
  $('timeline').classList.add('dragging');
  $('tip').hidden = true;
  setRange([i, i], { full: false });
  e.preventDefault();
});
$('timeline').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const i = monthAt(e.clientX);
  if (i === drag.last) return;
  drag.last = i;
  cancelAnimationFrame(dragFrame);
  dragFrame = requestAnimationFrame(() => setRange([Math.min(drag.start, i), Math.max(drag.start, i)], { full: false }));
});
function endDrag(e) {
  if (!drag) return;
  cancelAnimationFrame(dragFrame);
  const { start, last, before } = drag;
  drag = null;
  $('timeline').classList.remove('dragging');
  // pointercancel = the browser took over (e.g. scrolling the page on a phone): put the old selection back.
  setRange(e.type === 'pointercancel' ? before : [Math.min(start, last), Math.max(start, last)]);
}
$('timeline').addEventListener('pointerup', endDrag);
$('timeline').addEventListener('pointercancel', endDrag);
$('selReset').addEventListener('click', () => setRange([0, N - 1]));

tooltip($('timeline'), '.bar', (el) => {
  if (drag) return null;
  const i = +el.dataset.i, t = monthTotals[i];
  return `<b>${monthLabel(D.months[i])}</b><br>${hours(t.sec)} · ${num(t.plays)} plays` +
    (t.top >= 0 ? `<br>Top artist: ${esc(D.artists[t.top])}` : '');
});

// ---------- render: top lists ----------
function renderTop() {
  const artists = [...agg.artists].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12);
  const maxA = artists[0]?.[1][1] || 1;
  $('topArtists').innerHTML = artists.map(([a, [p, sec]], i) =>
    `<li data-a="${a}"><span class="rank">${i + 1}</span>` +
    `<span class="name">${esc(D.artists[a])}</span><span class="val">${hours(sec)}</span>` +
    `<span></span><span class="track"><i style="width:${(sec / maxA) * 100}%"></i></span></li>`).join('');

  const songs = [...agg.songs].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12);
  const maxS = songs[0]?.[1][1] || 1;
  $('topSongs').innerHTML = songs.map(([s, [p, sec]], i) => {
    const [name, a] = D.songs[s];
    return `<li data-q="${esc(name)}"><span class="rank">${i + 1}</span>` +
      `<span class="name">${esc(name)} <small>${esc(D.artists[a])}</small></span><span class="val">${hours(sec)}</span>` +
      `<span></span><span class="track"><i style="width:${(sec / maxS) * 100}%"></i></span></li>`;
  }).join('');
}
$('topArtists').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-a]');
  if (li) libraryArtistFresh(+li.dataset.a);
});
$('topSongs').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-q]');
  if (li) librarySearch(li.dataset.q);
});

// ---------- render: skips ----------
function renderSkips() {
  const total = agg.hist.reduce((a, b) => a + b, 0);
  $('skipCard').hidden = !HAS_RET;
  if (!HAS_RET) return;
  $('skipNote').textContent = total
    ? `${num(total)} skips, by how much of the song you'd heard.` + (D.estimated ? ' Estimated from monthly totals.' : '')
    : 'No skip data for this period.';
  const max = Math.max(1, ...agg.hist);
  $('skipHist').innerHTML = agg.hist.map((c, b) =>
    `<div class="hbar" data-b="${b}" data-c="${c}"><i style="height:${(c / max) * 100}%"></i>${b % 2 ? '' : `<b>${b * 10}%</b>`}</div>`).join('') +
    '<b class="hend">100%</b>';

  // Most-skipped: songs played 5+ times in the period, by number of skips.
  const list = [...agg.songs].filter(([, v]) => v[7] >= 5 && v[2] > 0)
    .sort((a, b) => b[1][2] - a[1][2] || b[1][2] / b[1][7] - a[1][2] / a[1][7]).slice(0, 8);
  $('mostSkipped').innerHTML = list.length ? list.map(([s, v], i) => {
    const [name, a] = D.songs[s];
    const at = v[5] ? `, ${pct(v[6] / v[5] / 1000)} in` : '';
    return `<li data-q="${esc(name)}"><span class="rank">${i + 1}</span>` +
      `<span class="name">${esc(name)} <small>${esc(D.artists[a])}</small></span>` +
      `<span class="val">${num(v[2])} of ${num(v[7])}${at}</span></li>`;
  }).join('') : '<li class="muted small">Nothing skipped much here.</li>';
}
tooltip($('skipHist'), '.hbar', (el) => {
  const b = +el.dataset.b, total = agg.hist.reduce((x, y) => x + y, 0) || 1;
  return `<b>Skipped ${b * 10}–${b * 10 + 10}% in</b><br>${num(+el.dataset.c)} skips · ${pct(+el.dataset.c / total)} of all skips`;
});
$('mostSkipped').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-q]');
  if (li) librarySearch(li.dataset.q);
});

// ---------- render: heatmap ----------
function renderHeat() {
  if (!D.heat) return;
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const [from, to] = state.range;
  for (const [key, g] of Object.entries(D.heat)) {
    const m = D.months.indexOf(key);
    if (m < from || m > to) continue;
    g.forEach((row, d) => row.forEach((v, h) => { grid[d][h] += v; }));
  }
  const max = Math.max(1, ...grid.flat());
  let html = '<span></span>';
  for (let h = 0; h < 24; h++) html += `<span class="hr">${h % 3 === 0 ? (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p') : ''}</span>`;
  grid.forEach((row, d) => {
    html += `<span class="day">${DAYS[d]}</span>`;
    row.forEach((v, h) => {
      const a = 0.06 + 0.94 * (v / max);
      html += `<span class="cell" data-d="${d}" data-h="${h}" data-v="${v}" style="background:rgba(var(--heat),${a.toFixed(3)})"></span>`;
    });
  });
  $('heat').innerHTML = html;
  $('heatCard').hidden = false;
}
tooltip($('heat'), '.cell', (el) => {
  const h = +el.dataset.h, fmt = (x) => `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`;
  return `<b>${DAYS[el.dataset.d]} ${fmt(h)}–${fmt((h + 1) % 24)}</b><br>${hours(+el.dataset.v)}`;
});

// ---------- library: songs / artists / albums table ----------
// Per-song all-time facts for the detail view.
const songLast = new Int32Array(nSongs).fill(-1);
const songAllSec = new Float64Array(nSongs), songAllPlays = new Float64Array(nSongs);
const artistSongs = Array.from({ length: D.artists.length }, () => []);
const albumKey = (s) => `${D.songs[s][1]}|${D.songs[s][2]}`;
const albumSongs = new Map();
const hay = D.songs.map(([name, a, album]) => `${name}\n${D.artists[a]}\n${album}`.toLowerCase());
for (let i = 0; i < R.length; i += W) {
  const s = R[i], m = R[i + 1];
  if (m > songLast[s]) songLast[s] = m;
  songAllSec[s] += R[i + 3];
  songAllPlays[s] += R[i + 2];
}
const artistLast = new Int32Array(D.artists.length).fill(-1);
const albumFirst = new Map(), albumLast = new Map();
D.songs.forEach(([, a], s) => {
  artistSongs[a].push(s);
  const k = albumKey(s);
  if (!albumSongs.has(k)) albumSongs.set(k, []);
  albumSongs.get(k).push(s);
  artistLast[a] = Math.max(artistLast[a], songLast[s]);
  albumFirst.set(k, Math.min(albumFirst.get(k) ?? 1e9, songFirst[s]));
  albumLast.set(k, Math.max(albumLast.get(k) ?? -1, songLast[s]));
});

// ---------- library filters (the Filters popup) ----------
// Every range is [min, max]; null means "no limit". Percentages are 0–100, time is in minutes.
const blankFilters = () => ({
  plays: [null, null], time: [null, null], skips: [null, null], songs: [null, null],
  skip: [null, null], heard: [null, null], first: [null, null], last: [null, null],
  newOnly: false, songText: '', artistText: '', albumText: '', exclude: '',
});
const RANGES = [
  { k: 'plays', label: 'Plays', kind: 'num', get: (r) => r.plays, fmt: (v) => num(v) },
  { k: 'time', label: 'Listening time', kind: 'time', get: (r) => r.sec / 60, fmt: (v) => hours(v * 60) },
  { k: 'skips', label: 'Skips', kind: 'num', get: (r) => r.skips, fmt: (v) => num(v) },
  { k: 'songs', label: 'Songs', kind: 'num', get: (r) => r.songs, fmt: (v) => num(v), views: ['artists', 'albums'] },
  { k: 'skip', label: 'Skip rate', kind: 'pct', get: (r) => (r.skip < 0 ? null : r.skip * 100), fmt: (v) => `${Math.round(v)}%` },
  { k: 'heard', label: 'Avg heard', kind: 'pct', get: (r) => (r.heard < 0 ? null : r.heard * 100), fmt: (v) => `${Math.round(v)}%`, needsRet: true },
  { k: 'first', label: 'First played', kind: 'month', get: (r) => r.first, fmt: (v) => monthLabel(D.months[v]) },
  { k: 'last', label: 'Last played', kind: 'month', get: (r) => r.last, fmt: (v) => monthLabel(D.months[v]) },
];
const TEXTS = [
  { k: 'songText', label: 'Song title has', get: (r) => r.songName, views: ['songs'] },
  { k: 'artistText', label: 'Artist has', get: (r) => r.artist },
  { k: 'albumText', label: 'Album has', get: (r) => r.album, views: ['songs', 'albums'] },
  { k: 'exclude', label: 'Leave out', get: null },
];
const PRESETS = [
  ['✦ New this period', { newOnly: true }],
  ['♥ Loved', { plays: [3, null], heard: [90, null] }],
  ['💎 Hidden gems', { plays: [2, 6], heard: [90, null] }],
  ['⤼ Often skipped', { plays: [3, null], skip: [40, null] }],
  ['🔁 On repeat', { plays: [30, null] }],
  ['① Played once', { plays: [1, 1] }],
];
const rangeOn = (v) => v[0] !== null || v[1] !== null;
const fieldVisible = (f) => (!f.views || f.views.includes(L.view)) && (!f.needsRet || HAS_RET);

const ordered = ([lo, hi]) => (lo !== null && hi !== null && lo > hi ? [hi, lo] : [lo, hi]);
function describeRange(f, range) {
  const [lo, hi] = ordered(range);
  if (lo !== null && hi !== null) return lo === hi ? `${f.label} = ${f.fmt(lo)}` : `${f.label} ${f.fmt(lo)}–${f.fmt(hi)}`;
  if (f.kind === 'month') return lo !== null ? `${f.label} since ${f.fmt(lo)}` : `${f.label} by ${f.fmt(hi)}`;
  return lo !== null ? `${f.label} ≥ ${f.fmt(lo)}` : `${f.label} ≤ ${f.fmt(hi)}`;
}

// Active filters as [key, label] pairs, for chips and the badge.
function activeFilters() {
  const F = L.f, out = [];
  if (F.newOnly && state.range[0] > 0) out.push(['newOnly', 'New this period']);
  for (const f of RANGES) if (fieldVisible(f) && rangeOn(F[f.k])) out.push([f.k, describeRange(f, F[f.k])]);
  for (const t of TEXTS) {
    if (!F[t.k] || (t.views && !t.views.includes(L.view))) continue;
    out.push([t.k, t.k === 'exclude' ? `Leaving out “${F[t.k]}”` : `${t.label.replace(' has', '')}: “${F[t.k]}”`]);
  }
  return out;
}

function passesFilters(r) {
  const F = L.f;
  if (F.newOnly && state.range[0] > 0 && r.first < state.range[0]) return false;
  for (const f of RANGES) {
    const [lo, hi] = ordered(F[f.k]);
    if ((lo === null && hi === null) || !fieldVisible(f)) continue;
    const v = f.get(r);
    if (v === null || (lo !== null && v < lo - 1e-9) || (hi !== null && v > hi + 1e-9)) return false;
  }
  for (const t of TEXTS) {
    const q = F[t.k].trim().toLowerCase();
    if (!q || (t.views && !t.views.includes(L.view))) continue;
    if (t.k === 'exclude') {
      const h = `${r.name}\n${r.artist}\n${r.album || ''}`.toLowerCase();
      if (q.split(/[\s,]+/).filter(Boolean).some((w) => h.includes(w))) return false;
    } else {
      const v = (t.get(r) || '').toLowerCase();
      if (!q.split(/\s+/).every((w) => v.includes(w))) return false;
    }
  }
  return true;
}

// ----- saved presets (this browser only) -----
const PRESET_KEY = 'spotifyStats.filterPresets';
function loadSaved() { try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || []; } catch { return []; } }
function storeSaved(list) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { /* storage off */ } }

// ----- panel UI -----
const monthOptions = (sel) => `<option value="">Any</option>` +
  D.months.map((m, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');

function rangeRow(f) {
  const [lo, hi] = L.f[f.k];
  if (f.kind === 'month') {
    return `<div class="frow" data-field="${f.k}"><label>${f.label}</label>
      <div class="fin"><select data-end="0">${monthOptions(lo)}</select><span class="to">to</span><select data-end="1">${monthOptions(hi)}</select></div></div>`;
  }
  if (f.kind === 'pct') {
    const a = lo ?? 0, b = hi ?? 100;
    return `<div class="frow" data-field="${f.k}"><label>${f.label}</label>
      <div class="fin pct">
        <div class="dual" style="--a:${a};--b:${b}"><div class="fill"></div>
          <input type="range" min="0" max="100" step="1" value="${a}" data-end="0" aria-label="${f.label} minimum">
          <input type="range" min="0" max="100" step="1" value="${b}" data-end="1" aria-label="${f.label} maximum"></div>
        <span class="pctnums"><input type="number" min="0" max="100" value="${lo ?? ''}" placeholder="0" data-end="0" data-num>%
          <span class="to">–</span><input type="number" min="0" max="100" value="${hi ?? ''}" placeholder="100" data-end="1" data-num>%</span>
      </div></div>`;
  }
  const unit = f.kind === 'time' ? L.timeUnit : '';
  const shown = (v) => (v === null ? '' : unit === 'h' ? +(v / 60).toFixed(2) : +v.toFixed(2));
  return `<div class="frow" data-field="${f.k}"><label>${f.label}</label>
    <div class="fin"><input type="number" min="0" step="any" placeholder="Min" value="${shown(lo)}" data-end="0" data-num>
      <span class="to">to</span><input type="number" min="0" step="any" placeholder="Max" value="${shown(hi)}" data-end="1" data-num>
      ${f.kind === 'time' ? `<span class="unit seg"><button data-unit="min" aria-pressed="${unit === 'min'}">min</button><button data-unit="h" aria-pressed="${unit === 'h'}">hrs</button></span>` : ''}
    </div></div>`;
}

function renderPanel() {
  const F = L.f, saved = loadSaved();
  const same = (p) => JSON.stringify(Object.assign(blankFilters(), p)) === JSON.stringify(F);
  const noun = { songs: 'songs', artists: 'artists', albums: 'albums' }[L.view];
  const vis = RANGES.filter(fieldVisible);
  $('filterPanel').innerHTML = `
    <div class="fp-head"><b>Filter ${noun}</b><button class="fp-x" data-act="close" aria-label="Close">×</button></div>
    <div class="fp-body">
      <section><h3>Presets</h3><div class="presets">
        ${PRESETS.map(([name], i) => {
          const why = i === 0 && state.range[0] === 0 ? 'Pick a period on the chart first'
            : 'heard' in PRESETS[i][1] && !HAS_RET ? 'Needs retention data (run build.py)' : '';
          return `<button data-preset="${i}" aria-pressed="${same(PRESETS[i][1])}" ${why ? `disabled title="${why}"` : ''}>${name}</button>`;
        }).join('')}
        ${saved.map((p, i) => `<span class="saved"><button data-saved="${i}" aria-pressed="${same(p.f)}">★ ${esc(p.name)}</button><button class="del" data-del="${i}" aria-label="Delete ${esc(p.name)}">×</button></span>`).join('')}
      </div></section>
      <section><h3>Numbers</h3>${vis.filter((f) => f.kind === 'num' || f.kind === 'time').map(rangeRow).join('')}</section>
      <section><h3>Percentages</h3>${vis.filter((f) => f.kind === 'pct').map(rangeRow).join('')}</section>
      <section><h3>Dates</h3>${vis.filter((f) => f.kind === 'month').map(rangeRow).join('')}
        <label class="check ${state.range[0] === 0 ? 'off' : ''}"><input type="checkbox" data-check="newOnly" ${F.newOnly ? 'checked' : ''} ${state.range[0] === 0 ? 'disabled' : ''}>
          Only ${noun} first played in the selected period${state.range[0] === 0 ? ' <small>(pick a period on the chart)</small>' : ''}</label></section>
      <section><h3>Text</h3>${TEXTS.filter((t) => !t.views || t.views.includes(L.view)).map((t) =>
        `<div class="frow"><label>${t.label}</label><div class="fin"><input type="text" data-text="${t.k}" value="${esc(F[t.k])}"
          placeholder="${t.k === 'exclude' ? 'words to hide, e.g. remix, live' : 'any words'}" spellcheck="false"></div></div>`).join('')}</section>
    </div>
    <div class="fp-foot">
      <button class="linkish" data-act="reset">Reset all</button>
      <button class="linkish" data-act="save">Save as preset…</button>
      <span class="fp-count" id="fpCount"></span>
      <button class="primary" data-act="close">Done</button>
    </div>`;
  updatePanelCount();
}
function updatePanelCount() {
  const el = $('fpCount');
  if (el) el.textContent = `${num(lastList.length)} ${{ songs: 'song', artists: 'artist', albums: 'album' }[L.view]}${lastList.length === 1 ? '' : 's'} match`;
}

function openPanel(open = !$('filterPanel').classList.contains('open')) {
  $('filterPanel').classList.toggle('open', open);
  $('filterBtn').setAttribute('aria-expanded', open);
  if (open) {
    renderPanel();
    if (innerWidth > 760) requestAnimationFrame(() => $('filterPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
}

// Apply changes from the panel without re-rendering it (so typing isn't interrupted).
let panelTimer;
function applyFromPanel(immediate) {
  clearTimeout(panelTimer);
  const go = () => { L.shown = 50; L.open = null; renderTable(); updatePanelCount(); };
  immediate ? go() : (panelTimer = setTimeout(go, 150));
}

const panel = $('filterPanel');
panel.addEventListener('input', (e) => {
  const t = e.target, row = t.closest('[data-field]');
  if (t.dataset.text) { L.f[t.dataset.text] = t.value; return applyFromPanel(); }
  if (!row) return;
  const f = RANGES.find((x) => x.k === row.dataset.field), end = +t.dataset.end, r = [...L.f[f.k]];
  if (f.kind === 'pct') {
    let v = t.value === '' ? null : Math.max(0, Math.min(100, +t.value));
    if (t.type === 'range' && ((end === 0 && v === 0) || (end === 1 && v === 100))) v = null;
    r[end] = v;
    if (r[0] !== null && r[1] !== null && r[0] > r[1]) r[end ? 0 : 1] = r[end]; // keep handles in order
    const dual = row.querySelector('.dual'), nums = row.querySelectorAll('[data-num]'), ranges = row.querySelectorAll('input[type=range]');
    dual.style.setProperty('--a', r[0] ?? 0); dual.style.setProperty('--b', r[1] ?? 100);
    ranges[0].value = r[0] ?? 0; ranges[1].value = r[1] ?? 100;
    nums.forEach((n, j) => { if (n !== t) n.value = r[j] ?? ''; });
  } else if (f.kind === 'month') {
    r[end] = t.value === '' ? null : +t.value;
  } else {
    const v = t.value === '' ? null : Math.max(0, +t.value);
    r[end] = v === null ? null : f.kind === 'time' && L.timeUnit === 'h' ? v * 60 : v;
  }
  L.f[f.k] = r;
  applyFromPanel(t.type === 'range' || f.kind === 'month');
});
panel.addEventListener('change', (e) => {
  if (e.target.dataset.check) { L.f[e.target.dataset.check] = e.target.checked; applyFromPanel(true); }
});
panel.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.unit) { L.timeUnit = b.dataset.unit; renderPanel(); return; }
  if (b.dataset.preset) { L.f = Object.assign(blankFilters(), structuredClone(PRESETS[+b.dataset.preset][1])); renderTable(); renderPanel(); return; }
  if (b.dataset.saved) { L.f = Object.assign(blankFilters(), structuredClone(loadSaved()[+b.dataset.saved].f)); renderTable(); renderPanel(); return; }
  if (b.dataset.del) { const s = loadSaved(); s.splice(+b.dataset.del, 1); storeSaved(s); renderPanel(); return; }
  const act = b.dataset.act;
  if (act === 'close') openPanel(false);
  if (act === 'reset') { L.f = blankFilters(); renderTable(); renderPanel(); }
  if (act === 'save') {
    if (!activeFilters().length) { b.textContent = 'Set some filters first'; setTimeout(() => { b.textContent = 'Save as preset…'; }, 1500); return; }
    const foot = panel.querySelector('.fp-foot');
    foot.innerHTML = `<input type="text" id="presetName" placeholder="Preset name" maxlength="40">
      <button class="linkish" data-act="cancelSave">Cancel</button><button class="primary" data-act="doSave">Save</button>`;
    $('presetName').focus();
  }
  if (act === 'cancelSave') renderPanel();
  if (act === 'doSave') {
    const name = $('presetName').value.trim() || activeFilters().map(([, l]) => l).join(', ').slice(0, 40);
    storeSaved([...loadSaved(), { name, f: structuredClone(L.f) }]);
    renderPanel();
  }
});
panel.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'presetName') panel.querySelector('[data-act="doSave"]').click();
  if (e.key === 'Escape') { openPanel(false); $('filterBtn').focus(); }
});
$('filterBtn').addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
document.addEventListener('pointerdown', (e) => {
  if (panel.classList.contains('open') && !panel.contains(e.target) && !$('filterBtn').contains(e.target)) openPanel(false);
});

const L = {
  view: 'songs', q: '', artist: null, album: null, f: blankFilters(), timeUnit: 'min',
  sort: 'sec', dir: -1, shown: 50, open: null,
};

// Monthly seconds for a list of songs (cached), used by sparklines and the detail chart.
const seriesCache = new Map();
function series(key, songList) {
  if (seriesCache.has(key)) return seriesCache.get(key);
  const v = new Float64Array(N);
  for (const s of songList) { const p = songMonths[s]; for (let i = 0; i < p.length; i += 2) v[p[i]] += p[i + 1]; }
  seriesCache.set(key, v);
  return v;
}

// Build rows for the current view from the selected period's totals.
function libraryRows() {
  const songsRows = [];
  for (const [s, v] of agg.songs) {
    const [name, a, album] = D.songs[s];
    songsRows.push({
      id: s, kind: 'song', name, songName: name, sub: album, artist: D.artists[a], a, album, songs: 1, last: songLast[s],
      plays: v[0], sec: v[1], skips: v[2], tp: v[7], skip: v[7] ? v[2] / v[7] : -1, mp: v[3], heardSum: v[4],
      heard: v[3] ? v[4] / v[3] / 1000 : -1, first: songFirst[s],
    });
  }
  if (L.view === 'songs') return songsRows;
  const groups = new Map();
  for (const r of songsRows) {
    const key = L.view === 'artists' ? r.a : albumKey(r.id);
    let g = groups.get(key);
    if (!g) {
      g = L.view === 'artists'
        ? { id: key, kind: 'artist', name: r.artist, sub: '', artist: r.artist, a: r.a, first: artistFirst[r.a], last: artistLast[r.a] }
        : { id: key, kind: 'album', name: r.album || '(no album)', sub: r.artist, artist: r.artist, a: r.a, album: r.album, first: albumFirst.get(key), last: albumLast.get(key) };
      Object.assign(g, { songs: 0, plays: 0, sec: 0, skips: 0, tp: 0, mp: 0, heardSum: 0 });
      groups.set(key, g);
    }
    g.songs++; g.plays += r.plays; g.sec += r.sec; g.skips += r.skips; g.tp += r.tp; g.mp += r.mp; g.heardSum += r.heardSum;
  }
  return [...groups.values()].map((g) => Object.assign(g, { skip: g.tp ? g.skips / g.tp : -1, heard: g.mp ? g.heardSum / g.mp / 1000 : -1 }));
}

const tokens = () => L.q.toLowerCase().split(/\s+/).filter(Boolean);
function filterRows(rows) {
  const toks = tokens();
  return rows.filter((r) => {
    if (L.artist !== null && r.a !== L.artist) return false;
    if (L.album !== null && (r.kind === 'artist' ? r.a !== +L.album.split('|')[0] : `${r.a}|${r.album}` !== L.album)) return false;
    if (!passesFilters(r)) return false;
    if (toks.length) {
      const h = r.kind === 'song' ? hay[r.id] : `${r.name}\n${r.sub}`.toLowerCase();
      for (const t of toks) if (!h.includes(t)) return false;
    }
    return true;
  });
}

// Wrap search matches in <mark>.
// Split the raw text on matches and escape each piece, so a search like "amp" can't touch "&amp;".
function hl(text) {
  const toks = tokens();
  if (!toks.length) return esc(text);
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(text).split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

const COLS = {
  songs: [['rank', '#'], ['name', 'Song'], ['artist', 'Artist', 'opt'], ['plays', 'Plays', 'num'], ['sec', 'Time', 'num'],
    ['skip', 'Skipped', 'num opt'], ['heard', 'Avg heard', 'num opt'], ['first', 'First played', 'num opt'], ['trend', 'Over time', 'opt']],
  artists: [['rank', '#'], ['name', 'Artist'], ['songs', 'Songs', 'num'], ['plays', 'Plays', 'num'], ['sec', 'Time', 'num'],
    ['skip', 'Skipped', 'num opt'], ['heard', 'Avg heard', 'num opt'], ['first', 'First played', 'num opt'], ['trend', 'Over time', 'opt']],
  albums: [['rank', '#'], ['name', 'Album'], ['songs', 'Songs', 'num'], ['plays', 'Plays', 'num'], ['sec', 'Time', 'num'],
    ['skip', 'Skipped', 'num opt'], ['heard', 'Avg heard', 'num opt'], ['first', 'First played', 'num opt'], ['trend', 'Over time', 'opt']],
};
const cols = () => COLS[L.view].filter(([k]) => HAS_RET || k !== 'heard');

function sparkline(v, w = 110, h = 26) {
  const max = Math.max(...v) || 1, [a, b] = state.range;
  let d = '';
  const span = Math.max(1, N - 1);
  for (let i = 0; i < N; i++) d += `${i ? 'L' : 'M'}${((i / span) * w).toFixed(1)},${(h - 1.5 - (v[i] / max) * (h - 4)).toFixed(1)}`;
  const band = isAll() ? '' : `<rect x="${(a / span) * w - 1}" width="${Math.max(2, ((b - a) / span) * w + 2)}" height="${h}" rx="2"/>`;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${band}<path d="${d}"/></svg>`;
}
const meter = (x) => x < 0 ? '<span class="muted">—</span>'
  : `<span class="meter"><span><i style="width:${x * 100}%"></i></span>${pct(x)}</span>`;

function seriesFor(r) {
  return r.kind === 'song' ? series(`s${r.id}`, [r.id])
    : r.kind === 'artist' ? series(`a${r.id}`, artistSongs[r.id]) : series(`l${r.id}`, albumSongs.get(r.id));
}

function cell(k, r, i, maxSec) {
  switch (k) {
    case 'rank': return `<td class="rank">${i + 1}</td>`;
    case 'name': {
      const sub = r.kind === 'song' ? `<span class="sub"><span class="m-only">${hl(r.artist)}${r.sub ? ' · ' : ''}</span>` +
        (r.sub ? `<a data-album="${esc(`${r.a}|${r.album}`)}">${hl(r.sub)}</a>` : '') + '</span>'
        : r.kind === 'album' ? `<span class="sub">${hl(r.sub)}</span>` : '';
      return `<td class="title"><div class="t">${hl(r.name)}</div>${sub}</td>`;
    }
    case 'artist': return `<td class="opt"><a data-artist="${r.a}">${hl(r.artist)}</a></td>`;
    case 'songs': return `<td class="num">${num(r.songs)}</td>`;
    case 'plays': return `<td class="num">${num(r.plays)}</td>`;
    case 'sec': return `<td class="num timecell">${hours(r.sec)}<span class="cellbar"><i style="width:${(r.sec / maxSec) * 100}%"></i></span></td>`;
    case 'skip': return `<td class="num opt">${r.skip < 0 ? `<span class="muted" title="${NO_SKIP_DATA}">—</span>` : pct(r.skip)}</td>`;
    case 'heard': return `<td class="num opt">${meter(r.heard)}</td>`;
    case 'first': return `<td class="num opt">${monthLabel(D.months[r.first])}</td>`;
    case 'trend': return `<td class="trend opt">${sparkline(seriesFor(r))}</td>`;
  }
}

// Expanded row for a song: its whole history.
function detail(r) {
  const v = seriesFor(r), max = Math.max(...v) || 1, [a, b] = state.range;
  let peak = 0;
  v.forEach((x, i) => { if (x > v[peak]) peak = i; });
  const w = 600, h = 70, bw = w / N;
  const bars = [...v].map((x, i) => `<rect class="${i >= a && i <= b ? 'on' : ''}" x="${(i * bw + 0.5).toFixed(1)}" y="${(h - (x / max) * h).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${((x / max) * h).toFixed(1)}"><title>${monthLabel(D.months[i])}: ${hours(x)}</title></rect>`).join('');
  const s = r.id;
  const facts = [
    ['First played', monthLabel(D.months[songFirst[s]])],
    ['Last played', monthLabel(D.months[songLast[s]])],
    ['Peak month', `${monthLabel(D.months[peak])} · ${hours(v[peak])}`],
    ['All time', `${num(songAllPlays[s])} plays · ${hours(songAllSec[s])}`],
  ];
  return `<tr class="detail"><td colspan="${cols().length}"><div class="detail-in">
    <div class="facts">${facts.map(([l, x]) => `<div><span>${l}</span><b>${x}</b></div>`).join('')}</div>
    <svg class="dchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}</svg>
    <div class="dchart-axis"><span>${D.months[0].slice(0, 4)}</span><span>${D.months[N - 1].slice(0, 4)}</span></div>
    <div class="actions">
      <button data-artist="${r.a}">All songs by ${esc(r.artist)}</button>
      ${r.album ? `<button data-album="${esc(`${r.a}|${r.album}`)}">Album: ${esc(r.album)}</button>` : ''}
    </div></div></td></tr>`;
}

let lastList = [];
function renderTable() {
  // controls reflect state
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === L.view));
  $('search').placeholder = `Search ${L.view}…`;

  // chips: one per active filter, each removable
  const active = activeFilters();
  const chips = [];
  if (L.artist !== null) chips.push(['artist', `Artist: ${D.artists[L.artist]}`]);
  if (L.album !== null) chips.push(['album', `Album: ${L.album.split('|').slice(1).join('|') || '(no album)'}`]);
  if (L.q) chips.push(['q', `“${L.q}”`]);
  chips.push(...active);
  $('filterBadge').textContent = active.length || '';
  $('filterBadge').hidden = !active.length;
  $('filterBtn').classList.toggle('has', active.length > 0);
  $('chips').innerHTML = chips.map(([k, t]) => `<button class="chip" data-clear="${k}">${esc(t)} <span aria-hidden="true">×</span></button>`).join('') +
    (chips.length > 1 ? '<button class="chip-clear" data-clear="all">Clear all</button>' : '');
  $('chips').hidden = !chips.length;

  // rows
  let list = filterRows(libraryRows());
  const k = L.sort === 'rank' ? 'sec' : L.sort, dir = L.sort === 'rank' ? -1 : L.dir;
  list.sort((x, y) => {
    const a = x[k], b = y[k];
    if ((k === 'heard' || k === 'skip') && (a < 0 || b < 0)) return (a < 0) - (b < 0) || y.sec - x.sec; // unknown always last
    const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
    return c * dir || y.sec - x.sec;
  });
  lastList = list;

  // summary for everything that matches
  let plays = 0, sec = 0, skips = 0, tp = 0;
  for (const r of list) { plays += r.plays; sec += r.sec; skips += r.skips; tp += r.tp; }
  const noun = { songs: 'song', artists: 'artist', albums: 'album' }[L.view];
  $('libSummary').innerHTML = !list.length ? 'No matches' : [
    `<b>${num(list.length)}</b> ${noun}${list.length === 1 ? '' : 's'}`,
    `<b>${hours(sec)}</b>`, `<b>${num(plays)}</b> plays`,
    tp ? `<b>${pct(skips / tp)}</b> skipped` : '',
  ].filter(Boolean).join('<span class="dot">·</span>');

  // table
  const C = cols();
  $('thead').innerHTML = C.map(([key, label, cls = '']) => {
    const on = L.sort === key && key !== 'trend';
    return `<th data-k="${key}" class="${cls} ${on ? 'sorted' : ''}">${label}${on && key !== 'rank' ? `<span class="arrow">${L.dir < 0 ? '↓' : '↑'}</span>` : ''}</th>`;
  }).join('');
  const maxSec = list.reduce((m, r) => Math.max(m, r.sec), 1);
  $('tbody').innerHTML = list.length ? list.slice(0, L.shown).map((r, i) => {
    const open = r.kind === 'song' && L.open === r.id;
    return `<tr class="row ${open ? 'open' : ''}" data-i="${i}">${C.map(([key]) => cell(key, r, i, maxSec)).join('')}</tr>` + (open ? detail(r) : '');
  }).join('') : `<tr><td colspan="${C.length}" class="empty">Nothing matches. <button data-clear="all">Clear filters</button></td></tr>`;
  $('count').textContent = list.length ? `Showing ${num(Math.min(L.shown, list.length))} of ${num(list.length)}` : '';
  $('more').hidden = L.shown >= list.length;
  updatePanelCount();
}

function setLib(patch) {
  Object.assign(L, { shown: 50, open: null }, patch);
  renderTable();
  if ('view' in patch && panel.classList.contains('open')) renderPanel();
}
function libraryFocus() { $('library').scrollIntoView({ behavior: 'smooth' }); }
// Jumps from elsewhere on the page clear the library filters, so the thing you clicked is always shown.
function librarySearch(text) { $('search').value = text; setLib({ q: text, view: 'songs', artist: null, album: null, f: blankFilters() }); libraryFocus(); }
function libraryArtistFresh(a) { $('search').value = ''; setLib({ artist: a, album: null, q: '', view: 'songs', f: blankFilters() }); libraryFocus(); }
function libraryArtist(a) { $('search').value = ''; setLib({ artist: a, album: null, q: '', view: 'songs' }); libraryFocus(); }
function libraryAlbum(key) { $('search').value = ''; setLib({ album: key, artist: null, q: '', view: 'songs' }); libraryFocus(); }

// controls
$('views').addEventListener('click', (e) => {
  const v = e.target.dataset?.view;
  if (!v) return;
  const keep = COLS[v].some(([k]) => k === L.sort) && L.sort !== 'name';
  setLib({ view: v, sort: keep ? L.sort : 'sec', dir: keep ? L.dir : -1 });
});
let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setLib({ q: e.target.value.trim() }), 120);
});
$('search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; setLib({ q: '' }); e.target.blur(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('search').focus(); }
});
$('library').addEventListener('click', (e) => {
  const t = e.target.closest('[data-clear],[data-artist],[data-album],th,tr.row');
  if (!t) return;
  if (t.dataset.clear) {
    const k = t.dataset.clear;
    if (k === 'all') { $('search').value = ''; setLib({ q: '', artist: null, album: null, f: blankFilters() }); }
    else if (k === 'q') { $('search').value = ''; setLib({ q: '' }); }
    else if (k === 'artist' || k === 'album') setLib({ [k]: null });
    else {
      const blank = blankFilters();
      L.f[k] = blank[k];
      setLib({});
    }
    if (panel.classList.contains('open')) renderPanel();
  } else if (t.dataset.artist) {
    libraryArtist(+t.dataset.artist);
  } else if (t.dataset.album) {
    libraryAlbum(t.dataset.album);
  } else if (t.tagName === 'TH') {
    const k = t.dataset.k;
    if (k === 'trend') return;
    if (k === 'rank') { L.sort = 'sec'; L.dir = -1; renderTable(); return; }
    const asc = k === 'name' || k === 'artist' || k === 'first';
    L.dir = L.sort === k ? -L.dir : (asc ? 1 : -1);
    L.sort = k;
    renderTable();
  } else {
    const r = lastList[+t.dataset.i];
    if (!r) return;
    if (r.kind === 'artist') libraryArtist(r.id);
    else if (r.kind === 'album') libraryAlbum(r.id);
    else { L.open = L.open === r.id ? null : r.id; renderTable(); }
  }
});
$('more').addEventListener('click', () => { L.shown += 100; renderTable(); });
$('csv').addEventListener('click', () => {
  const C = cols().filter(([k]) => k !== 'trend' && k !== 'rank');
  const val = (k, r) => k === 'first' ? D.months[r.first] : k === 'skip' ? (r.skip < 0 ? '' : r.skip.toFixed(3))
    : k === 'heard' ? (r.heard < 0 ? '' : r.heard.toFixed(3)) : k === 'sec' ? (r.sec / 3600).toFixed(2) : r[k];
  const head = C.map(([k, l]) => ({ sec: 'Hours', skip: 'Skip rate', heard: 'Avg heard' }[k] || l));
  const at = L.view === 'songs' ? 2 : 1;
  if (L.view !== 'artists') head.splice(at, 0, L.view === 'songs' ? 'Album' : 'Artist');
  const lines = [head, ...lastList.map((r) => {
    const v = C.map(([k]) => val(k, r));
    if (L.view !== 'artists') v.splice(at, 0, r.sub);
    return v;
  })].map((row) => row.map((x) => {
    let v = String(x ?? '');
    if (typeof x === 'string' && /^[=+\-@\t\r]/.test(v)) v = `'${v}`; // stop spreadsheets running titles as formulas
    return `"${v.replace(/"/g, '""')}"`;
  }).join(','));
  const a = document.createElement('a');
  // BOM so Excel reads it as UTF-8 (otherwise non-English titles come out garbled)
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `spotify-${L.view}-${rangeLabel(state.range).replace(/[^\w]+/g, '-').toLowerCase()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- tooltip helper ----------
function tooltip(root, selector, html) {
  const tip = $('tip');
  root.addEventListener('mousemove', (e) => {
    const el = e.target.closest(selector);
    const content = el && html(el);
    if (!content) { tip.hidden = true; return; }
    tip.innerHTML = content;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
  root.addEventListener('mouseleave', () => { tip.hidden = true; });
}

// ---------- go ----------
function renderAll() {
  renderYears();
  renderTiles();
  renderTimeline();
  renderTop();
  renderSkips();
  renderHeat();
  renderTable();
}
$('range').textContent = `${monthLabel(D.months[0])} – ${monthLabel(D.months.at(-1))} · from your Spotify streaming history`;
setRange([0, N - 1]);
