/* =========================================================
   matcher.js — the "smart" part: scoring lost ↔ found pairs
   ---------------------------------------------------------
   For every (lost item, found item) pair we compute six
   signals, each between 0 and 1:

     text      – do the titles/descriptions/tags talk about the same thing?  (TF-IDF + synonyms)
     category  – same category? related category?
     location  – how far apart on campus were they lost / found?
     time      – was it found soon AFTER it was lost?
     color     – same or similar colour?
     image     – do the photos look alike?  (AI model or colour histogram)

   Final score = weighted average of the signals that are
   available (missing photo? that signal is skipped and the
   weights are re-balanced). Then a few common-sense rules
   cap the score (e.g. an item can't be found days BEFORE
   it was lost).
   ========================================================= */

const WEIGHTS = { text: 0.30, category: 0.20, location: 0.15, time: 0.15, color: 0.10, image: 0.10 };
const WEIGHTS_WITH_PHOTOS = { text: 0.25, category: 0.15, location: 0.15, time: 0.10, color: 0.10, image: 0.25 };
const MIN_MATCH_SCORE = 0.40; // pairs below 40% are not shown

// ---------- 1. TEXT ------------------------------------------------------

const STOPWORDS = new Set(('a an the and or of in on at to for with from by is was it its my i me this that ' +
  'near some small big left lost found lying inside after before one two three any has have had ' +
  'there here our your his her their be been very also just').split(' '));

// Different words people use for the same thing → one common word
const SYNONYMS = {
  mobile: 'phone', smartphone: 'phone', cellphone: 'phone', iphone: 'phone', android: 'phone',
  earbud: 'earphone', airpod: 'earphone', airdope: 'earphone', headphone: 'earphone', headset: 'earphone', tws: 'earphone',
  adapter: 'charger', adaptor: 'charger', plug: 'charger',
  purse: 'wallet', pouch: 'wallet',
  flask: 'bottle', sipper: 'bottle', tumbler: 'bottle',
  backpack: 'bag', rucksack: 'bag', handbag: 'bag', sling: 'bag',
  spectacle: 'glasses', specs: 'glasses', goggle: 'glasses', sunglass: 'glasses',
  identity: 'id', idcard: 'id', card: 'id', lanyard: 'id',
  calci: 'calculator', metal: 'steel', stainless: 'steel',
  notebook: 'book', diary: 'book', textbook: 'book',
  jacket: 'hoodie', sweatshirt: 'hoodie', sweater: 'hoodie',
  key: 'key', keychain: 'key', keyring: 'key',
  laptop: 'laptop', macbook: 'laptop',
  watch: 'watch', smartwatch: 'watch',
  mouse: 'mouse', umbrella: 'umbrella',
};

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => SYNONYMS[w] || SYNONYMS[stem(w)] || stem(w));
}

function itemText(item) {
  // Title words count twice — titles are usually the most important words.
  return [item.title, item.title, item.brand, item.description,
    (item.tags || []).join(' '), (item.tags || []).join(' '), (item.aiTags || []).join(' ')].join(' ');
}

// IDF: words that appear in many reports ("bottle") matter less than rare ones ("milton").
function buildIdf(items) {
  const df = {};
  items.forEach((it) => {
    new Set(tokenize(itemText(it))).forEach((t) => { df[t] = (df[t] || 0) + 1; });
  });
  const N = items.length || 1;
  const idf = {};
  Object.keys(df).forEach((t) => { idf[t] = Math.log(1 + N / df[t]); });
  return idf;
}

