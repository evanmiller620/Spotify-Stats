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
const pct = (x) => {
  const r = Math.round(x * 100);
  return x > 0 && r === 0 ? '<1%' : x < 1 && r === 100 ? '>99%' : `${r}%`; // never round a sliver to 0% or "almost all" to 100%
};
const monthLabel = (m) => `${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
// Hide axis labels that would overlap the one before them (narrow screens).
// If the first label (often a partial year) collides with the second, the first gives way.
function declutter(labels, pad = 6) {
  const els = [...labels];
  els.forEach((el) => { el.style.visibility = ''; });
  const box = els.map((el) => el.getBoundingClientRect());
  if (!box.some((r) => r.width)) return; // not laid out yet
  let start = 0;
  if (box.length > 1 && box[0].right + pad > box[1].left) { els[0].style.visibility = 'hidden'; start = 1; }
  let last = box[start];
  for (let i = start + 1; i < els.length; i++) {
    if (!box[i].width) continue;
    if (last && box[i].left < last.right + pad) els[i].style.visibility = 'hidden';
    else last = box[i];
  }
}
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
  declutter($('timeline').querySelectorAll('.bar b'));
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
  $('jbPeriod').textContent = isAll() ? `All time · ${monthsCount(state.range)}` : `${rangeLabel(state.range)} · ${monthsCount(state.range)}`;
  $('jbReset').hidden = isAll();
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
// Keyboard on the chart: ←/→ move the period, Shift+←/→ make it longer/shorter, Home/End, Esc = all time.
let keyCommit = 0;
$('timeline').addEventListener('keydown', (e) => {
  let [a, b] = state.range;
  const all = isAll(), len = b - a;
  if (e.key === 'Escape') { if (all) return; e.preventDefault(); e.stopPropagation(); setRange([0, N - 1]); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    if (all) [a, b] = d < 0 ? [N - 1, N - 1] : [0, 0];        // start from one month at the end you pressed toward
    else if (e.shiftKey) b = Math.max(a, Math.min(N - 1, b + d)); // grow / shrink
    else { a = Math.max(0, Math.min(N - 1 - len, a + d)); b = a + len; } // slide
  } else if (e.key === 'Home') { a = 0; b = all ? 0 : len; }
  else if (e.key === 'End') { b = N - 1; a = all ? N - 1 : N - 1 - len; }
  else return;
  e.preventDefault();
  setRange([a, b], { full: false });           // quick update while keys are pressed
  clearTimeout(keyCommit);
  keyCommit = setTimeout(() => setRange(state.range), 250); // then redraw everything once
});

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

// ---------- days (from build.py's per-day data) ----------
const DD = D.days || null;
// First day index of each month; days are counted from the 1st of the first month.
const monthDay = [];
{
  let acc = 0;
  for (const m of D.months) {
    monthDay.push(acc);
    const [y, mo] = m.split('-').map(Number);
    acc += new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  monthDay.push(acc);
}
const NDAYS = DD ? DD.sec.length : 0;
const day0ms = DD ? Date.parse(DD.start + 'T00:00:00Z') : 0;
const dayDate = (i) => new Date(day0ms + i * 86400000);
const fmtDay = (i, o = { month: 'short', day: 'numeric', year: 'numeric' }) => dayDate(i).toLocaleDateString(undefined, { timeZone: 'UTC', ...o });
// Days with any listening, so the charts don't run into empty months at either end.
const firstDataDay = DD ? DD.sec.findIndex((s) => s > 0) : 0;
const lastDataDay = DD ? NDAYS - 1 - [...DD.sec].reverse().findIndex((s) => s > 0) : 0;
function dayRange([a, b]) {
  return [Math.max(monthDay[a], firstDataDay), Math.min(monthDay[b + 1] - 1, lastDataDay)];
}
// Minutes per 15-minute slot, decoded once: SLOTS numbers per day.
const SLOTS = DD ? (24 * 60) / DD.slotMin : 96;
const slotMin = DD ? new Uint8Array(NDAYS * SLOTS) : null;
if (DD) DD.slots.forEach((str, d) => { for (let j = 0; j < str.length; j++) slotMin[d * SLOTS + j] = parseInt(str[j], 16); });
const clockLabel = (minOfDay) => {
  const h = Math.floor(minOfDay / 60) % 24, m = minOfDay % 60;
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- histograms for the selected period ----------
// bins: [{ label, value, tip }]; labels sit under each bar.
function drawHist(id, bins, unit) {
  const max = Math.max(1, ...bins.map((b) => b.value));
  const total = bins.reduce((a, b) => a + b.value, 0) || 1;
  $(id).innerHTML = bins.map((b, i) =>
    `<div class="hbar" data-i="${i}" data-tip="${esc(`<b>${b.tip || b.label}</b><br>${num(b.value)} ${unit} · ${pct(b.value / total)}`)}">` +
    `<i style="height:${(b.value / max) * 100}%"></i><b>${b.label}</b></div>`).join('');
}
function bucketIndex(edges, v) { let i = 0; while (i < edges.length && v >= edges[i]) i++; return i; }

function renderDists() {
  const [from, to] = state.range;
  // 1. Daily listening
  if (DD) {
    const [d0, d1] = dayRange(state.range);
    const edges = [1, 15 * 60, 30 * 60, 3600, 7200, 10800, 14400, 21600]; // seconds
    const labels = ['None', '<15m', '15–30m', '½–1h', '1–2h', '2–3h', '3–4h', '4–6h', '6h+'];
    const tips = ['No listening', 'Under 15 minutes', '15–30 minutes', '30–60 minutes', '1–2 hours', '2–3 hours', '3–4 hours', '4–6 hours', '6 hours or more'];
    const counts = new Array(labels.length).fill(0), active = [];
    for (let d = d0; d <= d1; d++) { counts[bucketIndex(edges, DD.sec[d])]++; if (DD.sec[d] > 0) active.push(DD.sec[d]); }
    active.sort((a, b) => a - b);
    const days = Math.max(0, d1 - d0 + 1);
    $('distDaysNote').textContent = days ? `You listened on ${pct(active.length / days)} of ${num(days)} days` +
      (active.length ? ` · a typical listening day was ${hours(active[Math.floor(active.length / 2)])}` : '') : 'No days in this period.';
    drawHist('distDays', labels.map((l, i) => ({ label: l, value: counts[i], tip: tips[i] })), 'days');
  }
  // 2. Plays per song
  {
    const edges = [2, 3, 6, 11, 26, 51, 101];
    const labels = ['1', '2', '3–5', '6–10', '11–25', '26–50', '51–100', '100+'];
    const counts = new Array(labels.length).fill(0);
    for (const v of agg.songs.values()) counts[bucketIndex(edges, v[0])]++;
    const n = agg.songs.size;
    $('distPlaysNote').textContent = n ? `${num(n)} songs · ${pct(counts[0] / n)} played only once` : 'No songs in this period.';
    drawHist('distPlays', labels.map((l, i) => ({ label: l, value: counts[i], tip: `${l} play${l === '1' ? '' : 's'}` })), 'songs');
  }
  // 3. How much of each play you hear
  if (D.playHist) {
    const h = new Array(10).fill(0);
    for (const [key, v] of Object.entries(D.playHist)) {
      const m = D.months.indexOf(key);
      if (m >= from && m <= to) v.forEach((c, b) => { h[b] += c; });
    }
    const n = h.reduce((a, b) => a + b, 0);
    $('distHeardNote').textContent = n ? `${pct(h[9] / n)} of plays reached 90%+ of the song · ${pct((h[0] + h[1]) / n)} stopped in the first 20%` : 'No length data for this period.';
    drawHist('distHeard', h.map((c, b) => ({ label: `${b * 10}%`, value: c, tip: `Heard ${b * 10}–${b * 10 + 10}% of the song` })), 'plays');
  }
  // 4. Length of the songs you play (weighted by plays)
  {
    const edges = [120, 180, 240, 300, 360, 480, 600];
    const labels = ['<2m', '2–3m', '3–4m', '4–5m', '5–6m', '6–8m', '8–10m', '10m+'];
    const counts = new Array(labels.length).fill(0), lens = [];
    for (const [s, v] of agg.songs) {
      const len = D.songs[s][3];
      if (!len) continue;
      counts[bucketIndex(edges, len)] += v[0];
      lens.push([len, v[0]]);
    }
    lens.sort((a, b) => a[0] - b[0]);
    const n = lens.reduce((a, b) => a + b[1], 0);
    let acc = 0, median = 0;
    for (const [len, w] of lens) { acc += w; if (acc >= n / 2) { median = len; break; } }
    $('distLenNote').textContent = n ? `Typical play is a ${Math.floor(median / 60)}:${String(median % 60).padStart(2, '0')} song` : 'No length data for this period.';
    drawHist('distLen', labels.map((l, i) => ({ label: l, value: counts[i], tip: `Songs ${l.replace('m', ' min')}` })), 'plays');
  }
  $('distCards').hidden = false;
  $('distCards2').hidden = !(D.playHist && D.songs[0]?.[3] !== undefined);
}
for (const id of ['distDays', 'distPlays', 'distHeard', 'distLen']) tooltip($(id), '.hbar', (el) => el.dataset.tip);

// ---------- when you listen: date × time of day ----------
let clockCells = null; // for the tooltip: { d0, n, cols, colW, rowH }
function renderClock() {
  if (!DD) { $('clockCard').hidden = true; return; }
  $('clockCard').hidden = false;
  const wrap = $('clockPlot'), canvas = $('clockCanvas');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const [d0, d1] = dayRange(state.range), n = d1 - d0 + 1;
  if (n <= 0) { clockCells = null; $('clockX').innerHTML = ''; return; }
  const cols = Math.min(n, Math.floor(W)), colW = W / cols, rowH = H / SLOTS;
  // average minutes per slot for each column of days
  const vals = new Float32Array(cols * SLOTS);
  for (let c = 0; c < cols; c++) {
    const da = d0 + Math.floor((c * n) / cols), db = Math.max(da, d0 + Math.floor(((c + 1) * n) / cols) - 1);
    for (let d = da; d <= db; d++) for (let j = 0; j < SLOTS; j++) vals[c * SLOTS + j] += slotMin[d * SLOTS + j];
    const k = db - da + 1;
    for (let j = 0; j < SLOTS; j++) vals[c * SLOTS + j] /= k;
  }
  // scale colors to the 95th percentile of non-empty cells, so long and short periods both read well
  const nz = [];
  for (const v of vals) if (v > 0) nz.push(v);
  nz.sort((a, b) => a - b);
  const top = nz.length ? Math.max(nz[Math.floor(nz.length * 0.97)], 0.5) : 1;
  const rgb = cssVar('--heat');
  // faint guide lines every 6 hours
  ctx.fillStyle = cssVar('--line');
  for (let h = 6; h < 24; h += 6) ctx.fillRect(0, Math.round(((h * 60) / DD.slotMin) * rowH), W, 1);
  for (let c = 0; c < cols; c++) {
    for (let j = 0; j < SLOTS; j++) {
      const v = vals[c * SLOTS + j];
      if (v <= 0) continue;
      const t = Math.min(1, v / top);
      ctx.fillStyle = `rgba(${rgb},${(0.08 + 0.92 * t).toFixed(3)})`;
      ctx.fillRect(c * colW, j * rowH, colW + 0.6, rowH + 0.6);
    }
  }
  clockCells = { d0, n, cols, colW, rowH, vals, top };

  // x-axis: day ticks for short periods, months for medium, years for long
  const ticks = [];
  const xAt = (d) => ((d - d0) / n) * W;
  if (n <= 45) {
    const step = n <= 10 ? 1 : n <= 21 ? 3 : 7;
    for (let d = d0; d <= d1; d += step) ticks.push([xAt(d), fmtDay(d, { month: 'short', day: 'numeric' })]);
  } else {
    const years = n > 900;
    const stepM = years ? 12 : n > 400 ? 3 : 1;
    for (let m = 0; m < D.months.length; m++) {
      const d = monthDay[m];
      if (d < d0 || d > d1) continue;
      const mo = +D.months[m].slice(5);
      if (years ? mo !== 1 : (mo - 1) % stepM !== 0) continue;
      ticks.push([xAt(d), years ? D.months[m].slice(0, 4) : `${MONTHS[mo - 1]}${mo === 1 || ticks.length === 0 ? ' ' + D.months[m].slice(0, 4) : ''}`]);
    }
  }
  $('clockX').innerHTML = ticks.map(([x, l]) => `<span style="left:${x}px">${l}</span>`).join('');
  declutter($('clockX').children);
  $('clockNote').textContent = `${fmtDay(d0)} – ${fmtDay(d1)}` +
    (cols < n ? ` · each column is ${(n / cols).toFixed(n / cols < 10 ? 1 : 0)} days, averaged` : ' · one column per day');
  $('clockLegendMax').textContent = `${top < 1 ? top.toFixed(1) : Math.round(top)}+ min`;
}
function clockTip(e) {
  const tip = $('tip');
  if (!clockCells) { tip.hidden = true; return; }
  const r = $('clockPlot').getBoundingClientRect();
  const { d0, n, cols, colW, rowH, vals } = clockCells;
  const c = Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - r.left) / colW)));
  const j = Math.min(SLOTS - 1, Math.max(0, Math.floor((e.clientY - r.top) / rowH)));
  const da = d0 + Math.floor((c * n) / cols), db = Math.max(da, d0 + Math.floor(((c + 1) * n) / cols) - 1);
  const when = da === db ? fmtDay(da, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : `${fmtDay(da)} – ${fmtDay(db)}`;
  const v = vals[c * SLOTS + j];
  const t0 = j * DD.slotMin;
  placeTip(`<b>${when}</b><br>${clockLabel(t0)}–${clockLabel(t0 + DD.slotMin)}: ` +
    (v > 0 ? `${da === db ? '' : 'avg '}${v < 1 ? '<1' : Math.round(v)} min listening` : 'nothing played'), e);
}
$('clockPlot').addEventListener('mousemove', (e) => { if (!fromTouch()) clockTip(e); });
$('clockPlot').addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { lastTouch = performance.now(); clockTip(e); tipTouched = true; tipScrollY = scrollY; } });
$('clockPlot').addEventListener('mouseleave', () => { if (!fromTouch()) $('tip').hidden = true; });

// ---------- retention over time ----------
// Time-weighted: total time heard ÷ total length of the songs you started, per week or month.
// Hours of listening weight it naturally, so a stray play or two can't swing a point.
let retBuckets = [];
function renderRetention() {
  if (!DD) { $('retCard').hidden = true; return; }
  $('retCard').hidden = false;
  const [d0, d1] = dayRange(state.range), n = d1 - d0 + 1;
  const buckets = [];
  const add = (a, b, label) => {
    let heard = 0, len = 0, sec = 0;
    for (let d = Math.max(a, d0); d <= Math.min(b, d1); d++) { heard += DD.heard[d]; len += DD.len[d]; sec += DD.sec[d]; }
    buckets.push({ a: Math.max(a, d0), b: Math.min(b, d1), label, heard, len, sec, ret: len ? heard / len : null });
  };
  let unit;
  if (n <= 0) unit = 'none';
  else if (n <= 31) { unit = 'day'; for (let d = d0; d <= d1; d++) add(d, d, fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' })); }
  else if (n <= 200) { unit = 'week'; for (let d = d0; d <= d1; d += 7) add(d, d + 6, `Week of ${fmtDay(d)}`); }
  else {
    unit = 'month';
    for (let m = state.range[0]; m <= state.range[1]; m++) if (monthDay[m + 1] - 1 >= d0 && monthDay[m] <= d1) add(monthDay[m], monthDay[m + 1] - 1, monthLabel(D.months[m]));
  }
  retBuckets = buckets;
  const svg = $('retChart'), W = svg.clientWidth || svg.parentElement.clientWidth;
  const H = 278, top = 10, plotH = 170, gap = 28, stripH = 44, left = 36, right = 58;
  const pw = W - left - right;
  const ok = buckets.filter((b) => b.ret !== null);
  if (!ok.length || pw <= 0) { svg.innerHTML = ''; $('retNote').textContent = 'No length data for this period.'; return; }
  const secs = ok.map((b) => b.sec).sort((a, b) => a - b), median = secs[Math.floor(secs.length / 2)];
  const low = (b) => b.sec < median * 0.25; // light weeks/months: shown hollow
  const solid = ok.filter((b) => !low(b));
  const rs = ok.map((b) => b.ret * 100);
  let lo = Math.max(0, Math.floor((Math.min(...rs) - 4) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...rs) + 4) / 5) * 5);
  if (hi - lo < 10) { lo = Math.max(0, lo - 5); hi = Math.min(100, hi + 5); }
  const step = hi - lo > 50 ? 20 : hi - lo > 20 ? 10 : 5;
  const x = (i) => left + (buckets.length === 1 ? pw / 2 : (i / (buckets.length - 1)) * pw);
  const y = (r) => top + plotH - ((Math.min(hi, Math.max(lo, r * 100)) - lo) / (hi - lo)) * plotH;
  const overall = buckets.reduce((a, b) => a + b.heard, 0) / buckets.reduce((a, b) => a + b.len, 0);
  const maxSec = Math.max(...buckets.map((b) => b.sec)) || 1;
  let g = '';
  for (let v = lo; v <= hi; v += step) g += `<line class="grid" x1="${left}" x2="${W - right}" y1="${y(v / 100)}" y2="${y(v / 100)}"/><text class="ylab" x="${left - 6}" y="${y(v / 100) + 4}">${v}%</text>`;
  g += `<line class="avg" x1="${left}" x2="${W - right}" y1="${y(overall)}" y2="${y(overall)}"/>` +
    `<text class="avglab" x="${W - right + 6}" y="${y(overall) + 4}">avg ${pct(overall)}</text>`;
  // line through buckets that have data
  let path = '', pen = false;
  buckets.forEach((b, i) => {
    if (b.ret === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.ret).toFixed(1)}`; pen = true;
  });
  g += `<path class="line" d="${path}"/>`;
  buckets.forEach((b, i) => {
    if (b.ret === null) return;
    const room = buckets.length > 1 ? pw / (buckets.length - 1) : 20; // shrink dots when points are tightly packed
    const r = Math.max(1.2, Math.min(2 + 2.5 * Math.sqrt(b.sec / maxSec), room * 0.45));
    g += `<circle class="${low(b) ? 'pt low' : 'pt'}" cx="${x(i).toFixed(1)}" cy="${y(b.ret).toFixed(1)}" r="${r.toFixed(1)}"/>`;
  });
  // listening-time strip on the same x-axis
  const sy = top + plotH + gap, bw = Math.max(1, Math.min(18, (pw / buckets.length) * 0.7));
  g += `<text class="striplab" x="${left}" y="${sy - 8}">Listening time</text>`;
  buckets.forEach((b, i) => {
    const h = (b.sec / maxSec) * stripH;
    g += `<rect class="sbar" x="${(x(i) - bw / 2).toFixed(1)}" y="${(sy + stripH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" rx="1"/>`;
  });
  // hover targets
  const hw = buckets.length === 1 ? pw : pw / (buckets.length - 1);
  buckets.forEach((b, i) => { g += `<rect class="hit" data-i="${i}" x="${(x(i) - hw / 2).toFixed(1)}" y="0" width="${hw.toFixed(1)}" height="${H}"/>`; });
  // x labels: a tick per year for long monthly spans, otherwise first, middle, last
  if (unit === 'month' && buckets.length > 24) {
    buckets.forEach((b, i) => { if (b.label.startsWith('Jan ')) g += `<text class="xlab" text-anchor="middle" x="${x(i)}" y="${H - 2}">${b.label.slice(4)}</text>`; });
  } else if (unit === 'month' && buckets.length > 2) {
    buckets.forEach((b, i) => { g += `<text class="xlab" text-anchor="middle" x="${x(i)}" y="${H - 2}">${b.label.slice(0, 3)}${i === 0 || b.label.startsWith('Jan ') ? ' ' + b.label.slice(4) : ''}</text>`; });
  } else {
    const xl = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
    g += xl.map((i, k) => `<text class="xlab" text-anchor="${k === 0 ? 'start' : k === xl.length - 1 ? 'end' : 'middle'}" x="${x(i)}" y="${H - 2}">${esc(buckets[i].label.replace('Week of ', ''))}</text>`).join('');
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', H);
  svg.innerHTML = g;
  declutter(svg.querySelectorAll('.xlab'));
  const best = solid.length ? solid.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
  const worst = solid.length ? solid.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
  $('retNote').textContent = `One point per ${unit} · overall ${pct(overall)}` +
    (best && best !== worst ? ` · highest ${pct(best.ret)} (${best.label.replace('Week of ', 'week of ')}), lowest ${pct(worst.ret)} (${worst.label.replace('Week of ', 'week of ')})` : '');
}
tooltip($('retChart'), '.hit', (el) => {
  const b = retBuckets[+el.dataset.i];
  if (!b) return null;
  return `<b>${esc(b.label)}</b><br>` + (b.ret === null ? 'No length data' : `${pct(b.ret)} of song time heard`) + `<br>${hours(b.sec)} listened`;
});

