// Spotify Stats — plain JS, no build step. Data comes from data.js (made by build.py).
const D = window.SPOTIFY;
const $ = (id) => document.getElementById(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- formatting ----------
const num = (n) => Math.round(n).toLocaleString();
const hours = (s) => {
  const h = s / 3600;
  return h >= 100 ? `${num(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(s / 60)} min`;
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
const monthTotals = D.months.map(() => ({ sec: 0, plays: 0, artist: new Map() }));
const songFirst = new Int32Array(nSongs).fill(1e9);
const artistFirst = new Int32Array(D.artists.length).fill(1e9);
const songMonths = Array.from({ length: nSongs }, () => []); // [month, seconds] pairs, for sparklines

for (let i = 0; i < R.length; i += W) {
  const s = R[i], m = R[i + 1], sec = R[i + 3];
  const a = D.songs[s][1];
  const t = monthTotals[m];
  t.sec += sec;
  t.plays += R[i + 2];
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

// ---------- state ----------
const N = D.months.length;
// range = [first month index, last month index], inclusive
const state = { range: [0, N - 1], query: '', sort: 'sec', dir: -1, shown: 50 };
const yearRange = (y) => [monthYear.indexOf(y), monthYear.lastIndexOf(y)];
const sameRange = (a, b) => a[0] === b[0] && a[1] === b[1];
const isAll = () => sameRange(state.range, [0, N - 1]);

// Aggregate songs and artists for months a..b.
function aggregate([from, to]) {
  const songs = new Map(); // song -> [plays, sec, skips, mPlays, heard, mSkips, skipHeard]
  const artists = new Map(); // artist -> [plays, sec]
  const T = [0, 0, 0, 0, 0, 0, 0]; // same fields, all songs
  for (let i = 0; i < R.length; i += W) {
    const m = R[i + 1];
    if (m < from || m > to) continue;
    const s = R[i];
    let v = songs.get(s);
    if (!v) songs.set(s, v = [0, 0, 0, 0, 0, 0, 0]);
    for (let f = 0; f < 7; f++) { const x = f + 2 < W ? R[i + 2 + f] : 0; v[f] += x; T[f] += x; }
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
  state.shown = 50;
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
    if (!prevAgg || !prev) return from === 0 ? 'start of your history' : '';
    const d = (cur - prev) / prev;
    return `${d >= 0 ? '+' : '−'}${pct(Math.abs(d))} vs ${prevName()}`;
  };
  const newText = (n) => from === 0 ? 'since you started' : `${num(n)} new in this period`;
  const tiles = [
    ['Listening time', hours(agg.sec), isYear ? delta(agg.sec, prevAgg?.sec) : `${num(agg.sec / 86400)} days of music`],
    ['Plays', num(agg.plays), isYear ? delta(agg.plays, prevAgg?.plays) : `${num(agg.plays / N)} a month`],
    ['Songs', num(agg.songs.size), isYear ? newText(newSongs) : 'different tracks'],
    ['Artists', num(agg.artists.size), isYear ? newText(newArtists) : 'different artists'],
    agg.skips ? ['Skip rate', pct(agg.skips / agg.plays), agg.skipPoint != null ? `skips come ${pct(agg.skipPoint)} into a song` : `${num(agg.skips)} skips`]
      : ['Skip rate', '—', 'not in the data for this period'],
    agg.retention != null ? ['Retention', pct(agg.retention), 'of each song heard, on average']
      : ['Retention', '—', HAS_RET ? 'not in the data for this period' : 'run build.py to add this'],
  ];
  $('tiles').innerHTML = tiles.map(([l, v, s]) =>
    `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
}

// ---------- render: monthly timeline ----------
function niceStep(max) {
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
  drag = { start: i, last: i };
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
function endDrag() {
  if (!drag) return;
  cancelAnimationFrame(dragFrame);
  const { start, last } = drag;
  drag = null;
  $('timeline').classList.remove('dragging');
  setRange([Math.min(start, last), Math.max(start, last)]);
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
    `<li data-q="${esc(D.artists[a])}"><span class="rank">${i + 1}</span>` +
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
for (const id of ['topArtists', 'topSongs']) {
  $(id).addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    $('search').value = state.query = li.dataset.q;
    state.shown = 50;
    renderTable();
    $('library').scrollIntoView({ behavior: 'smooth' });
  });
}

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
  const list = [...agg.songs].filter(([, v]) => v[0] >= 5 && v[2] > 0)
    .sort((a, b) => b[1][2] - a[1][2] || b[1][2] / b[1][0] - a[1][2] / a[1][0]).slice(0, 8);
  $('mostSkipped').innerHTML = list.length ? list.map(([s, v], i) => {
    const [name, a] = D.songs[s];
    const at = v[5] ? `, ${pct(v[6] / v[5] / 1000)} in` : '';
    return `<li data-q="${esc(name)}"><span class="rank">${i + 1}</span>` +
      `<span class="name">${esc(name)} <small>${esc(D.artists[a])}</small></span>` +
      `<span class="val">${num(v[2])} of ${num(v[0])}${at}</span></li>`;
  }).join('') : '<li class="muted small">Nothing skipped much here.</li>';
}
tooltip($('skipHist'), '.hbar', (el) => {
  const b = +el.dataset.b, total = agg.hist.reduce((x, y) => x + y, 0) || 1;
  return `<b>Skipped ${b * 10}–${b * 10 + 10}% in</b><br>${num(+el.dataset.c)} skips · ${pct(+el.dataset.c / total)} of all skips`;
});
$('mostSkipped').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-q]');
  if (!li) return;
  $('search').value = state.query = li.dataset.q;
  state.shown = 50;
  renderTable();
  $('library').scrollIntoView({ behavior: 'smooth' });
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

// ---------- render: library table ----------
const COLS = [
  ['name', 'Song', ''], ['artist', 'Artist', ''], ['plays', 'Plays', 'num'], ['sec', 'Time', 'num'],
  ['skip', 'Skip rate', 'num'], ...(HAS_RET ? [['heard', 'Avg heard', 'num']] : []), ['first', 'First played', 'num'], ['trend', 'All-time trend', ''],
];
function renderHead() {
  $('thead').innerHTML = COLS.map(([k, label, cls]) =>
    `<th data-k="${k}" class="${cls}">${label}${state.sort === k ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('');
}
$('thead').addEventListener('click', (e) => {
  const k = e.target.dataset?.k;
  if (!k || k === 'trend') return;
  state.dir = state.sort === k ? -state.dir : (k === 'name' || k === 'artist' || k === 'first' ? 1 : -1);
  state.sort = k;
  renderTable();
});

function sparkline(s) {
  const pts = songMonths[s], n = D.months.length, w = 120, hgt = 22;
  const vals = new Float64Array(n);
  for (let i = 0; i < pts.length; i += 2) vals[pts[i]] += pts[i + 1];
  const max = Math.max(...vals) || 1;
  let d = '';
  for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${((i / (n - 1)) * w).toFixed(1)},${(hgt - 1 - (vals[i] / max) * (hgt - 3)).toFixed(1)}`;
  return `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" aria-hidden="true"><path d="${d}"/></svg>`;
}

function renderTable() {
  renderHead();
  const q = state.query.trim().toLowerCase();
  let list = [...agg.songs].map(([s, [plays, sec, skips, mp, heard]]) => {
    const [name, a, album] = D.songs[s];
    return { s, name, artist: D.artists[a], album, plays, sec, skip: skips / plays, heard: mp ? heard / mp / 1000 : -1, first: songFirst[s] };
  });
  if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q) || r.album.toLowerCase().includes(q));
  const k = state.sort, dir = state.dir;
  list.sort((a, b) => {
    const x = a[k], y = b[k];
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c * dir || b.sec - a.sec;
  });
  $('tbody').innerHTML = list.slice(0, state.shown).map((r) =>
    `<tr><td title="${esc(r.name)} — ${esc(r.album)}">${esc(r.name)}</td>` +
    `<td><a data-q="${esc(r.artist)}">${esc(r.artist)}</a></td>` +
    `<td class="num">${num(r.plays)}</td><td class="num">${hours(r.sec)}</td>` +
    `<td class="num">${pct(r.skip)}</td>` + (HAS_RET ? `<td class="num">${r.heard < 0 ? '—' : pct(r.heard)}</td>` : '') +
    `<td class="num">${monthLabel(D.months[r.first])}</td>` +
    `<td class="trend">${sparkline(r.s)}</td></tr>`).join('');
  $('count').textContent = `Showing ${num(Math.min(state.shown, list.length))} of ${num(list.length)} songs`;
  $('more').hidden = state.shown >= list.length;
}
$('tbody').addEventListener('click', (e) => {
  const q = e.target.dataset?.q;
  if (q) { $('search').value = state.query = q; state.shown = 50; renderTable(); }
});
let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = e.target.value; state.shown = 50; renderTable(); }, 120);
});
$('more').addEventListener('click', () => { state.shown += 100; renderTable(); });

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