function tfidfVector(item, idf) {
  const vec = {};
  tokenize(itemText(item)).forEach((t) => { vec[t] = (vec[t] || 0) + 1; });
  Object.keys(vec).forEach((t) => { vec[t] *= idf[t] || Math.log(2); });
  return vec;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
  for (const k in b) nb += b[k] * b[k];
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function sharedWords(a, b) {
  const sb = new Set(tokenize(itemText(b)));
  return [...new Set(tokenize(itemText(a)))].filter((t) => sb.has(t));
}

// Raw cosine of short texts rarely goes above ~0.6, so we stretch it a bit.
function textScore(a, b, idf) {
  const c = cosine(tfidfVector(a, idf), tfidfVector(b, idf));
  return Math.min(1, c * 1.6);
}

// ---------- 2. CATEGORY --------------------------------------------------

const RELATED_CATEGORIES = [
  ['Wallet & Money', 'ID & Cards', 0.6],
  ['Electronics', 'Accessories', 0.4],
  ['Bags', 'Other', 0.3],
  ['Clothing', 'Accessories', 0.3],
];

function categoryScore(a, b) {
  if (a.category === b.category) return 1;
  for (const [x, y, s] of RELATED_CATEGORIES) {
    if ((a.category === x && b.category === y) || (a.category === y && b.category === x)) return s;
  }
  if (a.category === 'Other' || b.category === 'Other') return 0.25;
  return 0;
}

// ---------- 3. LOCATION --------------------------------------------------

function locationPoint(name) {
  return LOCATIONS.find((l) => l.name === name) || { x: null, y: null };
}

function locationScore(a, b) {
  const p = locationPoint(a.location), q = locationPoint(b.location);
  if (p.x === null || q.x === null) return 0.5; // "not sure" → neutral
  const d = Math.hypot(p.x - q.x, p.y - q.y);
  return Math.max(0, 1 - d / 70);
}

// ---------- 4. TIME ------------------------------------------------------

function hoursBetween(lost, found) {
  return (new Date(found.date) - new Date(lost.date)) / 3600000;
}

function timeScore(lost, found) {
  const h = hoursBetween(lost, found);
  if (h < -24) return 0;         // found more than a day BEFORE it was lost → impossible
  if (h < 0) return 0.8;         // small mismatch → people misremember times
  return Math.exp(-h / (24 * 5)); // fades over ~5 days
}

// ---------- 5. COLOUR ----------------------------------------------------

const SIMILAR_COLORS = {
  Black: ['Grey'], Grey: ['Black', 'Silver', 'White'], Silver: ['Grey', 'White'],
  White: ['Silver', 'Grey'], Blue: ['Purple'], Red: ['Pink', 'Orange', 'Brown'],
  Pink: ['Red', 'Purple'], Orange: ['Red', 'Yellow'], Yellow: ['Orange', 'Gold'],
  Gold: ['Yellow', 'Brown'], Brown: ['Gold', 'Red'], Purple: ['Blue', 'Pink'], Green: [],
};

function colorScore(a, b) {
  if (!a.color || !b.color) return null; // unknown → skip this signal
  if (a.color === b.color) return 1;
  if (a.color === 'Multicolor' || b.color === 'Multicolor') return 0.5;
  if ((SIMILAR_COLORS[a.color] || []).includes(b.color)) return 0.5;
  return 0;
}

// ---------- 6. IMAGE -----------------------------------------------------
// ImageAI (image.js) gives us: a colour histogram for every photo, and —
// if the AI model loaded — a 1024-number "embedding" that describes what
// is IN the photo. Similar objects have similar embeddings.

function imageScore(a, b) {
  if (!a.image || !b.image) return null;
  const hs = ImageAI.histogramSimilarity(a.hist, b.hist);
  const es = ImageAI.embeddingSimilarity(a.id, b.id);
  if (es === null) return hs;
  return 0.7 * es + 0.3 * hs;
}

// ---------- Putting it together ------------------------------------------

function scorePair(lost, found, idf) {
  const s = {
    text: textScore(lost, found, idf),
    category: categoryScore(lost, found),
    location: locationScore(lost, found),
    time: timeScore(lost, found),
    color: colorScore(lost, found),
    image: imageScore(lost, found),
  };

  const weights = s.image !== null ? WEIGHTS_WITH_PHOTOS : WEIGHTS;
  let total = 0, wsum = 0;
  for (const k in weights) {
    if (s[k] === null) continue;
    total += weights[k] * s[k];
    wsum += weights[k];
  }
  let score = total / wsum;

  // "What is it?" matters most. Place, time and colour alone can't make a
  // match: if neither the words nor the photo agree, the score is halved.
  const content = Math.max(s.text, s.image || 0);
  score *= 0.5 + 0.5 * Math.min(1, content * 1.5);

  // Common-sense caps
  if (s.category === 0) score = Math.min(score, 0.35);  // totally different kind of item
  if (s.time === 0) score = Math.min(score, 0.30);      // found before it was lost

  return { score, signals: s, reasons: explain(lost, found, s) };
}

// Human-readable "why we think this matches"
function explain(lost, found, s) {
  const r = [];
  const words = sharedWords(lost, found);
  if (words.length) r.push({ good: true, text: `Both mention: ${words.slice(0, 6).join(', ')}` });
  else r.push({ good: false, text: 'Descriptions share no key words' });

  if (s.category === 1) r.push({ good: true, text: `Same category (${lost.category})` });
  else if (s.category > 0) r.push({ good: true, text: `Related categories (${lost.category} / ${found.category})` });
  else r.push({ good: false, text: `Different categories (${lost.category} / ${found.category})` });

  if (lost.location === found.location) r.push({ good: true, text: `Same place: ${lost.location}` });
  else if (s.location >= 0.6) r.push({ good: true, text: `Nearby: lost at ${lost.location}, found at ${found.location}` });
  else r.push({ good: false, text: `Far apart: ${lost.location} → ${found.location}` });

  const h = hoursBetween(lost, found);
  if (h < -24) r.push({ good: false, text: 'Found before it was reported lost' });
  else if (h < 0) r.push({ good: true, text: 'Found around the same time it was lost' });
  else r.push({ good: s.time > 0.4, text: `Found ${humanDuration(h)} after it was lost` });

  if (s.color === 1) r.push({ good: true, text: `Same colour (${lost.color})` });
  else if (s.color === 0.5) r.push({ good: true, text: `Similar colour (${lost.color} / ${found.color})` });
  else if (s.color === 0) r.push({ good: false, text: `Different colour (${lost.color} / ${found.color})` });

  if (s.image !== null) {
    r.push({ good: s.image >= 0.5, text: `Photos look ${Math.round(s.image * 100)}% alike` });
  }
  return r;
}

function humanDuration(h) {
  if (h < 1) return 'less than an hour';
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

// All suggested matches for one item, best first
function matchesFor(item, state) {
  const others = state.items.filter((o) => o.type !== item.type && o.status === 'active');
  const idf = buildIdf(state.items);
  const isDismissed = (l, f) => state.dismissed.some((d) => d.lostId === l && d.foundId === f);
  return others
    .map((o) => {
      const lost = item.type === 'lost' ? item : o;
      const found = item.type === 'found' ? item : o;
      return { lost, found, other: o, ...scorePair(lost, found, idf) };
    })
    .filter((m) => m.score >= MIN_MATCH_SCORE && !isDismissed(m.lost.id, m.found.id))
    .sort((x, y) => y.score - x.score);
}

// Every suggested pair on campus, best first
function allMatches(state) {
  const idf = buildIdf(state.items);
  const lostItems = state.items.filter((i) => i.type === 'lost' && i.status === 'active');
  const foundItems = state.items.filter((i) => i.type === 'found' && i.status === 'active');
  const out = [];
  lostItems.forEach((l) => foundItems.forEach((f) => {
    if (state.dismissed.some((d) => d.lostId === l.id && d.foundId === f.id)) return;
    const m = scorePair(l, f, idf);
    if (m.score >= MIN_MATCH_SCORE) out.push({ lost: l, found: f, ...m });
  }));
  return out.sort((x, y) => y.score - x.score);
}

function matchLabel(score) {
  if (score >= 0.75) return { text: 'Strong match', cls: 'strong' };
  if (score >= 0.6) return { text: 'Good match', cls: 'good' };
  return { text: 'Possible match', cls: 'possible' };
}

// ---------- Verifying ownership -----------------------------------------
// The finder can set a secret question (e.g. "What name is on the card?").
// We compare the claimant's answer with the finder's answer loosely, so
// "65 watt" still matches "65W".

function normalizeAnswer(s) {
  return (s || '').toLowerCase().replace(/watts?/g, 'w').replace(/[^a-z0-9]+/g, ' ').trim();
}

function answerSimilarity(given, expected) {
  const g = normalizeAnswer(given), e = normalizeAnswer(expected);
  if (!g || !e) return 0;
  if (g === e || g.replace(/ /g, '') === e.replace(/ /g, '')) return 1;
  if (g.length >= 3 && (g.includes(e) || e.includes(g))) return 0.9;
  const gt = new Set(tokenize(g)), et = new Set(tokenize(e));
  if (!et.size) return 0;
  let hit = 0;
  et.forEach((t) => { if (gt.has(t)) hit++; });
  return hit / et.size;
}

const ANSWER_PASS = 0.6;