// Re-draw the canvas/SVG charts when their width changes.
if (window.ResizeObserver) {
  let rz = 0, lastW = 0;
  new ResizeObserver(() => {
    const w = $('clockPlot').clientWidth;
    if (w === lastW) return;
    lastW = w;
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { declutter($('timeline').querySelectorAll('.bar b')); renderClock(); renderRetention(); if (TOP.view === 'lines') renderRank(); else drawRace(TOP.t, true); renderNew(); renderCalendar(); });
  }).observe($('clockPlot'));
}
// Colors come from CSS, so redraw the canvas when the light/dark theme flips.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderClock());

// ---------- new charts: artists over time, new vs familiar, calendar, how you listen ----------
const svgEl = (w, h, inner, label) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
const widthOf = (id) => Math.max(280, Math.floor($(id).clientWidth || $(id).parentElement.clientWidth || 600));

// ----- Top over time: an animated race or rank lines, for artists / songs / albums by time / plays / skips -----
const TOP = { view: 'race', entity: 'artists', metric: 'sec', mode: 'rolling', useFilters: false, t: 0, frame: 0, playing: false, speed: 700 };
const TOP_METRICS = {
  sec: { label: 'listening time', off: 3, fmt: (v) => hours(v) },
  plays: { label: 'plays', off: 2, fmt: (v) => `${num(v)} plays` },
  skips: { label: 'skips', off: 4, fmt: (v) => `${num(v)} skips` },
};
const TOP_ENT = {
  artists: { one: 'artist', key: (s) => D.songs[s][1], name: (k) => D.artists[k], sub: () => '' },
  songs: { one: 'song', key: (s) => s, name: (k) => D.songs[k][0], sub: (k) => D.artists[D.songs[k][1]] },
  albums: { one: 'album', key: (s) => albumKey(s), name: (k) => k.slice(k.indexOf('|') + 1) || '(no album)', sub: (k) => D.artists[+k.slice(0, k.indexOf('|'))] },
};
const RANK_N = 6, RANK_MAX = 10, RACE_N = 8; // 8 bars = 8 distinct colors, so neighbours rarely match

