// Rebuilds web/english.js: the word filter the guessing game uses to keep only English song titles.
//   npm install wordlist-english && node tools/build_english.js
// The words (about 63,000 common English ones, SCOWL sizes 10-50) are packed into a Bloom filter,
// so the page ships ~125 KB instead of the whole list. A word that isn't English is mistaken for
// one about 3 times in 1,000, which is fine for this job.
const fs = require('fs'), path = require('path');
const wl = require('wordlist-english');
const EXTRA = `january february march april may june july august september october november december
monday tuesday wednesday thursday friday saturday sunday america american africa african asia asian europe european
japan japanese china chinese tokyo kyoto osaka paris london berlin rome roman italy italian spain spanish france french
germany german russia russian mexico mexican canada canadian india indian korea korean brazil cuba havana miami chicago
texas alaska hawaii ohio georgia carolina dakota montana nevada arizona california hollywood vegas atlanta houston dallas
boston brooklyn harlem manhattan jamaica panama arabia arabic egypt sahara santa claus jesus christ christmas halloween satan
mario luigi zelda pokemon pikachu minecraft nintendo naruto goku anime manga emoji ninja samurai karate sushi tsunami kimono
karaoke mona lisa maria mary anna hannah emily emma jane john james jack joe mike michael david daniel sam tom tommy billy
bobby johnny jimmy tony romeo juliet hamilton mozart beethoven chopin bach vivaldi ok okay yeah yea nah gonna wanna gotta
gimme lemme kinda outta gon ya yo em til till thru tho bout cuz cause aint dont cant wont im ive ill youre thats whats lets
intro outro interlude remix freestyle skit
aaron jackie keanu kanye yoko naomi mia nina tina gina rosa sara mimi coco nemo dora yoshi toto dana kobe pepe rico nico kiki gigi
momo bambi yoda oreo panini mama papa`.split(/\s+/);
const words = new Set(EXTRA);
for (const size of [10, 20, 35, 40, 50]) for (const k of ['english/', 'english/american/', 'english/british/']) for (const w of wl[k + size] || []) words.add(w.toLowerCase());

const BITS = 12, K = 8;
const m = Math.ceil((words.size * BITS) / 8) * 8, bytes = new Uint8Array(m / 8);
const fnv = (s, seed) => { let h = seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
for (const w of words) {
  const a = fnv(w, 2166136261), b = (fnv(w, 40503) | 1) >>> 0;
  for (let i = 0; i < K; i++) { const bit = (a + i * b) % m; bytes[bit >> 3] |= 1 << (bit & 7); }
}
const src = fs.readFileSync(path.join(__dirname, 'english.template.js'), 'utf8')
  .replace('__M__', m).replace('__K__', K).replace('__WORDS__', words.size).replace('__DATA__', Buffer.from(bytes).toString('base64'));
fs.writeFileSync(path.join(__dirname, '..', 'web', 'english.js'), src);
console.log(`${words.size} words -> web/english.js (${Math.round(src.length / 1024)} KB)`);
