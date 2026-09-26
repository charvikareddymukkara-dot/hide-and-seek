/* =========================================================
   data.js — campus settings, saved data, users, demo data
   ---------------------------------------------------------
   Everything the app "remembers" lives here. We store it in
   the browser's localStorage (a small built-in database that
   every browser has), so the app needs no server.
   ========================================================= */

// --- Campus places. x / y are rough positions on a 100x100 campus map.
//     The matcher uses them to judge how far apart two places are.
//     👉 Edit these names to match YOUR campus.
const LOCATIONS = [
  { name: 'Main Gate',        x: 50, y: 95 },
  { name: 'Bus Stop',         x: 62, y: 90 },
  { name: 'Parking Lot',      x: 35, y: 85 },
  { name: 'Admin Block',      x: 50, y: 70 },
  { name: 'Auditorium',       x: 22, y: 62 },
  { name: 'Canteen',          x: 65, y: 55 },
  { name: 'Mechanical Block', x: 85, y: 60 },
  { name: 'Library',          x: 42, y: 42 },
  { name: 'CSE Department',   x: 25, y: 32 },
  { name: 'ECE Department',   x: 75, y: 32 },
  { name: 'Sports Ground',    x: 10, y: 15 },
  { name: 'Boys Hostel',      x: 68, y: 10 },
  { name: 'Girls Hostel',     x: 90, y: 10 },
  { name: 'Other / Not sure', x: null, y: null },
];

// Public, staffed places where owner and finder can meet safely
const SAFE_SPOTS = [
  'Security Office (Main Gate)',
  'Library Front Desk',
  'Admin Block Reception',
  'Canteen Counter',
];

const CATEGORIES = [
  'Electronics', 'ID & Cards', 'Wallet & Money', 'Bags', 'Keys',
  'Bottles', 'Stationery & Books', 'Clothing', 'Accessories', 'Other',
];

// Line icons (SVG) — used instead of emojis. Each value is the inside of a
// 24x24 SVG drawn with strokes.
const ICONS = {
  // categories (shown when an item has no photo)
  'Electronics': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  'ID & Cards': '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h4M14 14h3"/>',
  'Wallet & Money': '<path d="M4 7V6a2 2 0 0 1 2-2h11v3"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  'Bags': '<path d="M6 9a6 6 0 0 1 12 0v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9 21v-5h6v5M9 5V3h6v2"/>',
  'Keys': '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M14.5 8.5l2 2"/>',
  'Bottles': '<path d="M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3z"/><path d="M8 12h8"/>',
  'Stationery & Books': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  'Clothing': '<path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3c0 2-2 3-4 3S8 5 8 3z"/>',
  'Accessories': '<circle cx="12" cy="12" r="6"/><path d="M9 6.8 10 2h4l1 4.8M9 17.2l1 4.8h4l1-4.8M12 9.5V12l1.8 1.2"/>',
  'Other': '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  // interface
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/>',
  device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/>',
  handshake: '<path d="M3 11l4-4 5 2 5-2 4 4-7 7a2 2 0 0 1-2.8 0z"/><path d="M12 9l-3 3"/>',
};