// Which items are allowed: everything, or only what passes the library's search & filters (for this period).
function topAllowed() {
  if (!TOP.useFilters) return null;
  const saved = L.view;
  L.view = TOP.entity;
  try { return new Set(filterRows(libraryRows()).map((r) => r.id)); } finally { L.view = saved; }
}
const libFilterCount = () => activeFilters().length + (L.q ? 1 : 0) + (L.artist !== null ? 1 : 0) + (L.album !== null ? 1 : 0);

// Per month in [a, b]: Map(item -> value of the chosen metric).
function topMonthly(a, b, allowed) {
  const off = TOP_METRICS[TOP.metric].off, key = TOP_ENT[TOP.entity].key;
  const per = [];
  for (let m = a; m <= b; m++) per.push(new Map());
  for (let i = 0; i < R.length; i += W) {
    const m = R[i + 1];
    if (m < a || m > b) continue;
    const v = R[i + off];
    if (!v) continue;
    const k = key(R[i]);
    if (allowed && !allowed.has(k)) continue;
    const mp = per[m - a];
    mp.set(k, (mp.get(k) || 0) + v);
  }
  return per;
}
function topK(map, n) { // the n largest entries, without sorting the whole map
  const out = [];
  for (const [k, v] of map) {
    if (v <= 0 || (out.length === n && v <= out[n - 1][1])) continue;
    let i = out.length;
    while (i > 0 && out[i - 1][1] < v) i--;
    out.splice(i, 0, [k, v]);
    if (out.length > n) out.pop();
  }
  return out;
}

// ----- the race -----
// Monthly totals are the keyframes; playback runs on a continuous clock (TOP.t, in months) and blends
// between neighbouring months, so values count up smoothly and bars glide when they swap places.
let race = null; // { frames: top 8 per month, full: top 24 per month (Map), floor, a, frameColors }
const raceNodes = new Map(); // key -> { el, y, op, col }
const RACE_KEEP = 24;        // values kept per month, so a bar entering the top 8 can grow from its real value
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function buildRace() {
  const [a, b] = state.range;
  const per = topMonthly(a, b, topAllowed());
  const run = new Map(), frames = [], full = [], floor = [], colors = new Map(), useCount = new Array(8).fill(0), lastSeen = new Map();
  const frameColors = []; // color of each bar, per month (an item can get a new color after a long absence)
  for (let f = 0; f < per.length; f++) {
    for (const [k, v] of per[f]) run.set(k, (run.get(k) || 0) + v);
    if (TOP.mode === 'rolling' && f >= 12) for (const [k, v] of per[f - 12]) { const r = run.get(k) - v; if (r > 0) run.set(k, r); else run.delete(k); }
    const wide = topK(run, RACE_KEEP), top = wide.slice(0, RACE_N);
    full.push(new Map(wide));
    floor.push(wide.length === RACE_KEEP ? wide.at(-1)[1] : 0); // anything not kept is at most this
    // a newcomer gets a color nobody else on screen has (fewest-used if all 8 are taken); it keeps it while it's
    // around, and gives it up after 6 months off screen
    for (const [k] of top) if (colors.has(k) && f - lastSeen.get(k) > 6) colors.delete(k);
    for (const [k] of top) {
      lastSeen.set(k, f);
      if (colors.has(k)) continue;
      const onScreen = new Set(top.filter(([o]) => colors.has(o)).map(([o]) => colors.get(o)));
      const free = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => !onScreen.has(c));
      const pool = free.length ? free : [0, 1, 2, 3, 4, 5, 6, 7];
      pool.sort((x, y) => (useCount[x] - useCount[y]) || x - y);
      colors.set(k, pool[0]); useCount[pool[0]]++;
    }
    frames.push(top);
    frameColors.push(new Map(top.map(([k]) => [k, colors.get(k)])));
  }
  race = { frames, full, floor, a, colors, frameColors };
  TOP.t = 0; TOP.frame = 0;
  for (const n of raceNodes.values()) n.el.remove();
  raceNodes.clear();
  $('raceSlider').max = Math.max(0, frames.length - 1);
  $('raceSlider').disabled = frames.length < 2;
  $('racePlay').disabled = frames.length < 2;
}
function raceRowH() { return $('raceBars').clientWidth < 520 ? 30 : 34; }

// The ranking at a moment between months: blend each item's value from month f to month f+1.
function raceStateAt(t) {
  const n = race.frames.length, f = Math.max(0, Math.min(n - 1, Math.floor(t))), g = Math.min(n - 1, f + 1), u = Math.min(1, Math.max(0, t - f));
  const val = (i, k) => { const v = race.full[i].get(k); return v !== undefined ? v : Math.min(race.floor[i], race.full[i === f ? g : f].get(k) ?? 0); };
  const keys = new Set([...race.frames[f], ...race.frames[g]].map(([k]) => k));
  const out = [];
  for (const k of keys) { const v = val(f, k) * (1 - u) + val(g, k) * u; if (v > 0) out.push([k, v]); }
  out.sort((p, q) => q[1] - p[1]);
  return { list: out.slice(0, RACE_N), f, g, u };
}
const raceColor = (k, f, g) => race.frameColors[f].get(k) ?? race.frameColors[g].get(k) ?? race.colors.get(k) ?? 0;

// Paint one moment. dt = ms since the last paint (0 = jump straight there). Returns true when nothing is still moving.
function paintRace(t, dt) {
  if (!race || !race.frames.length) { $('raceEmpty').hidden = false; return true; }
  const { list, f, g, u } = raceStateAt(t);
  const rowH = raceRowH(), box = $('raceBars'), ent = TOP_ENT[TOP.entity], fmt = TOP_METRICS[TOP.metric].fmt;
  const max = list[0]?.[1] || 1;
  box.style.height = `${RACE_N * rowH}px`;
  const ease = dt <= 0 || reduceMotion.matches ? 1 : 1 - Math.exp(-dt / 130); // glide toward the new spot
  let settled = true;
  const shown = new Set();
  list.forEach(([k, v], i) => {
    let n = raceNodes.get(k);
    if (!n) {
      const el = document.createElement('div');
      el.className = 'rb';
      const sub = ent.sub(k);
      el.innerHTML = `<span class="rb-name" title="${esc(ent.name(k))}${sub ? ' · ' + esc(sub) : ''}">${esc(ent.name(k))}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="rb-track"><i></i><b></b></span>`;
      box.appendChild(el);
      n = { el, y: ease === 1 ? i * rowH : RACE_N * rowH, op: ease === 1 ? 1 : 0, col: -1 };
      raceNodes.set(k, n);
    }
    shown.add(k);
    const ty = i * rowH;
    n.y += (ty - n.y) * ease; n.op += (1 - n.op) * ease;
    if (Math.abs(ty - n.y) > 0.5 || n.op < 0.99) settled = false; else { n.y = ty; n.op = 1; }
    n.el.style.height = `${rowH - 6}px`;
    n.el.style.transform = `translateY(${n.y.toFixed(1)}px)`;
    n.el.style.opacity = n.op.toFixed(3);
    n.el.style.zIndex = String(20 - i);
    n.el.classList.toggle('lead', i === 0);
    const col = raceColor(k, u < 0.5 ? f : g, u < 0.5 ? g : f) + 1;
    if (n.col !== col) { if (n.col > 0) n.el.classList.remove(`c${n.col}`); n.el.classList.add(`c${col}`); n.col = col; }
    n.el.querySelector('i').style.width = `${Math.max(0.5, (v / max) * 100).toFixed(2)}%`;
    n.el.querySelector('b').textContent = fmt(v);
  });
  for (const [k, n] of raceNodes) { // items that dropped out sink below and fade
    if (shown.has(k)) continue;
    const ty = (RACE_N + 0.4) * rowH;
    n.y += (ty - n.y) * ease; n.op += (0 - n.op) * ease;
    n.el.style.transform = `translateY(${n.y.toFixed(1)}px)`;
    n.el.style.opacity = n.op.toFixed(3);
    if (n.op < 0.02) { n.el.remove(); raceNodes.delete(k); } else settled = false;
  }
  const mi = race.a + Math.min(race.frames.length - 1, Math.round(t)), label = monthLabel(D.months[mi]);
  $('raceDate').innerHTML = `${label}<small>${TOP.mode === 'rolling' ? 'last 12 months' : 'running total'}</small>`;
  $('raceLabel').textContent = label;
  $('raceEmpty').hidden = list.length > 0;
  return settled;
}

