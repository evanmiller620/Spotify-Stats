// Playlists made from listening stats: blends of several people, top songs, things to discover.
// Used by the Friends view (you + friends) and by a friend's shared page (just them).
window.Playlists = (() => {
  const SIZES = [25, 50, 100];

  // Per-song totals for one history between two months ("YYYY-MM", inclusive).
  function songStats(D, from = '0000-00', to = '9999-99') {
    const W = D.cols || 9, R = D.rows, out = new Map();
    let total = 0;
    for (let i = 0; i < R.length; i += W) {
      const mk = D.months[R[i + 1]];
      if (mk < from || mk > to) continue;
      const s = D.songs[R[i]], artist = D.artists[s[1]];
      const key = s[4] || `${s[0]}\n${artist}`.toLowerCase();
      let g = out.get(key);
      if (!g) out.set(key, (g = { key, title: s[0], artist, track: s[4] || '', sec: 0, plays: 0, last: '' }));
      g.sec += R[i + 3]; g.plays += R[i + 2]; total += R[i + 3];
      if (mk > g.last) g.last = mk;
    }
    out.total = total || 1;
    return out;
  }
  const ranked = (m) => [...m.values()].filter((g) => g.track).sort((a, b) => b.sec - a.sec);
  const shiftMonth = (mk, n) => { const d = new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const label = (mk) => `${MONTHS[+mk.slice(5) - 1]} ${mk.slice(0, 4)}`;
  const joinNames = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} & ${a.at(-1)}`);

  // ---------- the kinds of playlist ----------
  const KINDS = {
    blend: {
      label: 'Blend', group: true,
      about: 'Songs you have in common first, then each person\'s favorites taking turns.',
      name: (c) => `${joinNames(c.people.map((p) => p.short))} Blend${c.period.all ? '' : ` · ${c.period.label}`}`,
      make(c, n) {
        const stats = c.people.map((p) => songStats(p.D, c.period.from, c.period.to));
        const all = new Map();
        stats.forEach((m, pi) => m.forEach((g) => {
          if (!g.track) return;
          const e = all.get(g.key) || { ...g, who: [], share: [] };
          e.who.push(pi); e.share.push(g.sec / m.total); all.set(g.key, e);
        }));
        const common = [...all.values()].filter((e) => e.who.length > 1)
          .sort((a, b) => b.who.length - a.who.length || Math.min(...b.share) - Math.min(...a.share));
        const out = common.slice(0, Math.ceil(n * 0.6)).map((e) => ({ ...e, why: `${e.who.length === c.people.length ? 'Everyone' : joinNames(e.who.map((i) => c.people[i].short))} plays it` }));
        const seen = new Set(out.map((e) => e.key));
        const tops = stats.map(ranked);
        for (let r = 0; out.length < n && tops.some((t) => r < t.length); r++) {
          tops.forEach((t, pi) => { const g = t[r]; if (g && out.length < n && !seen.has(g.key)) { seen.add(g.key); out.push({ ...g, who: [pi], why: `${c.people[pi].short}'s #${r + 1}` }); } });
        }
        return out;
      },
    },
    everyone: {
      label: "Everyone's top songs", group: true,
      about: 'Each person\'s most-played songs, taking turns.',
      name: (c) => `Top songs: ${joinNames(c.people.map((p) => p.short))}${c.period.all ? '' : ` · ${c.period.label}`}`,
      make(c, n) {
        const tops = c.people.map((p) => ranked(songStats(p.D, c.period.from, c.period.to)));
        const out = [], seen = new Set();
        for (let r = 0; out.length < n && tops.some((t) => r < t.length); r++) {
          tops.forEach((t, pi) => { const g = t[r]; if (g && out.length < n && !seen.has(g.key)) { seen.add(g.key); out.push({ ...g, who: [pi], why: `${c.people[pi].short}'s #${r + 1}` }); } });
        }
        return out;
      },
    },
    discover: {
      label: 'Discover from friends', group: true, needsYou: true,
      about: "Your friends' favorites that you've barely or never played.",
      name: (c) => `Discover: ${joinNames(c.people.filter((p) => !p.you).map((p) => p.short))}${c.period.all ? '' : ` · ${c.period.label}`}`,
      make(c, n) {
        const you = c.people.findIndex((p) => p.you);
        const mine = songStats(c.people[you].D); // all time: anything you've played twice isn't new
        const pool = new Map();
        c.people.forEach((p, pi) => {
          if (pi === you) return;
          const m = songStats(p.D, c.period.from, c.period.to);
          ranked(m).forEach((g, r) => {
            if ((mine.get(g.key)?.plays || 0) > 1) return;
            const e = pool.get(g.key) || { ...g, who: [], score: 0, best: [pi, r] };
            e.who.push(pi); e.score += g.sec / m.total; pool.set(g.key, e);
          });
        });
        return [...pool.values()].sort((a, b) => b.score - a.score).slice(0, n)
          .map((e) => ({ ...e, why: e.who.length > 1 ? `${joinNames(e.who.map((i) => c.people[i].short))} play it` : `${c.people[e.best[0]].short}'s #${e.best[1] + 1}` }));
      },
    },
    top: {
      label: 'Top songs', person: true,
      about: 'Most-played songs in the period, by listening time.',
      name: (c, p) => `${p.you ? 'My' : `${p.short}'s`} top songs${c.period.all ? '' : ` · ${c.period.label}`}`,
      make(c, n, p) {
        return ranked(songStats(p.D, c.period.from, c.period.to)).slice(0, n).map((g) => ({ ...g, who: [c.people.indexOf(p)], why: `${hours(g.sec)} · ${num(g.plays)} plays` }));
      },
    },
    repeat: {
      label: 'On repeat lately', person: true,
      about: 'Most-played songs in the last 3 months of their history.',
      name: (c, p) => `${p.you ? 'My' : `${p.short}'s`} recent repeats`,
      make(c, n, p) {
        const end = p.D.months.at(-1), from = shiftMonth(end, -2);
        return ranked(songStats(p.D, from, end)).slice(0, n).map((g) => ({ ...g, who: [c.people.indexOf(p)], why: `${num(g.plays)} plays since ${label(from)}` }));
      },
    },
    forgotten: {
      label: 'Forgotten favorites', person: true,
      about: 'Songs that were played a lot but not at all in the last year.',
      name: (c, p) => `${p.you ? 'My' : `${p.short}'s`} forgotten favorites`,
      make(c, n, p) {
        const cut = shiftMonth(p.D.months.at(-1), -12);
        return ranked(songStats(p.D)).filter((g) => g.last < cut && g.plays >= 5).slice(0, n)
          .map((g) => ({ ...g, who: [c.people.indexOf(p)], why: `${num(g.plays)} plays · last ${label(g.last)}` }));
      },
    },
  };

  // ---------- the card ----------
  // ctx(): { people: [{ name, short, D, color, you }], period: { from, to, label, all } }
  function mount(el, ctx) {
    const st = { kind: null, person: 0, size: 50, name: '', named: false, list: [] };
    const avail = (c) => Object.entries(KINDS).filter(([, k]) => (k.group ? c.people.length > 1 : true) && (!k.needsYou || (c.people.some((p) => p.you) && c.people.length > 1)));
    function build() {
      const c = ctx();
      const kinds = avail(c);
      if (!kinds.some(([id]) => id === st.kind)) st.kind = kinds[0][0];
      const K = KINDS[st.kind];
      if (st.person >= c.people.length) st.person = 0;
      const p = c.people[st.person];
      st.list = K.make(c, st.size, p);
      if (!st.named) st.name = K.name(c, p).slice(0, 100);
      const sp = window.SpotifyAuth;
      el.innerHTML = `
        <div class="pl-head"><div><h2>Make a playlist</h2><p class="muted small">${esc(K.about)}${c.period.all ? '' : ` Period: ${esc(c.period.label)}.`}</p></div></div>
        <div class="pl-kinds" role="group" aria-label="Kind of playlist">${kinds.map(([id, k]) => `<button type="button" data-kind="${id}" aria-pressed="${id === st.kind}">${esc(k.label)}</button>`).join('')}</div>
        <div class="pl-opts">
          ${K.person && c.people.length > 1 ? `<label>For <select data-pl="person">${c.people.map((q, i) => `<option value="${i}"${i === st.person ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}</select></label>` : ''}
          <label>Songs <select data-pl="size">${SIZES.map((s) => `<option${s === st.size ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="pl-name">Name <input data-pl="name" maxlength="100" value="${esc(st.name)}"></label>
        </div>
        ${st.list.length ? `<ol class="pl-list">${st.list.map((g) => `<li><span class="pl-who">${g.who.map((i) => `<i style="background:${c.people[i].color}" title="${esc(c.people[i].name)}"></i>`).join('')}</span>
            <span class="pl-t"><b>${esc(g.title)}</b><span class="muted"> · ${esc(g.artist)}</span></span><span class="pl-why muted small">${esc(g.why)}</span></li>`).join('')}</ol>`
          : '<p class="muted small pl-empty">No songs fit this one. Try another kind, person or period.</p>'}
        <div class="pl-actions">
          <button class="primary" type="button" data-pl="save"${st.list.length ? '' : ' disabled'}>${spotifyIcon()} Save to Spotify</button>
          <button class="ghost" type="button" data-pl="copy"${st.list.length ? '' : ' disabled'}>Copy song links</button>
          <span class="muted small">${st.list.length} song${st.list.length === 1 ? '' : 's'}</span>
        </div>
        <p class="pl-status small" role="status"></p>
        ${!sp?.configured() ? '<p class="muted small">Saving to Spotify isn\'t set up on this site yet. Copy song links and paste them into a new playlist in the Spotify desktop app (⌘V / Ctrl+V).</p>'
          : !sp.canRedirect() && !sp.signedIn() ? '<p class="muted small">Spotify sign-in works when the site is opened from its web address. From a file, copy the song links and paste them into a Spotify playlist on desktop.</p>' : ''}`;
    }
    const say = (t, bad) => { const s = el.querySelector('.pl-status'); if (s) { s.textContent = t; s.classList.toggle('bad', !!bad); } };
    el.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-kind]');
      if (k) { st.kind = k.dataset.kind; st.named = false; build(); return; }
      const b = e.target.closest('[data-pl]');
      if (!b) return;
      if (b.dataset.pl === 'copy') {
        const text = st.list.map((g) => `https://open.spotify.com/track/${g.track}`).join('\n');
        try { await navigator.clipboard.writeText(text); say(`Copied ${st.list.length} links. In Spotify on desktop, make a playlist and paste.`); } catch { say("Couldn't copy. Your browser blocked the clipboard.", true); }
      }
      if (b.dataset.pl === 'save') {
        b.disabled = true; say('Saving to Spotify…');
        try {
          const r = await window.SpotifyAuth.save({ name: st.name || 'Spotify Stats playlist', description: 'Made with Spotify Stats', uris: st.list.map((g) => `spotify:track:${g.track}`) });
          say(''); toast(`Saved <b>${esc(r.name)}</b> to Spotify (${r.count} songs). <a href="${esc(r.url)}" target="_blank" rel="noopener">Open in Spotify</a>`);
        } catch (err) { say(err.message, true); }
        b.disabled = false;
      }
    });
    el.addEventListener('change', (e) => {
      const t = e.target.closest('[data-pl]');
      if (!t) return;
      if (t.dataset.pl === 'person') { st.person = +t.value; st.named = false; build(); }
      if (t.dataset.pl === 'size') { st.size = +t.value; build(); }
    });
    el.addEventListener('input', (e) => { if (e.target.dataset.pl === 'name') { st.name = e.target.value; st.named = true; } });
    build();
    return { refresh() { st.named = false; build(); } };
  }
  const spotifyIcon = () => '<svg class="sp-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M6.5 9.3c3.6-1.1 7.9-.8 11 1M7.2 12.4c3-.9 6.4-.6 9 .9M7.9 15.3c2.4-.6 4.9-.4 6.9.7" fill="none" stroke="var(--card)" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // a short message at the bottom of the page
  function toast(html, bad) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = bad ? 'bad' : '';
    t.innerHTML = `<span>${html}</span><button type="button" aria-label="Dismiss">×</button>`;
    t.hidden = false;
    t.querySelector('button').onclick = () => { t.hidden = true; };
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 12000);
  }
  // after coming back from Spotify's sign-in
  const r = window.SpotifyAuth?.takeResult();
  if (r) setTimeout(() => (r.ok
    ? toast(`Saved <b>${esc(r.name)}</b> to Spotify (${r.count} songs). <a href="${esc(r.url)}" target="_blank" rel="noopener">Open in Spotify</a>`)
    : toast(`Couldn't save ${r.name ? `<b>${esc(r.name)}</b>` : 'the playlist'}: ${esc(r.error)}`, true)), 300);

  return { mount, songStats, toast };
})();
