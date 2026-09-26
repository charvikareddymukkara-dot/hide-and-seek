/* =========================================================
   cloud.js — shared online database (Firebase Firestore)
   ---------------------------------------------------------
   Without this, every browser keeps its OWN copy of the data,
   so people on different phones can't see each other's reports.

   With it, all reports, users and chats live in one online
   database, and every open copy of the app updates LIVE when
   anyone changes something.

   👉 To switch it on: paste your Firebase config below
      (see README → "Turn on the shared database").
      Leave it as null to keep everything on this device only.
   ========================================================= */

const FIREBASE_CONFIG = null;

/* It will look like this (with your own values):
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "hide-and-seek-xxxx.firebaseapp.com",
  projectId: "hide-and-seek-xxxx",
  storageBucket: "hide-and-seek-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
*/

const Cloud = (() => {
  let db = null;
  let enabled = false;
  let ready = false;
  let onChange = () => {};

  // Our app keeps one big "state" object. In the database it's split into
  // collections (like tables): users, items, claims, and one "meta" doc.
  const COLLECTIONS = {
    users: (s) => s.users.map((u) => [u.email, u]),
    items: (s) => s.items.map((i) => [i.id, i]),
    claims: (s) => s.claims.map((c) => [c.id, c]),
    meta: (s) => [['main', { dismissed: s.dismissed, seen: s.seen, lastRead: s.lastRead }]],
  };
  const received = { users: null, items: null, claims: null, meta: null };
  const lastKnown = {}; // "collection/id" → JSON of what the database has

  // JSON with keys sorted, so the same data always gives the same text
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  function assemble() {
    const m = (received.meta && received.meta[0]) || {};
    return {
      users: received.users, items: received.items, claims: received.claims,
      dismissed: m.dismissed || [], seen: m.seen || {}, lastRead: m.lastRead || {},
    };
  }

  function init(callback) {
    onChange = callback;
    if (!FIREBASE_CONFIG) return false;
    if (typeof firebase === 'undefined') {
      console.warn('Firebase library could not load, so data is saved on this device only.');
      return false;
    }
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
    } catch (e) {
      console.warn('Firebase setup failed:', e);
      return false;
    }
    enabled = true;

    // Listen to every collection. Firestore calls us again whenever anyone,
    // on any device, changes something.
    Object.keys(received).forEach((col) => {
      db.collection(col).onSnapshot((snap) => {
        received[col] = snap.docs.map((d) => d.data());
        Object.keys(lastKnown).filter((k) => k.startsWith(col + '/')).forEach((k) => delete lastKnown[k]);
        snap.docs.forEach((d) => { lastKnown[col + '/' + d.id] = stable(d.data()); });

        if (Object.values(received).some((v) => v === null)) return; // still loading
        ready = true;
        onChange(assemble());
      }, (err) => {
        console.error(err);
        onChange(null, err);
      });
    });
    return true;
  }

  // Save: only send documents that actually changed, delete removed ones.
  function write(state) {
    if (!enabled) return false;
    if (!ready) return true; // don't overwrite the database before we've read it
    const batch = db.batch();
    let changes = 0;
    for (const col in COLLECTIONS) {
      const ids = new Set();
      COLLECTIONS[col](state).forEach(([id, obj]) => {
        id = String(id);
        ids.add(id);
        const clean = JSON.parse(JSON.stringify(obj)); // drops "undefined" values Firestore dislikes
        const json = stable(clean);
        if (lastKnown[col + '/' + id] !== json) {
          batch.set(db.collection(col).doc(id), clean);
          lastKnown[col + '/' + id] = json;
          changes++;
        }
      });
      Object.keys(lastKnown).filter((k) => k.startsWith(col + '/')).forEach((k) => {
        const id = k.slice(col.length + 1);
        if (!ids.has(id)) { batch.delete(db.collection(col).doc(id)); delete lastKnown[k]; changes++; }
      });
    }
    if (changes) batch.commit().catch((e) => { console.error(e); onChange(null, e); });
    return true;
  }

  return {
    init, write,
    get enabled() { return enabled; },
    get ready() { return ready; },
  };
})();