// One animation loop drives both playback and settling after a jump or scrub.
let raceRaf = 0, raceLast = 0;
function raceLoop(ts) {
  const dt = raceLast ? Math.min(100, ts - raceLast) : 16;
  raceLast = ts;
  const end = race.frames.length - 1;
  if (TOP.playing) {
    TOP.t = Math.min(end, TOP.t + dt / TOP.speed); // TOP.speed = ms per month
    $('raceSlider').value = TOP.t;
  }
  TOP.frame = Math.floor(TOP.t);
  const settled = paintRace(TOP.t, dt);
  if (TOP.playing && TOP.t >= end) racePlay(false);
  if (TOP.playing || !settled) raceRaf = requestAnimationFrame(raceLoop);
  else { raceRaf = 0; raceLast = 0; }
}
function raceKick() { if (!raceRaf && race) { raceLast = 0; raceRaf = requestAnimationFrame(raceLoop); } }
// Jump to a month (or any point between months). instant = no gliding.
function drawRace(t, instant = false) {
  if (!race) return;
  TOP.t = Math.max(0, Math.min(race.frames.length - 1, t));
  TOP.frame = Math.floor(TOP.t);
  $('raceSlider').value = TOP.t;
  if (instant) paintRace(TOP.t, 0); else raceKick();
}

// playback
function racePlay(on) {
  TOP.playing = Boolean(on && race && race.frames.length > 1);
  $('racePlay').innerHTML = TOP.playing ? '❚❚ Pause' : '▶ Play';
  $('racePlay').setAttribute('aria-pressed', TOP.playing);
  if (!TOP.playing) return;
  if (TOP.t >= race.frames.length - 1) drawRace(0, true); // at the end: start over
  raceKick();
}
function setRaceSpeed(ms) { TOP.speed = ms; }

// ----- rank lines (the original view), generalized -----
let rankData = null;
function rankBuckets([a, b]) {
  const n = b - a + 1;
  if (n < 2) return null;
  const unit = n >= 24 ? 'year' : n >= 6 ? 'quarter' : 'month';
  const key = (m) => {
    const [y, mo] = D.months[m].split('-');
    return unit === 'year' ? y : unit === 'quarter' ? `${y} Q${Math.ceil(+mo / 3)}` : monthLabel(D.months[m]);
  };
  const keys = [];
  for (let m = a; m <= b; m++) if (keys.at(-1) !== key(m)) keys.push(key(m));
  return { unit, keys, key };
}
function renderRank() {
  const bk = rankBuckets(state.range);
  if (!bk || bk.keys.length < 2) {
    $('rankChart').innerHTML = `<p class="muted small">Pick a period of a few months or more to see how rankings moved.</p>`;
    rankData = null; return;
  }
  const [a, b] = state.range, idx = new Map(bk.keys.map((k, i) => [k, i]));
  const per = topMonthly(a, b, topAllowed());
  const perBucket = bk.keys.map(() => new Map()), total = new Map();
  for (let m = a; m <= b; m++) {
    const mp = perBucket[idx.get(bk.key(m))];
    for (const [k, v] of per[m - a]) { mp.set(k, (mp.get(k) || 0) + v); total.set(k, (total.get(k) || 0) + v); }
  }
  const top = topK(total, RANK_N).map(([k]) => k);
  const ranks = perBucket.map((mp) => {
    const order = topK(mp, RANK_MAX).map(([k]) => k);
    return new Map(top.map((k) => [k, { rank: order.indexOf(k) + 1 || Infinity, val: mp.get(k) || 0 }]));
  });
  rankData = { bk, top, ranks };
  if (!top.length) { $('rankChart').innerHTML = '<p class="muted small">Nothing to rank with these settings.</p>'; return; }
  const ent = TOP_ENT[TOP.entity];
  const W0 = widthOf('rankChart'), small = W0 < 560;
  const left = 34, right = small ? 104 : 200, top0 = 14, rowH = small ? 22 : 26;
  let H = top0 + rowH * RANK_MAX + 34;
  const pw = W0 - left - right, nB = bk.keys.length;
  const x = (i) => left + (nB === 1 ? pw / 2 : (i / (nB - 1)) * pw);
  const y = (r) => top0 + (Math.min(r, RANK_MAX + 0.6) - 1) * rowH;
  const ends = top.map((k, s) => { const r = ranks[nB - 1].get(k).rank; return { k, s, r, out: r > RANK_MAX, y: y(r) }; })
    .sort((p, q) => p.r - q.r || p.s - q.s);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  H += Math.max(0, ends.at(-1).y + 10 - (top0 + rowH * (RANK_MAX - 1) + 22));
  let g = '';
  for (let r = 1; r <= RANK_MAX; r++) g += `<line class="grid" x1="${left}" x2="${left + pw}" y1="${y(r)}" y2="${y(r)}"/><text class="ylab" x="${left - 8}" y="${y(r) + 4}">#${r}</text>`;
  g += `<text class="ylab" x="${left - 8}" y="${y(RANK_MAX + 0.6) + 4}">${RANK_MAX + 1}+</text>`;
  const every = Math.max(1, Math.ceil(nB / Math.floor(pw / (bk.unit === 'year' ? 44 : 70))));
  bk.keys.forEach((k, i) => { if (i % every === 0 || i === nB - 1) g += `<text class="xlab" text-anchor="${i === 0 ? 'start' : i === nB - 1 ? 'end' : 'middle'}" x="${x(i)}" y="${H - 8}">${esc(bk.unit === 'year' ? k : k.replace(/^(\d{4}) (Q\d)$/, '$2 ’$1').replace(/’20/, '’'))}</text>`; });
  top.forEach((k, s) => {
    let solid = '', dashed = '';
    for (let i = 1; i < nB; i++) {
      const r0 = ranks[i - 1].get(k).rank, r1 = ranks[i].get(k).rank;
      if (r0 > RANK_MAX && r1 > RANK_MAX) continue;
      const seg = `M${x(i - 1).toFixed(1)},${y(r0).toFixed(1)}L${x(i).toFixed(1)},${y(r1).toFixed(1)}`;
      if (r0 > RANK_MAX || r1 > RANK_MAX) dashed += seg; else solid += seg;
    }
    g += `<g class="rk s${s + 1}" data-s="${s}"><path class="rk-line" d="${solid}"/><path class="rk-line out" d="${dashed}"/>`;
    ranks.forEach((rk, i) => {
      const r = rk.get(k).rank;
      if (r > RANK_MAX && !rk.get(k).val) return;
      g += `<circle class="rk-pt${r > RANK_MAX ? ' out' : ''}" cx="${x(i).toFixed(1)}" cy="${y(r).toFixed(1)}" r="${r > RANK_MAX ? 3 : 4}" data-s="${s}" data-i="${i}"/>`;
    });
    const e = ends.find((p) => p.s === s), name = ent.name(k);
    g += `<circle class="rk-dot" cx="${left + pw + 12}" cy="${e.y}" r="4"/>` +
      `<text class="rk-lab${e.out ? ' is-out' : ''}" x="${left + pw + 20}" y="${e.y + 4}">${esc(name.length > (small ? 11 : 24) ? name.slice(0, small ? 10 : 23) + '…' : name)}${e.out && !small ? `<tspan class="rk-outnote"> (out of top ${RANK_MAX})</tspan>` : ''}</text></g>`;
  });
  $('rankChart').innerHTML = svgEl(W0, H, g, `Rank of your top ${TOP.entity} over time`);
  rankData.unit = bk.unit;
}
$('rankChart').addEventListener('mouseover', (e) => {
  const g = e.target.closest('g.rk');
  $('rankChart').classList.toggle('focus', !!g);
  $('rankChart').querySelectorAll('g.rk').forEach((el) => el.classList.toggle('on', el === g));
});
$('rankChart').addEventListener('mouseleave', () => { $('rankChart').classList.remove('focus'); });
tooltip($('rankChart'), '.rk-pt', (el) => {
  if (!rankData) return null;
  const { bk, top, ranks } = rankData, k = top[+el.dataset.s], v = ranks[+el.dataset.i].get(k), ent = TOP_ENT[TOP.entity];
  return `<b>${esc(ent.name(k))}</b>${ent.sub(k) ? `<br>${esc(ent.sub(k))}` : ''}<br>${esc(bk.keys[+el.dataset.i])}: ${v.rank > RANK_MAX ? (v.val ? `outside the top ${RANK_MAX}` : 'none') : `#${v.rank}`} · ${TOP_METRICS[TOP.metric].fmt(v.val)}`;
});

