// Is this song title in English? Used by the guessing game (guess.js), which only asks about titles
// you could reasonably type. Made by tools/build_english.js: don't edit the long line by hand.
//
// A title passes when it is written in Latin letters and reads as English:
//  - any Japanese, Korean, Cyrillic… character in the title itself (not in a "(feat. …)" or "- Remix" tail) fails it;
//  - words that look like romanized Japanese ("Gurenge", "Kaikai Kitan") or are common Spanish / French /
//    German / Italian words ("el", "des", "und") count against it: it needs more than twice as many English words;
//  - names and made-up words ("Melatonin", "Bruhlovania") are neither here nor there.
// English words are checked against __WORDS__ common ones, packed into a Bloom filter.
window.EnglishTitle = (() => {
  const M = __M__, K = __K__;
  const BITS = Uint8Array.from(atob('__DATA__'), (c) => c.charCodeAt(0));
  const fnv = (s, seed) => { let h = seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const has = (w) => {
    const a = fnv(w, 2166136261), b = (fnv(w, 40503) | 1) >>> 0;
    for (let i = 0; i < K; i++) { const bit = (a + i * b) % M; if (!(BITS[bit >> 3] & (1 << (bit & 7)))) return false; }
    return true;
  };
  // "runnin'" → running, "goin" → going, "boys'" → boys, "dogs" → dog
  const isWord = (w) => {
    if (has(w)) return true;
    const b = w.replace(/in'$/, 'ing').replace(/'s$|s'$/, '').replace(/'/g, '');
    return has(b) || (b.endsWith('in') && has(`${b}g`)) || (b.endsWith('s') && has(b.slice(0, -1)));
  };
  // short words that are English and also Japanese particles or song syllables: they don't count either way
  const NEUTRAL = new Set('non no to ni wa na ga de o e mo ka ya wo he ne yo a i me so do go ha ho on an ai oh ah la da'.split(' '));
  const FOREIGN = new Set(('el los las del mi tu te que por para con una uno un es muy mas como loco loca poco vida amor corazon gente ' +
    'je le les des du une et est moi toi mon pas ce qui dans sur avec alors danse der das und ich ist nicht ein eine mein ' +
    'il gli che di het een os nao voce meu minha si se su mis tus nos').split(' '));
  // a word made only of Japanese syllables: ka, shi, tsu, kyo, n, doubled consonants, long vowels
  const ROMAJI = /^(?:(?:kk|ss|tt|pp|nn|mm)?(?:[kgnhbpmr][aiueo]|[sz][aueo]|sh[aiuo]|j[aiuo]|t[aeo]|ch[aiuo]|tsu|d[aeo]|fu|y[auo]|w[ao]|(?:ky|gy|ny|hy|by|py|my|ry)[auo])|[aiueo]|n(?![aiueoy]))+$/;
  const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // The title as you'd say it: without "(feat. X)", "[Remastered]", " - Radio Edit", "feat. X".
  const core = (raw) => {
    const t = String(raw).replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+[-–—]\s+.*$/, '').replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '').trim();
    return t || String(raw).trim();
  };
  // What two spellings of the same title share: letters and digits only, lower case, no accents.
  const key = (raw) => plain(core(raw).toLowerCase()).replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

  const cache = new Map();
  function is(raw) {
    let v = cache.get(raw);
    if (v !== undefined) return v;
    const c = core(raw);
    v = (() => {
      if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{M}\p{C}]/u.test(c)) return false; // another script
      const words = plain(c.toLowerCase()).replace(/[’`´]/g, "'").split(/[^a-z']+/).map((w) => w.replace(/^'+/, '')).filter((w) => /[a-z]/.test(w));
      if (!words.length) return true; // "1999", "505"
      let english = 0, against = 0;
      for (const w0 of words) {
        const w = w0.replace(/'+$/, '');
        if (w.length < 2 || NEUTRAL.has(w)) continue;
        if (FOREIGN.has(w)) against++;
        else if (isWord(w0) || isWord(w)) english++;
        else if (w.length > 2 && ROMAJI.test(w)) against++;
      }
      if (!against) return english > 0 || !/[À-ɏ]/.test(c); // accents and no English word: probably not English
      return english >= 2 * against + 1;
    })();
    cache.set(raw, v);
    return v;
  }
  return { is, core, key };
})();