// <svg> for an icon name, e.g. ic('pin')
function ic(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.Other}</svg>`;
}

const COLORS = [
  'Black', 'White', 'Grey', 'Silver', 'Blue', 'Red', 'Green', 'Yellow',
  'Orange', 'Pink', 'Purple', 'Brown', 'Gold', 'Multicolor',
];

// Only campus email addresses can sign up.
// 👉 Change this to your college domain, e.g. /@nie\.ac\.in$/i
const CAMPUS_EMAIL = /@([a-z0-9-]+\.)*(edu|ac\.in|edu\.in)$/i;

// --- Storage -------------------------------------------------------------
const STORE_KEY = 'hide-and-seek-v2';

const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage blocked or corrupted: fall back to demo data */ }
    return null;
  },
  save(state) {
    // Shared online database switched on? (see cloud.js) → save there instead
    if (typeof Cloud !== 'undefined' && Cloud.enabled) return Cloud.write(state);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false; // usually "storage full" (too many big photos)
    }
  },
};

// Who is logged in on this device.
//  - localStorage keeps you logged in after closing the browser.
//  - sessionStorage is per browser TAB, so two tabs can be two different
//    students at the same time (great for demoing the chat).
const Session = (() => {
  let mem = null;
  const tryGet = (st) => { try { return st.getItem('hs-user'); } catch (e) { return null; } };
  const trySet = (st, v) => { try { v ? st.setItem('hs-user', v) : st.removeItem('hs-user'); } catch (e) {} };
  return {
    get() { return tryGet(sessionStorage) || tryGet(localStorage) || mem; },
    set(email) { mem = email; trySet(sessionStorage, email); trySet(localStorage, email); },
    clear() { mem = null; trySet(sessionStorage, null); trySet(localStorage, null); },
  };
})();

// Usernames: 3–20 characters, lowercase letters, numbers, dot or underscore
const USERNAME_RULE = /^[a-z0-9._]{3,20}$/;

// Passwords are never stored as-is, only as a scrambled "hash".
// (A real deployment would do this on a server — see Future Scope.)
function hashPassword(pw) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = 'hide&seek:' + pw;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// --- Demo data -----------------------------------------------------------
// Dates are relative to "now", so the demo always looks fresh.
function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

const DEMO_PASSWORD = 'demo123';

function demoState() {
  const pw = hashPassword(DEMO_PASSWORD);
  const users = [
    ['Priya', 'priya@campus.edu'], ['Arjun', 'arjun@campus.edu'], ['Rahul', 'rahul@campus.edu'],
    ['Sneha', 'sneha@campus.edu'], ['Ankit', 'ankit@campus.edu'], ['Meera', 'meera@campus.edu'],
    ['Karthik', 'karthik@campus.edu'], ['Divya', 'divya@campus.edu'], ['Rohan', 'rohan@campus.edu'],
    ['Campus Security', 'security@campus.edu'],
  ].map(([name, email]) => ({ name, username: email.split('@')[0], email, pw }));

  const base = { status: 'active', image: null, hist: null, aiTags: [], tags: [], brand: '', verifyQuestion: '', verifyAnswer: '' };
  const lost = (o) => ({ ...base, type: 'lost', createdAt: o.date, ...o });
  const found = (o) => ({ ...base, type: 'found', createdAt: o.date, ...o });

  const items = [
    lost({ id: 'L1', owner: 'priya@campus.edu', title: 'HP laptop charger', category: 'Electronics', color: 'Black', brand: 'HP',
      tags: ['charger', '65w'], description: '65W HP charger with round pin. Left it near the charging points on the 2nd floor.',
      location: 'Library', date: hoursAgo(50) }),
    lost({ id: 'L2', owner: 'arjun@campus.edu', title: 'Blue steel water bottle', category: 'Bottles', color: 'Blue', brand: 'Milton',
      tags: ['bottle', 'sticker'], description: '1 litre steel bottle with a cat sticker and a small dent near the cap.',
      location: 'Sports Ground', date: hoursAgo(26) }),
    lost({ id: 'L3', owner: 'rahul@campus.edu', title: 'College ID card', category: 'ID & Cards', color: 'Red',
      tags: ['id card', 'lanyard'], description: 'ID card on a red lanyard. 3rd year CSE student.',
      location: 'CSE Department', date: hoursAgo(75), status: 'active' }),
    lost({ id: 'L4', owner: 'sneha@campus.edu', title: 'boAt wireless earbuds', category: 'Electronics', color: 'Black', brand: 'boAt',
      tags: ['earbuds', 'airdopes'], description: 'Airdopes earbuds in a black charging case. Small scratch on the lid.',
      location: 'Canteen', date: hoursAgo(22) }),
    lost({ id: 'L5', owner: 'ankit@campus.edu', title: 'Brown leather wallet', category: 'Wallet & Money', color: 'Brown', brand: 'Woodland',
      tags: ['wallet', 'cash'], description: 'Brown wallet with some cash and my college ID inside.',
      location: 'Bus Stop', date: hoursAgo(98), status: 'matched' }),
    lost({ id: 'L6', owner: 'meera@campus.edu', title: 'Casio scientific calculator', category: 'Stationery & Books', color: 'Grey', brand: 'Casio',
      tags: ['calculator', 'exam'], description: 'fx-991ES calculator, forgot it after the exam in room 204.',
      location: 'Admin Block', date: hoursAgo(20) }),

    found({ id: 'F1', owner: 'rohan@campus.edu', title: 'Laptop adapter found', category: 'Electronics', color: 'Black', brand: 'HP',
      tags: ['charger', 'adapter'], description: 'Black HP adapter lying on a table near the charging sockets, second floor.',
      location: 'Library', date: hoursAgo(30),
      verifyQuestion: 'What wattage is written on the adapter?', verifyAnswer: '65W' }),
    found({ id: 'F2', owner: 'karthik@campus.edu', title: 'Steel bottle with sticker', category: 'Bottles', color: 'Blue',
      tags: ['bottle', 'flask'], description: 'Blue metal flask with a cat sticker, found on the bench near the football field.',
      location: 'Sports Ground', date: hoursAgo(12),
      verifyQuestion: 'Describe any mark or damage on the bottle.', verifyAnswer: 'dent near the cap' }),
    found({ id: 'F3', owner: 'divya@campus.edu', title: 'ID card with lanyard', category: 'ID & Cards', color: 'Red',
      tags: ['id card'], description: 'College identity card on a red lanyard, found in the corridor.',
      location: 'Library', date: hoursAgo(60),
      verifyQuestion: 'What name is printed on the card?', verifyAnswer: 'Rahul' }),
    found({ id: 'F4', owner: 'karthik@campus.edu', title: 'Earphones charging case', category: 'Electronics', color: 'Black', brand: 'boAt',
      tags: ['earphones'], description: 'Black earphone case with white buds inside. Left on a canteen table.',
      location: 'Canteen', date: hoursAgo(18),
      verifyQuestion: 'Is there any mark on the case?', verifyAnswer: 'scratch on the lid' }),
    found({ id: 'F5', owner: 'rohan@campus.edu', title: 'Black umbrella', category: 'Other', color: 'Black',
      tags: ['umbrella'], description: 'Foldable black umbrella left on a seat.',
      location: 'Auditorium', date: hoursAgo(24) }),
    found({ id: 'F6', owner: 'security@campus.edu', title: 'Calculator in exam hall', category: 'Stationery & Books', color: 'Grey', brand: 'Casio',
      tags: ['calculator'], description: 'Casio calculator left behind in room 204 after the exam.',
      location: 'Admin Block', date: hoursAgo(16),
      verifyQuestion: 'What model is the calculator?', verifyAnswer: 'fx-991ES' }),
    found({ id: 'F7', owner: 'security@campus.edu', title: 'Purse near bus stop', category: 'Wallet & Money', color: 'Brown',
      tags: ['wallet', 'purse'], description: 'Brown leather purse with some cash, found on the ground.',
      location: 'Bus Stop', date: hoursAgo(80), status: 'matched',
      verifyQuestion: 'Whose name is on the ID inside?', verifyAnswer: 'Ankit' }),
    found({ id: 'F8', owner: 'divya@campus.edu', title: 'Plastic water bottle', category: 'Bottles', color: 'Blue', brand: 'Tupperware',
      tags: ['bottle'], description: 'Blue plastic bottle found in the common room.',
      location: 'Girls Hostel', date: hoursAgo(40) }),
    found({ id: 'F9', owner: 'security@campus.edu', title: 'Bunch of keys', category: 'Keys', color: 'Silver',
      tags: ['keys', 'keychain'], description: 'Three keys on a ring with a small football keychain.',
      location: 'Parking Lot', date: hoursAgo(10),
      verifyQuestion: 'Describe the keychain.', verifyAnswer: 'football' }),
  ];

  const claims = [
    { id: 'C1', lostId: 'L5', foundId: 'F7', answer: 'Ankit', status: 'verified', createdAt: hoursAgo(6),
      messages: [
        { from: 'system', text: 'Ownership verified ✓ This chat is private. Phone numbers and emails are hidden automatically.', at: hoursAgo(6) },
        { from: 'finder', text: 'Hi! Your wallet is safe with us at the security office.', at: hoursAgo(5.8) },
        { from: 'owner', text: 'Thank you so much!! When can I collect it?', at: hoursAgo(5.5) },
        { from: 'finder', type: 'meetup', place: 'Security Office (Main Gate)', time: new Date(Date.now() + 20 * 3600000).toISOString(), status: 'proposed', text: '', at: hoursAgo(5.4) },
      ] },
    { id: 'C2', lostId: 'L3', foundId: 'F3', answer: 'R. Sharma, CSE 3rd year', status: 'pending', createdAt: hoursAgo(3), messages: [] },
  ];

  return { users, items, claims, dismissed: [], seen: {}, lastRead: {} };
}