// ----- the card: controls + which view -----
function renderTopOver() {
  racePlay(false);
  const n = libFilterCount();
  $('topFiltersCount').textContent = n ? ` (${n} active)` : ' (none set)';
  document.querySelectorAll('#topView button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === TOP.view));
  $('topEntity').value = TOP.entity; $('topMetric').value = TOP.metric; $('topMode').value = TOP.mode; $('topUseFilters').checked = TOP.useFilters;
  $('topModeWrap').hidden = TOP.view !== 'race';
  $('raceWrap').hidden = TOP.view !== 'race';
  $('rankChart').hidden = TOP.view !== 'lines';
  const what = `${TOP.entity} by ${TOP_METRICS[TOP.metric].label}`;
  $('topTitle').textContent = `Top ${what}`;
  $('topNote').textContent = TOP.view === 'race'
    ? `Your top ${RACE_N} ${TOP.entity} ${TOP.mode === 'rolling' ? 'over the 12 months up to each point' : 'added up from the start of the period'}. Press play, or drag the slider to move through time.`
    : `Your top ${RANK_N} ${what} in this period, ranked each ${rankBuckets(state.range)?.unit || 'month'}. Hover or tap a line to follow one.`;
  if (TOP.view === 'race') { buildRace(); drawRace(0, true); } else renderRank();
}
let topRebuild = 0;
function onLibraryFiltersChanged() { // keep the chart in step when it follows the library filters
  if (!TOP.useFilters) return;
  clearTimeout(topRebuild);
  topRebuild = setTimeout(renderTopOver, 300);
}
$('topCard').addEventListener('click', (e) => {
  const v = e.target.closest('#topView [data-v]');
  if (v) { TOP.view = v.dataset.v; renderTopOver(); }
});
$('topCard').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'topEntity') TOP.entity = t.value;
  else if (t.id === 'topMetric') TOP.metric = t.value;
  else if (t.id === 'topMode') TOP.mode = t.value;
  else if (t.id === 'topUseFilters') TOP.useFilters = t.checked;
  else if (t.id === 'raceSpeed') { setRaceSpeed(+t.value); return; }
  else return;
  renderTopOver();
});
$('racePlay').addEventListener('click', () => racePlay(!TOP.playing));
$('raceSlider').addEventListener('input', (e) => { racePlay(false); drawRace(+e.target.value); });
// the slider moves continuously; arrow keys still step a whole month
$('raceSlider').addEventListener('keydown', (e) => {
  const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 12, PageDown: -12 }[e.key];
  if (d === undefined) return;
  e.preventDefault(); racePlay(false);
  drawRace(Math.round(TOP.t) + d);
});
$('raceWrap').addEventListener('keydown', (e) => {
  if (e.key === ' ' && e.target.id !== 'racePlay' && !/SELECT|INPUT/.test(e.target.tagName)) { e.preventDefault(); racePlay(!TOP.playing); }
});
setRaceSpeed(700);
tooltip($('raceBars'), '.rb', (el) => {
  if (!race) return null;
  const k = [...raceNodes].find(([, n]) => n.el === el)?.[0];
  if (k === undefined) return null;
  const fr = raceStateAt(TOP.t).list, i = fr.findIndex(([kk]) => kk === k); // what's on screen right now
  if (i < 0) return null;
  const ent = TOP_ENT[TOP.entity];
  return `<b>#${i + 1} ${esc(ent.name(k))}</b>${ent.sub(k) ? `<br>${esc(ent.sub(k))}` : ''}<br>${TOP_METRICS[TOP.metric].fmt(fr[i][1])}`;
});

// ----- New vs familiar: listening to songs heard for the first time that month -----
let newData = [];
function renderNew() {
  const [a, b] = state.range;
  const rows = [];
  for (let m = a; m <= b; m++) rows.push({ m, fresh: 0, known: 0, songs: 0 });
  for (let i = 0; i < R.length; i += W) {
    const m = R[i + 1];
    if (m < a || m > b) continue;
    const r = rows[m - a];
    if (songFirst[R[i]] === m) r.fresh += R[i + 3]; else r.known += R[i + 3];
  }
  for (let s = 0; s < nSongs; s++) { const f = songFirst[s]; if (f >= a && f <= b) rows[f - a].songs++; }
  newData = rows;
  const W0 = widthOf('newChart'), H = 190, left = 40, top0 = 8, plotH = 150;
  const pw = W0 - left - 4, n = rows.length, bw = pw / n;
  const max = Math.max(1, ...rows.map((r) => r.fresh + r.known)) / 3600;
  const step = niceStep(max), topV = Math.ceil(max / step) * step;
  const yv = (h) => top0 + plotH - (h / topV) * plotH;
  let g = '';
  for (let v = 0; v <= topV; v += step) g += `<line class="grid" x1="${left}" x2="${W0}" y1="${yv(v)}" y2="${yv(v)}"/><text class="ylab" x="${left - 6}" y="${yv(v) + 4}">${num(v)} h</text>`;
  rows.forEach((r, i) => {
    const w = Math.min(64, Math.max(1, bw - Math.min(2, bw * 0.2))), x0 = left + i * bw + (bw - w) / 2; // cap width so a short period isn't one giant slab
    const hf = r.fresh / 3600, hk = r.known / 3600;
    const yF = yv(hf), yK = yv(hf + hk);
    if (hf > 0) g += `<rect class="nv-new" x="${x0.toFixed(1)}" y="${yF.toFixed(1)}" width="${w.toFixed(1)}" height="${(top0 + plotH - yF).toFixed(1)}"/>`;
    if (hk > 0) g += `<rect class="nv-known" x="${x0.toFixed(1)}" y="${yK.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, yF - yK - (hf > 0 ? 1.5 : 0)).toFixed(1)}" rx="${Math.min(3, w / 3).toFixed(1)}"/>`;
    g += `<rect class="hit" data-i="${i}" x="${(left + i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}"/>`;
    const lbl = D.months[r.m];
    // short periods: every month; long ones: each January (every other year if they'd collide)
    const yearEvery = bw * 12 < 34 ? 2 : 1;
    const showYear = lbl.endsWith('-01') && (+lbl.slice(0, 4)) % yearEvery === 0;
    if (n <= 14 || showYear) g += `<text class="xlab" x="${(x0 + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${n <= 14 ? MONTHS[+lbl.slice(5) - 1] : lbl.slice(0, 4)}</text>`;
  });
  $('newChart').innerHTML = svgEl(W0, H + 4, g, 'Listening to new songs versus songs you already knew, by month');
  const fresh = rows.reduce((s, r) => s + r.fresh, 0), all = rows.reduce((s, r) => s + r.fresh + r.known, 0), songs = rows.reduce((s, r) => s + r.songs, 0);
  // most exploring month: skip the first 6 months of your history (everything is "new" there) and very light months
  const cands = rows.filter((r) => r.m >= 6 && r.fresh + r.known > 3600 * 5);
  const best = cands.length ? cands.reduce((p, r) => (r.fresh / (r.fresh + r.known) > p.fresh / (p.fresh + p.known) ? r : p)) : null;
  $('newNote').textContent = all ? `${pct(fresh / all)} of your listening was songs you'd never played before · ${num(songs)} songs heard for the first time` +
    (n > 2 && best ? ` · most exploring: ${monthLabel(D.months[best.m])} (${pct(best.fresh / (best.fresh + best.known))} new)` : '') +
    (a < 6 ? ' · the first months of your history count as all new' : '') : 'No listening in this period.';
}
tooltip($('newChart'), '.hit', (el) => {
  const r = newData[+el.dataset.i];
  if (!r) return null;
  const all = r.fresh + r.known || 1;
  return `<b>${monthLabel(D.months[r.m])}</b><br>New songs: ${hours(r.fresh)} (${pct(r.fresh / all)})<br>Songs you knew: ${hours(r.known)}<br>${num(r.songs)} songs played for the first time`;
});

// ----- Listening calendar: one row of weeks per year -----
// 8 shades. Each one covers about an eighth of the days you listened in the selected period,
// so the colors spread out whether the period is a light month or a heavy year.
const CAL_LEVELS = 8;
let calEdges = [];
function calEdgesFor(d0, d1) {
  const v = [];
  for (let d = d0; d <= d1; d++) if (DD.sec[d] >= 60) v.push(DD.sec[d]);
  v.sort((p, q) => p - q);
  const edges = [];
  for (let i = 1; i < CAL_LEVELS; i++) {
    const e = Math.round((v[Math.floor((i * v.length) / CAL_LEVELS)] || 0) / 60) * 60; // whole minutes
    if (e > (edges.at(-1) || 60)) edges.push(e);
  }
  return edges;
}
const calLevel = (sec) => { if (sec < 60) return 0; let i = 0; while (i < calEdges.length && sec >= calEdges[i]) i++; return i + 1; };
const hm = (sec) => { const m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? `${h} h${m % 60 ? ` ${m % 60} m` : ''}` : `${m} m`; }; // exact to the minute
const calRange = (lv) => lv === 0 ? 'No listening' : lv === 1 ? `under ${hm(calEdges[0] ?? 3600)}` : lv > calEdges.length ? `${hm(calEdges.at(-1))} or more` : `${hm(calEdges[lv - 2])} – ${hm(calEdges[lv - 1])}`;
let calDays = null, calAllYears = false;
function renderCalendar() {
  if (!DD) { $('calCard').hidden = true; return; }
  $('calCard').hidden = false;
  const [d0, d1] = dayRange(state.range);
  if (d1 < d0) { $('calendar').innerHTML = ''; $('calNote').textContent = 'No days in this period.'; return; }
  const W0 = widthOf('calendar'), labW = 30;
  const cell = Math.max(5, Math.min(15, Math.floor((W0 - labW) / 54) - 2)), gap = cell >= 9 ? 2 : 1, pitch = cell + gap;
  const y0 = dayDate(d0).getUTCFullYear(), y1 = dayDate(d1).getUTCFullYear();
  calEdges = calEdgesFor(d0, d1);
  const used = calEdges.length + 1;
  $('calLegend').innerHTML = `<span>Less</span>${Array.from({ length: used + 1 }, (_, lv) => `<i class="cal q${lv === 0 ? 0 : Math.round(1 + ((lv - 1) * (CAL_LEVELS - 1)) / Math.max(1, used - 1))}" title="${calRange(lv)}"></i>`).join('')}<span>More</span>`;
  const shade = (lv) => (lv === 0 ? 0 : Math.round(1 + ((lv - 1) * (CAL_LEVELS - 1)) / Math.max(1, used - 1))); // spread the shades if there are fewer levels
  let html = '';
  const shownFrom = calAllYears ? y0 : Math.max(y0, y1 - 2); // latest 3 years unless you ask for all
  for (let yr = y1; yr >= shownFrom; yr--) {
    const jan1 = Math.round((Date.UTC(yr, 0, 1) - day0ms) / 86400000);
    const off = (dayDate(jan1).getUTCDay() + 6) % 7; // Monday = 0
    const daysIn = (Date.UTC(yr + 1, 0, 1) - Date.UTC(yr, 0, 1)) / 86400000;
    const weeks = Math.ceil((daysIn + off) / 7);
    let g = '';
    for (let k = 0; k < daysIn; k++) {
      const d = jan1 + k;
      if (d < d0 || d > d1) continue;
      const col = Math.floor((k + off) / 7), row = (k + off) % 7;
      const sec = DD.sec[d] || 0;
      g += `<rect class="cal q${shade(calLevel(sec))}" data-d="${d}" x="${labW + col * pitch}" y="${18 + row * pitch}" width="${cell}" height="${cell}" rx="${Math.min(3, cell / 4)}"/>`;
    }
    for (let mo = 0; mo < 12; mo++) {
      const k = (Date.UTC(yr, mo, 1) - Date.UTC(yr, 0, 1)) / 86400000, col = Math.floor((k + off) / 7);
      const kEnd = (Date.UTC(yr, mo + 1, 1) - Date.UTC(yr, 0, 1)) / 86400000 - 1;
      if (jan1 + kEnd < d0 || jan1 + k > d1) continue; // only label months in the period
      if (cell >= 8 || mo % 3 === 0) g += `<text class="xlab" x="${labW + col * pitch}" y="11">${MONTHS[mo]}</text>`;
    }
    ['Mon', 'Wed', 'Fri'].forEach((l, j) => { if (cell >= 8) g += `<text class="ylab" x="${labW - 6}" y="${18 + j * 2 * pitch + cell - 1}">${l}</text>`; });
    const w = labW + weeks * pitch, h = 18 + 7 * pitch;
    html += `<div class="cal-year"><span class="cal-yr">${yr}</span>${svgEl(w, h, g, `Listening calendar ${yr}`)}</div>`;
  }
  if (shownFrom > y0 || calAllYears && y1 - y0 > 2) {
    html += `<button class="ghost cal-more" data-calmore>${calAllYears ? 'Show only the latest 3 years' : `Show all ${y1 - y0 + 1} years`}</button>`;
  }
  $('calendar').innerHTML = html;
  // streaks, biggest day, best weekday
  let best = 0, bestEnd = d0, run = 0, gapBest = 0, gapRun = 0, big = d0, listened = 0;
  const wd = new Array(7).fill(0), wdN = new Array(7).fill(0);
  for (let d = d0; d <= d1; d++) {
    const on = DD.sec[d] >= 60;
    if (on) { listened++; run++; gapRun = 0; if (run > best) { best = run; bestEnd = d; } } else { run = 0; gapRun++; gapBest = Math.max(gapBest, gapRun); }
    if (DD.sec[d] > DD.sec[big]) big = d;
    const w = (dayDate(d).getUTCDay() + 6) % 7; wd[w] += DD.sec[d]; wdN[w]++;
  }
  const topWd = wd.map((s, i) => [s / (wdN[i] || 1), i]).sort((p, q) => q[0] - p[0])[0];
  const dn = d1 - d0 + 1;
  $('calNote').innerHTML = `Listened on <b>${num(listened)}</b> of ${num(dn)} days (${pct(listened / dn)}) · longest streak <b>${num(best)} day${best === 1 ? '' : 's'}</b>` +
    (best > 1 ? ` (${fmtDay(bestEnd - best + 1, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDay(bestEnd, { month: 'short', day: 'numeric', year: 'numeric' })})` : '') +
    ` · biggest day <b>${fmtDay(big, { month: 'short', day: 'numeric', year: 'numeric' })}</b> (${hours(DD.sec[big])})` +
    ` · ${['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][topWd[1]]} are your heaviest (${hours(topWd[0])} on average)` + (gapBest > 1 ? ` · longest break ${num(gapBest)} days` : '');
  calDays = true;
}
$('calendar').addEventListener('click', (e) => {
  if (!e.target.closest('[data-calmore]')) return;
  calAllYears = !calAllYears;
  renderCalendar();
});
tooltip($('calendar'), 'rect.cal', (el) => {
  const d = +el.dataset.d;
  return `<b>${fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b><br>${DD.sec[d] ? hm(DD.sec[d]) + ' listened' : 'No listening'}` +
    (DD.sec[d] >= 60 ? `<br><span style="opacity:.75">shade ${calLevel(DD.sec[d])} of ${calEdges.length + 1}: ${calRange(calLevel(DD.sec[d]))}</span>` : '');
});


// ----- How you listen: devices, how songs started, shuffle, offline, private sessions -----
const START_LABELS = ['You picked it', 'Played next on its own', 'You skipped to it', 'Pressed play / resumed', 'Other'];
function hbars(list, total, unitFmt) {
  const max = Math.max(1, ...list.map(([, v]) => v));
  return list.map(([label, v]) => `<li><span class="hb-name">${esc(label)}</span><span class="hb-val">${unitFmt(v)} · ${pct(v / (total || 1))}</span>` +
    `<span class="hb-track"><i style="width:${(v / max) * 100}%"></i></span></li>`).join('');
}
function renderHow() {
  if (!D.how) { $('howCard').hidden = true; return; }
  const [a, b] = state.range;
  const dev = new Map(), start = [0, 0, 0, 0, 0], shuf = [0, 0];
  let off = 0, priv = 0, sec = 0, plays = 0;
  for (let m = a; m <= b; m++) {
    const h = D.how[D.months[m]];
    if (!h) continue;
    for (const [k, v] of Object.entries(h.dev)) { dev.set(k, (dev.get(k) || 0) + v); sec += v; }
    h.start.forEach((v, i) => { start[i] += v; plays += v; });
    shuf[0] += h.shuf[0]; shuf[1] += h.shuf[1]; off += h.off; priv += h.priv;
  }
  const known = [...dev].filter(([k]) => k !== 'Other').length > 0;
  $('howCard').hidden = false;
  if (!plays) { $('howDevices').innerHTML = $('howStarts').innerHTML = ''; $('howNote').textContent = 'No listening in this period.'; return; }
  const devList = [...dev].sort((p, q) => (p[0] === 'Other') - (q[0] === 'Other') || q[1] - p[1]);
  $('howDevices').innerHTML = known ? hbars(devList, sec, hours) : '<li class="muted small">Not in this export.</li>';
  const startList = START_LABELS.map((l, i) => [l, start[i]]).filter(([, v], i) => v > 0 || i < 4);
  $('howStarts').innerHTML = start[4] === plays ? '<li class="muted small">Not in this export.</li>' : hbars(startList, plays, (v) => `${num(v)}`);
  const sTot = shuf[0] + shuf[1];
  $('howNote').innerHTML = [
    sTot ? `Shuffle on for <b>${pct(shuf[0] / sTot)}</b> of plays` : '',
    sec ? `<b>${pct(off / sec)}</b> of listening offline` : '',
    plays ? `<b>${pct(priv / plays)}</b> of plays in a private session` : '',
  ].filter(Boolean).join(' · ');
}

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
  // remember which control had focus so keyboard users don't lose their place when the panel redraws
  const a = document.activeElement;
  const keep = a && $('filterPanel').contains(a)
    ? ['preset', 'saved', 'unit', 'act', 'del'].map((k) => (a.dataset[k] !== undefined ? `[data-${k}="${a.dataset[k]}"]` : '')).find(Boolean)
    : null;
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
  if (keep) ($('filterPanel').querySelector(keep) || $('filterPanel').querySelector('.fp-x'))?.focus();
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
  const go = () => { L.open = null; renderTable(); updatePanelCount(); };
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
  if (e.key === 'Escape') { e.preventDefault(); openPanel(false); $('filterBtn').focus(); }
});
$('filterBtn').addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
document.addEventListener('pointerdown', (e) => {
  if (panel.classList.contains('open') && !panel.contains(e.target) && !$('filterBtn').contains(e.target)) openPanel(false);
});

const L = {
  view: 'songs', q: '', artist: null, album: null, f: blankFilters(), timeUnit: 'min',
  sort: 'sec', dir: -1, open: null, hidePlayer: false, cursor: -1,
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
    ['skip', 'Skipped', 'num opt'], ['heard', 'Avg heard', 'num opt'], ['first', 'First played', 'num opt mid'], ['trend', 'Over time', 'opt mid']],
  artists: [['rank', '#'], ['name', 'Artist'], ['songs', 'Songs', 'num'], ['plays', 'Plays', 'num'], ['sec', 'Time', 'num'],
    ['skip', 'Skipped', 'num opt'], ['heard', 'Avg heard', 'num opt'], ['first', 'First played', 'num opt mid'], ['trend', 'Over time', 'opt mid']],
  albums: [['rank', '#'], ['name', 'Album'], ['songs', 'Songs', 'num'], ['plays', 'Plays', 'num'], ['sec', 'Time', 'num'],
    ['skip', 'Skipped', 'num opt'], ['heard', 'Avg heard', 'num opt'], ['first', 'First played', 'num opt mid'], ['trend', 'Over time', 'opt mid']],
};
const cols = () => COLS[L.view].filter(([k]) => HAS_RET || k !== 'heard');

function sparkline(v, w = 92, h = 26) {
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
    case 'first': return `<td class="num opt mid">${monthLabel(D.months[r.first])}</td>`;
    case 'trend': return `<td class="trend opt mid">${sparkline(seriesFor(r))}</td>`;
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
  const len = D.songs[s][3]; // seconds; 0 = never played to the end, so unknown
  const facts = [
    ['Length', len ? `${Math.floor(len / 60)}:${String(len % 60).padStart(2, '0')}` : '<span class="muted" title="You never played it to the end, so its length isn\'t in your data">Unknown</span>'],
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
      ${D.songs[s][4] ? `<button class="embedbtn" data-embed="${s}" aria-expanded="${!L.hidePlayer}">${L.hidePlayer ? '▶ Show player' : 'Hide player'}</button>
      <a class="spbtn" href="https://open.spotify.com/track/${D.songs[s][4]}" target="_blank" rel="noopener">Play on Spotify ↗</a>` : ''}
      <button data-artist="${r.a}">All songs by ${esc(r.artist)}</button>
      ${r.album ? `<button data-album="${esc(`${r.a}|${r.album}`)}">Album: ${esc(r.album)}</button>` : ''}
    </div>${D.songs[s][4] && !L.hidePlayer ? `<div class="embed"><div class="embed-slot" data-track="${D.songs[s][4]}"></div>
      <p class="muted small">Starts a preview when you open a song. Press play in the player for the full song if you're signed into Spotify in this browser.</p></div>` : ''}
    </div></td></tr>`;
}

// ----- Spotify's embedded player (their iFrame API), loaded the first time a song is opened -----
let spotifyApi = null; // Promise of the IFrameAPI, or of null if it can't load (offline, blocked)
function loadSpotifyApi() {
  if (!spotifyApi) {
    spotifyApi = new Promise((resolve) => {
      const done = (api) => { clearTimeout(timer); resolve(api); };
      const timer = setTimeout(() => done(null), 6000);
      window.onSpotifyIframeApiReady = (api) => done(api);
      const sc = document.createElement('script');
      sc.src = 'https://open.spotify.com/embed/iframe-api/v1';
      sc.async = true;
      sc.onerror = () => done(null);
      document.head.appendChild(sc);
    });
  }
  return spotifyApi;
}
// Put the player into the open row. autoplay = this render came from the user opening the row.
async function mountPlayer(autoplay) {
  const slot = document.querySelector('#tbody .embed-slot');
  if (!slot) return;
  const id = slot.dataset.track;
  const api = await loadSpotifyApi();
  if (!slot.isConnected) return; // row was closed or re-drawn meanwhile
  const plain = () => {
    slot.outerHTML = `<iframe src="https://open.spotify.com/embed/track/${id}?utm_source=generator" height="80"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Spotify player"></iframe>`;
  };
  if (!api) return plain();
  try {
    api.createController(slot, { uri: `spotify:track:${id}`, width: '100%', height: 80 }, (ctrl) => {
      if (autoplay) ctrl.addListener('ready', () => { try { ctrl.play(); } catch { /* browser blocked autoplay */ } });
    });
  } catch { plain(); }
}

let lastList = [], rendered = 0, maxSecShown = 1, curCols = [];
const PAGE = 100; // rows added each time you scroll near the bottom
function renderTable() {
  // controls reflect state
  document.querySelectorAll('#views button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === L.view));
  renderPeriodPicker();
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
  ].filter(Boolean).map((t) => `<span class="nw">${t}</span>`).join('<span class="dot">·</span><wbr>');

  // table: header, then the first page of rows; more are added as you scroll
  const C = curCols = cols();
  $('thead').innerHTML = C.map(([key, label, cls = '']) => {
    const on = L.sort === key && key !== 'trend';
    return `<th data-k="${key}" class="${cls} ${on ? 'sorted' : ''}">${label}${on && key !== 'rank' ? `<span class="arrow">${L.dir < 0 ? '↓' : '↑'}</span>` : ''}</th>`;
  }).join('');
  maxSecShown = list.reduce((m, r) => Math.max(m, r.sec), 1);
  rendered = 0;
  $('tbody').innerHTML = list.length ? '' : `<tr><td colspan="${C.length}" class="empty">Nothing matches. <button data-clear="all">Clear filters</button></td></tr>`;
  $('tableWrap').scrollTop = 0;
  L.cursor = -1;
  appendRows(PAGE);
  updatePanelCount();
  mountPlayer(false);
  syncUrl();
  if (typeof onLibraryFiltersChanged === 'function') onLibraryFiltersChanged();
}
function rowHTML(r, i) {
  const open = r.kind === 'song' && L.open === r.id;
  return `<tr class="row${open ? ' open' : ''}${i === L.cursor ? ' cursor' : ''}" data-i="${i}">${curCols.map(([key]) => cell(key, r, i, maxSecShown)).join('')}</tr>` + (open ? detail(r) : '');
}
function appendRows(n) {
  const end = Math.min(lastList.length, rendered + n);
  if (end <= rendered) return updateFoot();
  let html = '';
  for (let i = rendered; i < end; i++) html += rowHTML(lastList[i], i);
  $('tbody').insertAdjacentHTML('beforeend', html);
  rendered = end;
  updateFoot();
}
function updateFoot() {
  const n = lastList.length;
  $('count').textContent = !n ? '' : rendered >= n ? `All ${num(n)} shown` : `Showing ${num(rendered)} of ${num(n)} · scroll for more`;
}
const rowEl = (i) => $('tbody').querySelector(`tr.row[data-i="${i}"]`);

// Open / close one song's detail without redrawing the table (keeps your place and the player).
function closeOpen() {
  $('tbody').querySelector('tr.detail')?.remove();
  $('tbody').querySelector('tr.row.open')?.classList.remove('open');
  L.open = null;
}
function toggleOpen(i) {
  const r = lastList[i];
  if (!r) return;
  if (r.kind === 'artist') return libraryArtist(r.id);
  if (r.kind === 'album') return libraryAlbum(r.id);
  const wasOpen = L.open === r.id;
  closeOpen();
  if (wasOpen) return;
  L.open = r.id;
  L.hidePlayer = false; // each newly opened song gets its player (and autoplay)
  const tr = rowEl(i);
  tr.classList.add('open');
  tr.insertAdjacentHTML('afterend', detail(r));
  mountPlayer(true);
  // bring the song and its panel into view inside the table
  tr.nextElementSibling.scrollIntoView({ block: 'nearest' });
  tr.scrollIntoView({ block: 'nearest' });
}
function togglePlayer() {
  const tr = $('tbody').querySelector('tr.row.open'), d = $('tbody').querySelector('tr.detail');
  if (!tr || !d) return;
  L.hidePlayer = !L.hidePlayer;
  d.outerHTML = detail(lastList[+tr.dataset.i]);
  if (!L.hidePlayer) mountPlayer(true);
}

// Keyboard cursor: up/down move, Enter opens.
function setCursor(i) {
  if (!lastList.length) return;
  i = Math.max(0, Math.min(lastList.length - 1, i));
  if (i >= rendered) appendRows(i - rendered + PAGE);
  $('tbody').querySelector('tr.row.cursor')?.classList.remove('cursor');
  L.cursor = i;
  const tr = rowEl(i);
  tr.classList.add('cursor');
  tr.scrollIntoView({ block: 'nearest' });
}

// Period picker inside the library (handy in full screen, where the chart isn't visible).
function renderPeriodPicker() {
  const sel = $('libPeriod'), r = state.range;
  const opts = [['all', 'All time'], ...years.map((y) => [y, y])];
  const match = isAll() ? 'all' : years.find((y) => sameRange(r, yearRange(y)));
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') +
    (match ? '' : `<option value="custom">${esc(rangeLabel(r))}</option>`);
  sel.value = match || 'custom';
}

// Full screen: the library fills the screen; header and filters stay put, the table scrolls.
function setFocusMode(on) {
  if (on === document.body.classList.contains('lib-focus')) return;
  document.body.classList.toggle('lib-focus', on);
  $('libFull').setAttribute('aria-pressed', on);
  $('libFull').title = on ? 'Exit full screen (F or Esc)' : 'Full screen (F)';
  $('libFull').querySelector('span').textContent = on ? 'Exit full screen' : 'Full screen';
  const lib = $('library');
  if (on && lib.requestFullscreen && !document.fullscreenElement) lib.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (on) $('tableWrap').focus({ preventScroll: true });
  else lib.scrollIntoView({ block: 'start' });
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setFocusMode(false); });

function setLib(patch) {
  Object.assign(L, { open: null }, patch);
  renderTable();
  if ('view' in patch && panel.classList.contains('open')) renderPanel();
}
function libraryFocus() { if (!document.body.classList.contains('lib-focus')) $('library').scrollIntoView({ behavior: 'smooth' }); }
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
  if (e.target.closest('a[href]')) return; // real links (Spotify) just open
  const t = e.target.closest('[data-embed],[data-clear],[data-artist],[data-album],th,tr.row');
  if (!t) return;
  if (t.dataset.embed) {
    togglePlayer();
  } else if (t.dataset.clear) {
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
    const i = +t.dataset.i;
    setCursor(i);
    $('tableWrap').focus({ preventScroll: true });
    toggleOpen(i);
  }
});

// Load more rows as you scroll near the bottom of the table.
new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && rendered < lastList.length) appendRows(PAGE);
}, { root: $('tableWrap'), rootMargin: '600px 0px' }).observe($('libSentinel'));
$('tableWrap').addEventListener('scroll', () => { $('toTop').hidden = $('tableWrap').scrollTop < 600; }, { passive: true });
$('toTop').addEventListener('click', () => $('tableWrap').scrollTo({ top: 0, behavior: $('tableWrap').scrollTop > 3000 ? 'instant' : 'smooth' }));
$('libFull').addEventListener('click', () => setFocusMode(!document.body.classList.contains('lib-focus')));
$('libPeriod').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v !== 'custom') setRange(v === 'all' ? [0, N - 1] : yearRange(v));
});

// Keyboard: up/down (or j/k) move · Enter opens · Esc closes / leaves full screen · F full screen · / search
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return; // one key press = one action
  if (e.key === 'Escape' && panel.classList.contains('open')) { e.preventDefault(); openPanel(false); $('filterBtn').focus(); return; }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || panel.classList.contains('open');
  if (typing) return;
  const inLib = document.body.classList.contains('lib-focus') || $('library').contains(document.activeElement);
  if ((e.key === 'f' || e.key === 'F') && !e.repeat) { e.preventDefault(); setFocusMode(!document.body.classList.contains('lib-focus')); return; }
  if (!inLib) return;
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setCursor(L.cursor + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setCursor(L.cursor - 1); }
  else if (e.key === 'Enter' && L.cursor >= 0) { e.preventDefault(); toggleOpen(L.cursor); }
  else if (e.key === 'Escape') {
    if (L.open !== null) { e.preventDefault(); closeOpen(); }
    else if (document.body.classList.contains('lib-focus')) { e.preventDefault(); setFocusMode(false); }
  }
});
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
function placeTip(content, e) {
  const tip = $('tip');
  if (!content) { tip.hidden = true; return; }
  tip.innerHTML = content;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
// Hover with a mouse; tap on a touch screen (tap elsewhere or scroll to dismiss).
function tooltip(root, selector, html) {
  const show = (e) => { const el = e.target.closest(selector); placeTip(el && html(el), e); };
  root.addEventListener('mousemove', (e) => { if (!fromTouch()) show(e); });
  root.addEventListener('mouseleave', () => { if (!fromTouch()) $('tip').hidden = true; });
  root.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { lastTouch = performance.now(); show(e); tipTouched = true; tipScrollY = scrollY; } });
}
// After a tap, browsers also send imitation mouse events; ignore those so the tap's label stays up.
let tipTouched = false, tipScrollY = 0, lastTouch = -1e9;
const fromTouch = () => performance.now() - lastTouch < 1000;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && tipTouched && !e.target.closest('.hist, #retChart, #clockPlot')) { $('tip').hidden = true; tipTouched = false; }
}, true);
// a real scroll (not the nudge a tap can cause) dismisses it
window.addEventListener('scroll', () => { if (tipTouched && Math.abs(scrollY - tipScrollY) > 40) { $('tip').hidden = true; tipTouched = false; } }, { passive: true });

// ---------- sticky section bar ----------
new IntersectionObserver(([e]) => $('jumpbar').classList.toggle('stuck', !e.isIntersecting), { rootMargin: '-1px 0px 0px 0px' })
  .observe(document.querySelector('header'));
$('jumpbar').addEventListener('click', (e) => {
  const a = e.target.closest('[data-jump]');
  if (!a) return;
  e.preventDefault(); // keep the # for the library's filters
  $(a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('jbReset').addEventListener('click', () => setRange([0, N - 1]));
// highlight the section you're in
function currentSection(ids) {
  let cur = ids[0];
  for (const id of ids) { const el = $(id); if (el && !el.hidden && el.getBoundingClientRect().top <= 140) cur = id; }
  return cur;
}
{
  const ids = ['tiles', 'topCard', 'skipCard', 'distCards', 'clockCard', 'library'];
  let raf = 0;
  const update = () => {
    raf = 0;
    const cur = currentSection(ids);
    document.querySelectorAll('.jb-links a').forEach((a) => a.classList.toggle('here', a.dataset.jump === cur));
    window.updateSideHere?.();
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(update); });
}
// "See all" on the top lists opens the full list in the library
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-seeall]');
  if (!b) return;
  $('search').value = '';
  setLib({ view: b.dataset.seeall, q: '', artist: null, album: null, f: blankFilters(), sort: 'sec', dir: -1 });
  libraryFocus();
});

// ---------- sidebar: every section, toggled from the tab on the left or the top bar ----------
const SIDE_KEY = 'spotifyStats.sidebar';
const sideDocked = () => matchMedia('(min-width: 1480px)').matches; // wide screens: sits in the margin
function setSide(open, remember = true) {
  $('sidenav').hidden = !open;
  if (open) window.updateSideHere?.();
  document.body.classList.toggle('side-open', open);
  $('sideTab').setAttribute('aria-expanded', open);
  $('jbMenu').setAttribute('aria-expanded', open);
  if (remember) { try { localStorage.setItem(SIDE_KEY, open ? '1' : '0'); } catch { /* storage off */ } }
}
$('sideTab').addEventListener('click', () => setSide($('sidenav').hidden));
$('jbMenu').addEventListener('click', () => setSide($('sidenav').hidden));
$('sideClose').addEventListener('click', () => setSide(false));
$('sidenav').addEventListener('click', (e) => {
  const a = e.target.closest('[data-side]');
  if (!a) return;
  e.preventDefault(); // keep the # for the library's filters
  $(a.dataset.side).scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!sideDocked()) setSide(false, false); // on smaller screens get out of the way
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('sidenav').hidden && !sideDocked() && !e.defaultPrevented) { e.preventDefault(); setSide(false, false); }
});
document.addEventListener('pointerdown', (e) => { // tap outside closes it when it's covering the page
  if (!$('sidenav').hidden && !sideDocked() && !$('sidenav').contains(e.target) && !e.target.closest('#sideTab, #jbMenu')) setSide(false, false);
});
{
  let saved = null;
  try { saved = localStorage.getItem(SIDE_KEY); } catch { /* storage off */ }
  if (saved === '1' && sideDocked()) setSide(true, false); // reopen on wide screens only
  // highlight the section you're looking at; hide links to sections this data doesn't have
  const links = [...document.querySelectorAll('#sidenav [data-side]')];
  window.updateSideHere = () => {
    if ($('sidenav').hidden) return;
    const cur = currentSection(links.map((a) => a.dataset.side));
    links.forEach((a) => a.classList.toggle('here', a.dataset.side === cur));
  };
  window.refreshSideLinks = () => links.forEach((a) => { const el = $(a.dataset.side); a.hidden = !el || el.hidden; });
}

// ---------- address bar: every filter change becomes a history step ----------
// The library state lives after the # (e.g. #p=2024-01~2024-12&v=artists&plays=10~), so Back/Forward
// step through earlier filters, and a filtered view can be bookmarked or reloaded.
// Names are stored (not internal numbers), so links keep working after you rebuild data.js.
const URL_TEXT = { songText: 'st', artistText: 'at', albumText: 'alt', exclude: 'x' };
function stateToHash() {
  const P = new URLSearchParams();
  if (!isAll()) P.set('p', `${D.months[state.range[0]]}~${D.months[state.range[1]]}`);
  if (L.view !== 'songs') P.set('v', L.view);
  if (L.q) P.set('q', L.q);
  if (L.artist !== null) P.set('ar', D.artists[L.artist]);
  if (L.album !== null) {
    const [a, ...rest] = L.album.split('|');
    P.set('alba', D.artists[+a]);
    P.set('alb', rest.join('|'));
  }
  for (const f of RANGES) {
    const [lo, hi] = L.f[f.k];
    if (lo === null && hi === null) continue;
    const enc = (v) => (v === null ? '' : f.kind === 'month' ? D.months[v] : String(+v.toFixed(4)));
    P.set(f.k, `${enc(lo)}~${enc(hi)}`);
  }
  if (L.f.newOnly) P.set('new', '1');
  for (const [k, short] of Object.entries(URL_TEXT)) if (L.f[k]) P.set(short, L.f[k]);
  if (L.sort !== 'sec' || L.dir !== -1) P.set('sort', `${L.sort}${L.dir > 0 ? '' : '-'}`);
  return P.toString();
}

function hashToState(hash) {
  const P = new URLSearchParams(hash.replace(/^#/, ''));
  const month = (s) => { const i = D.months.indexOf(s); return i < 0 ? null : i; };
  let range = [0, N - 1];
  const p = (P.get('p') || '').split('~');
  if (p.length === 2 && month(p[0]) !== null && month(p[1]) !== null) range = [Math.min(month(p[0]), month(p[1])), Math.max(month(p[0]), month(p[1]))];
  const f = blankFilters();
  for (const r of RANGES) {
    const v = P.get(r.k);
    if (!v || !v.includes('~')) continue;
    const parse = (x) => (x === '' ? null : r.kind === 'month' ? month(x) : Number.isFinite(+x) ? +x : null);
    f[r.k] = v.split('~').slice(0, 2).map(parse);
  }
  f.newOnly = P.get('new') === '1';
  for (const [k, short] of Object.entries(URL_TEXT)) f[k] = P.get(short) || '';
  const artistIx = (name) => { const i = name === null ? -1 : D.artists.indexOf(name); return i < 0 ? null : i; };
  const ar = artistIx(P.get('ar'));
  const alba = artistIx(P.get('alba'));
  const sortRaw = P.get('sort') || 'sec-';
  const sortKey = sortRaw.replace(/-$/, '');
  const view = ['songs', 'artists', 'albums'].includes(P.get('v')) ? P.get('v') : 'songs';
  return {
    range,
    lib: {
      view, q: P.get('q') || '', f,
      artist: ar, album: alba !== null && P.has('alb') ? `${alba}|${P.get('alb')}` : null,
      sort: COLS[view].some(([k]) => k === sortKey) ? sortKey : 'sec',
      dir: COLS[view].some(([k]) => k === sortKey) ? (sortRaw.endsWith('-') ? -1 : 1) : -1,
    },
  };
}

let urlTimer = 0, restoringUrl = false;
// Called after every library render. Waits until you pause (typing, sliders) so one change = one Back step.
function syncUrl() {
  if (restoringUrl) return;
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const h = stateToHash();
    if (h === location.hash.replace(/^#/, '')) return;
    try { history.pushState(null, '', h ? `#${h}` : location.pathname + location.search); } catch { /* some file:// setups */ }
  }, 450);
}
function applyHash() {
  const { range, lib } = hashToState(location.hash);
  restoringUrl = true;
  Object.assign(L, lib, { open: null });
  $('search').value = L.q;
  setRange(range);
  if (panel.classList.contains('open')) renderPanel();
  restoringUrl = false;
}
window.addEventListener('popstate', () => { clearTimeout(urlTimer); applyHash(); });

// ---------- go ----------
function renderAll() {
  renderYears();
  renderTiles();
  renderTimeline();
  renderTop();
  renderSkips();
  renderTopOver();
  renderNew();
  renderDists();
  renderHow();
  renderClock();
  renderCalendar();
  renderRetention();
  renderTable();
  window.refreshSideLinks?.();
}
$('range').textContent = `${monthLabel(D.months[0])} – ${monthLabel(D.months.at(-1))} · ${window.SPOTIFY_SOURCE?.kind === 'mine' ? 'your' : D.name && !/^default$/i.test(D.name) ? `${D.name}'s` : 'the default'} Spotify streaming history`;
applyHash(); // start from the address (a bookmarked or reloaded view), or the default
document.body.classList.remove('booting');
