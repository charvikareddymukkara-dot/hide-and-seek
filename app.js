/* =========================================================
   app.js — the pages you see and what happens when you click
   ---------------------------------------------------------
   The app is a "single-page app": there is only one HTML page,
   and we swap what's inside <main id="app"> depending on the
   part of the URL after the # (e.g.  #/browse,  #/item/L1).

   Flow:  Report → Automated matching → "This is my item"
          → ownership question → Matched → masked chat
          → safe meetup on campus → Resolved
   ========================================================= */

// Where the data comes from:
//  - Shared online database (if switched on in cloud.js): everyone sees the same data
//  - Otherwise: this browser's own storage
const EMPTY_STATE = { users: [], items: [], claims: [], dismissed: [], seen: {}, lastRead: {} };
let state;
const usingCloud = Cloud.init((newState, err) => {
  if (err) { toast('Database problem: ' + (err.code || err.message), true); return; }
  state = newState;
  onExternalChange();
});
if (usingCloud) state = { ...EMPTY_STATE };
else { state = Store.load() || demoState(); Store.save(state); }

const $app = document.getElementById('app');

// ---------- small helpers ------------------------------------------------

// Never put user text straight into HTML — escape it first (stops people
// from injecting scripts through a description box).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function save() {
  if (!Store.save(state)) {
    toast('Browser storage is full. Try a smaller photo, or reset the demo data.', true);
    return false;
  }
  return true;
}

function me() { return state.users.find((u) => u.email === Session.get()) || null; }
function findItem(id) { return state.items.find((i) => i.id === id); }
function userName(email) { const u = state.users.find((x) => x.email === email); return u ? u.name : 'A student'; }
function isMine(item) { const u = me(); return !!u && item.owner === u.email; }

// In a claim, am I the owner (lost the item) or the finder?
function roleIn(c) {
  const u = me(); if (!u) return null;
  const lost = findItem(c.lostId), found = findItem(c.foundId);
  if (lost && lost.owner === u.email) return 'owner';
  if (found && found.owner === u.email) return 'finder';
  return null;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function timeAgo(iso) {
  const h = (Date.now() - new Date(iso)) / 3600000;
  if (h < 1 / 60) return 'just now';
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function thumb(item, cls = 'thumb') {
  if (item.image) return `<img class="${cls}" src="${item.image}" alt="${esc(item.title)}">`;
  return `<div class="${cls} thumb-icon">${ic(item.category)}</div>`;
}

function typeBadge(item) {
  return `<span class="badge badge-${item.type}">${item.type === 'lost' ? 'Lost' : 'Found'}</span>`;
}

const STATUS_TEXT = { active: 'Active', matched: 'Matched', resolved: 'Resolved ✓' };
function statusBadge(item) {
  return `<span class="badge status-${item.status}">${STATUS_TEXT[item.status]}</span>`;
}

function itemCard(item) {
  return `
    <a class="card item-card" href="#/item/${item.id}">
      ${thumb(item)}
      <div class="item-card-body">
        <div class="row gap-s">${typeBadge(item)} ${statusBadge(item)} ${isMine(item) ? '<span class="badge badge-you">You</span>' : ''}</div>
        <h3>${esc(item.title)}</h3>
        <p class="muted small">${ic('pin')} ${esc(item.location)} · ${timeAgo(item.date)}</p>
      </div>
    </a>`;
}

function scoreRing(score) {
  const pct = Math.round(score * 100);
  const lab = matchLabel(score);
  return `<div class="ring ring-${lab.cls}" style="--p:${pct}" title="Matching probability"><span>${pct}%</span></div>`;
}

const SIGNAL_NAMES = { text: 'Keywords & tags', category: 'Category', location: 'Location', time: 'Time', color: 'Colour', image: 'Photo' };

function signalBars(signals) {
  return `<div class="signals">` + Object.keys(SIGNAL_NAMES).map((k) => {
    const v = signals[k];
    if (v === null) return `<div class="sig"><span>${SIGNAL_NAMES[k]}</span><div class="bar na"></div><em>n/a</em></div>`;
    const pct = Math.round(v * 100);
    return `<div class="sig"><span>${SIGNAL_NAMES[k]}</span><div class="bar"><i style="width:${pct}%"></i></div><em>${pct}%</em></div>`;
  }).join('') + `</div>`;
}

function reasonsList(reasons) {
  return `<ul class="reasons">${reasons.map((r) => `<li class="${r.good ? 'ok' : 'no'}">${esc(r.text)}</li>`).join('')}</ul>`;
}

function claimFor(lostId, foundId) {
  return state.claims.find((c) => c.lostId === lostId && c.foundId === foundId && c.status !== 'rejected');
}

function parseTags(s) {
  return [...new Set((s || '').split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}

let toastTimer;
function toast(msg, warn = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 4000);
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }

// ---------- masked chat --------------------------------------------------
// Phone numbers and emails typed in the chat are hidden automatically,
// so students never have to share personal contact details.
function maskContacts(text) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden]')
    .replace(/(\+?\d[\d\s-]{6,}\d)/g, '[number hidden]')
    .replace(/(instagram|insta|whatsapp|telegram|snap(chat)?)\s*[:@-]?\s*@?\w+/gi, '[contact hidden]');
}

// ---------- notifications ------------------------------------------------

function notifications() {
  const u = me(); if (!u) return [];
  const out = [];
  // someone claimed an item I found → I need to review
  state.claims.filter((c) => c.status === 'pending').forEach((c) => {
    const f = findItem(c.foundId);
    if (f && f.owner === u.email) out.push({ icon: 'user', text: `Someone says "${f.title}" is theirs. Review their answer.`, href: '#/item/' + f.id });
  });
  // unread chat messages
  state.claims.filter((c) => c.status === 'verified' || c.status === 'resolved').forEach((c) => {
    const role = roleIn(c); if (!role) return;
    const last = state.lastRead[u.email + '|' + c.id] || '';
    const n = c.messages.filter((m) => m.from !== role && m.from !== 'system' && m.at > last).length;
    if (n) out.push({ icon: 'chat', text: `${n} new message${n > 1 ? 's' : ''} about "${findItem(c.lostId).title}"`, href: '#/chat/' + c.id });
  });
  // new automatic matches for my active reports
  state.items.filter((i) => i.owner === u.email && i.status === 'active').forEach((i) => {
    const seen = state.seen[u.email + '|' + i.id] || [];
    const fresh = matchesFor(i, state).filter((m) => !seen.includes(m.other.id));
    if (fresh.length) out.push({ icon: 'target', text: `${fresh.length} new possible match${fresh.length > 1 ? 'es' : ''} for your "${i.title}"`, href: '#/item/' + i.id });
  });
  return out;
}

function renderHeader() {
  const u = me();
  document.getElementById('mainNav').classList.toggle('hidden', !u);
  const area = document.getElementById('userArea');
  if (!u) { area.innerHTML = ''; return; }
  const notes = notifications();
  area.innerHTML = `
    <div class="bell-wrap">
      <button class="icon-btn" id="bellBtn" aria-label="Notifications">${ic('bell')}${notes.length ? `<b class="dot">${notes.length}</b>` : ''}</button>
      <div class="bell-panel" id="bellPanel">
        <h4>Notifications</h4>
        ${notes.length ? notes.map((n) => `<a href="${n.href}">${ic(n.icon)} ${esc(n.text)}</a>`).join('') : '<p class="muted small">You’re all caught up.</p>'}
      </div>
    </div>
    <div class="user-chip" title="${esc(u.email)}"><span class="avatar">${esc(u.name[0].toUpperCase())}</span><span class="uname">${esc(u.name)}${u.username ? `<small>@${esc(u.username)}</small>` : ''}</span></div>
    <button class="icon-btn" id="logoutBtn" title="Log out">${ic('logout')}</button>`;
}

// ---------- campus radar -------------------------------------------------
// The spinning radar on the home & login pages. Each blip is a REAL active
// report, placed where it was lost/found on the campus map.
function radarHtml(showTitles = true) {
  const live = state.items.filter((i) => i.status === 'active').slice(-12);
  const blips = live.map((i, k) => {
    const p = LOCATIONS.find((l) => l.name === i.location) || {};
    let x = p.x ?? 50, y = p.y ?? 50;
    x += ((k * 37) % 11) - 5; y += ((k * 53) % 11) - 5;          // small spread so blips don't overlap
    const u = (x - 50) / 50, v = (y - 50) / 50;                   // square campus map → round radar
    const cx = 50 + 38 * u * Math.sqrt(Math.max(0, 1 - (v * v) / 2));
    const cy = 50 + 38 * v * Math.sqrt(Math.max(0, 1 - (u * u) / 2));
    return `<span class="blip ${i.type}" style="left:${cx.toFixed(1)}%;top:${cy.toFixed(1)}%;animation-delay:${((k * 0.55) % 4).toFixed(2)}s"
      ${showTitles ? `title="${esc((i.type === 'lost' ? 'Lost: ' : 'Found: ') + i.title)}"` : ''}></span>`;
  }).join('');
  return `
    <div class="radar-wrap">
      <div class="radar" aria-hidden="true">
        <div class="radar-ring r1"></div><div class="radar-ring r2"></div><div class="radar-ring r3"></div>
        <div class="radar-sweep"></div>${blips}<div class="radar-center">🙈</div>
      </div>
      <div class="radar-legend"><span><i style="background:#e879f9"></i>lost</span><span><i style="background:#fff"></i>found</span><span>live campus radar</span></div>
    </div>`;
}

// Numbers on the home page count up from 0
function countUp() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = +el.dataset.count;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / 900);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---------- pages --------------------------------------------------------

function pageLogin(params) {
  const mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  const demo = [
    ['priya', 'Priya', 'lost a laptop charger'],
    ['rohan', 'Rohan', 'found that charger'],
    ['ankit', 'Ankit', 'has an open chat'],
    ['divya', 'Divya', 'has a claim to review'],
  ];
  return `
    <section class="login-wrap">
      <div class="login-hero">
        <h1>Hide-and-Seek</h1>
        <p class="muted">Your campus lost &amp; found. Things aren’t lost, <span class="grad"><b>they’re just hiding</b></span>. We help you seek them.</p>
        ${radarHtml(false)}
      </div>
      <div class="card login-card">
        <div class="seg">
          <a href="#/login" class="${mode === 'login' ? 'on' : ''}">Log in</a>
          <a href="#/login?mode=signup" class="${mode === 'signup' ? 'on' : ''}">Sign up</a>
        </div>
        <form id="authForm" data-mode="${mode}" novalidate>
          ${mode === 'signup' ? `
          <div class="field"><label>Full name</label><input name="name" maxlength="40" autocomplete="name"></div>
          <div class="field"><label>Username</label><input name="username" maxlength="20" placeholder="e.g. lekhya_r" autocomplete="username" autocapitalize="none"></div>
          <div class="field"><label>Campus email</label><input name="email" type="email" placeholder="you@college.edu" autocomplete="email"></div>`
          : `<div class="field"><label>Username or campus email</label><input name="login" placeholder="e.g. priya" autocomplete="username" autocapitalize="none"></div>`}
          <div class="field"><label>Password</label><input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></div>
          <div id="authError" class="error hidden"></div>
          <button class="btn wide" type="submit">${mode === 'signup' ? 'Create account' : 'Log in'}</button>
        </form>
        <p class="muted small center">Only campus emails (.edu / .ac.in) can join.</p>
        <div class="demo-box">
          <p class="small"><b>Demo accounts</b> <span class="muted">(password: ${DEMO_PASSWORD})</span></p>
          ${demo.map(([e, n, d]) => `<button class="demo-btn" data-demo="${e}"><b>${n}</b> <span class="muted">@${e} · ${d}</span></button>`).join('')}
        </div>
      </div>
    </section>`;
}

function pageHome() {
  const u = me();
  const active = (t) => state.items.filter((i) => i.type === t && i.status === 'active').length;
  const matches = allMatches(state).length;
  const resolved = state.items.filter((i) => i.type === 'lost' && i.status === 'resolved').length;
  const recent = [...state.items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const notes = notifications();

  return `
    <section class="hero hero-grid">
      <div>
        <p class="eyebrow">Hi ${esc(u.name)}</p>
        <h1>Lost something on campus?<br><span>It’s just hiding. Let’s seek it.</span></h1>
        <p>Report what you lost or found. We compare keywords, tags, photo, place and time of every report
           and show a matching probability for each likely pair.</p>
        <div class="row gap">
          <a class="btn btn-lost" href="#/report/lost">I lost something</a>
          <a class="btn btn-found" href="#/report/found">I found something</a>
        </div>
      </div>
      ${radarHtml()}
    </section>

    <section class="steps">
      <div class="step"><em>1</em><b>${ic('camera')}</b><span>Report it with a photo</span></div>
      <div class="step"><em>2</em><b>${ic('target')}</b><span>We match it automatically</span></div>
      <div class="step"><em>3</em><b>${ic('lock')}</b><span>Prove it’s yours</span></div>
      <div class="step"><em>4</em><b>${ic('chat')}</b><span>Chat &amp; meet safely</span></div>
    </section>

    ${notes.length ? `<section class="card inbox"><h2>Needs your attention</h2>${notes.map((n) => `<a href="${n.href}">${ic(n.icon)} ${esc(n.text)} →</a>`).join('')}</section>` : ''}

    <section class="stats">
      <div class="stat"><b data-count="${active('lost')}">0</b><span>items still hiding</span></div>
      <div class="stat"><b data-count="${active('found')}">0</b><span>found items waiting</span></div>
      <div class="stat"><b data-count="${matches}">0</b><span>suggested matches</span></div>
      <div class="stat"><b data-count="${resolved}">0</b><span>items back with owners</span></div>
    </section>

    <section>
      <div class="row between"><h2>Recent reports</h2><a href="#/browse">See all →</a></div>
      <div class="grid">${recent.map(itemCard).join('')}</div>
    </section>`;
}

let pendingPhoto = null;   // result of analysing a newly chosen photo
let removePhoto = false;   // edit mode: user clicked "remove photo"

function pageReport(type, editItem) {
  pendingPhoto = null; removePhoto = false;
  const it = editItem || {};
  const isLost = type === 'lost';
  const opt = (arr, placeholder, sel) => `<option value="">${placeholder}</option>` + arr.map((v) => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const photoHtml = it.image
    ? `<img src="${it.image}" alt="current photo"><br><span class="muted small">Click to change photo</span>`
    : `<span class="big">${ic('camera')}</span><br>Add a photo <span class="muted">(optional, but helps matching)</span>`;
  return `
    <section class="form-wrap card">
      ${editItem ? `<a href="#/item/${it.id}" class="muted small">← Back to report</a>` : `
      <div class="seg">
        <a href="#/report/lost" class="${isLost ? 'on lost' : ''}">I lost something</a>
        <a href="#/report/found" class="${!isLost ? 'on found' : ''}">I found something</a>
      </div>`}
      <h1>${editItem ? 'Edit your report' : isLost ? 'Report a lost item' : 'Report a found item'}</h1>
      <p class="muted">${isLost
        ? 'The more detail you give, the better we can match it.'
        : 'Thank you for helping! Add a secret question so only the real owner can claim it.'}</p>

      <form id="reportForm" data-type="${type}" data-edit="${editItem ? it.id : ''}" novalidate>
        <label class="photo-drop" id="photoDrop">
          <input type="file" id="photo" accept="image/*" hidden>
          <div id="photoPreview">${photoHtml}</div>
        </label>
        ${it.image ? '<button type="button" class="link-btn" id="removePhoto">Remove photo</button>' : ''}
        <div id="aiNote" class="ai-note hidden"></div>

        <div class="field"><label>Item name *</label>
          <input name="title" required maxlength="80" value="${esc(it.title)}" placeholder="${isLost ? 'e.g. Blue steel water bottle' : 'e.g. Water bottle found near canteen'}"></div>

        <div class="two">
          <div class="field"><label>Category *</label><select name="category" required>${opt(CATEGORIES, 'Choose…', it.category)}</select></div>
          <div class="field"><label>Colour</label><select name="color">${opt(COLORS, 'Not sure', it.color)}</select></div>
        </div>

        <div class="two">
          <div class="field"><label>Brand / model</label><input name="brand" maxlength="40" value="${esc(it.brand)}" placeholder="e.g. Milton, HP, boAt"></div>
          <div class="field"><label>Tags</label><input name="tags" maxlength="100" value="${esc((it.tags || []).join(', '))}" placeholder="e.g. bottle, sticker, steel"></div>
        </div>

        <div class="field"><label>Item description *</label>
          <textarea name="description" required rows="3" maxlength="500" placeholder="Stickers, scratches, what's inside, anything unique…">${esc(it.description)}</textarea></div>

        <div class="two">
          <div class="field"><label>${isLost ? 'Where did you lose it?' : 'Where did you find it?'} *</label>
            <select name="location" required>${opt(LOCATIONS.map((l) => l.name), 'Choose…', it.location)}</select></div>
          <div class="field"><label>${isLost ? 'When (roughly)?' : 'When?'} *</label>
            <input type="datetime-local" name="date" required value="${toLocalInputValue(it.date ? new Date(it.date) : new Date())}" max="${toLocalInputValue(new Date(Date.now() + 60000))}"></div>
        </div>

        ${!isLost ? `
        <fieldset class="secret">
          <legend>${ic('lock')} Ownership check</legend>
          <p class="muted small">Ask something only the owner would know. The answer stays hidden.</p>
          <div class="field"><label>Question</label><input name="verifyQuestion" maxlength="120" value="${esc(it.verifyQuestion)}" placeholder="e.g. What name is written on the card?"></div>
          <div class="field"><label>Answer</label><input name="verifyAnswer" maxlength="80" value="${esc(it.verifyAnswer)}" placeholder="e.g. Rahul"></div>
        </fieldset>` : ''}

        <p class="muted small">${ic('shield')} No phone number needed. When there’s a match, you’ll talk through a private chat and meet at a safe spot on campus.</p>

        <div id="formError" class="error hidden"></div>
        <button class="btn ${isLost ? 'btn-lost' : 'btn-found'} wide" type="submit">${editItem ? 'Save changes' : 'Submit report & find matches'}</button>
      </form>
    </section>`;
}

function pageBrowse(params) {
  const q = (params.get('q') || '').toLowerCase();
  const type = params.get('type') || 'all';
  const cat = params.get('cat') || '';
  const status = params.get('status') || 'active';

  const list = state.items.filter((i) =>
    (type === 'all' || i.type === type) &&
    (!cat || i.category === cat) &&
    (status === 'all' || i.status === status) &&
    (!q || [i.title, i.description, i.brand, i.location, i.color, (i.tags || []).join(' ')].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const link = (t) => `#/browse?type=${t}&cat=${encodeURIComponent(cat)}&status=${status}&q=${encodeURIComponent(q)}`;
  return `
    <section>
      <h1>All reports</h1>
      <div class="filters">
        <div class="seg small-seg">
          <a href="${link('all')}" class="${type === 'all' ? 'on' : ''}">All</a>
          <a href="${link('lost')}" class="${type === 'lost' ? 'on lost' : ''}">Lost</a>
          <a href="${link('found')}" class="${type === 'found' ? 'on found' : ''}">Found</a>
        </div>
        <input id="search" type="search" placeholder="Search… e.g. bottle, library" value="${esc(q)}">
        <select id="catFilter"><option value="">All categories</option>${CATEGORIES.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="statusFilter">
          ${[['active', 'Active'], ['matched', 'Matched'], ['resolved', 'Resolved'], ['all', 'Any status']].map(([v, l]) => `<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${list.length ? `<div class="grid">${list.map(itemCard).join('')}</div>` : '<p class="empty">Nothing here.</p>'}
    </section>`;
}

function matchPairCard(m) {
  const lab = matchLabel(m.score);
  return `
    <div class="card pair">
      <a class="pair-side" href="#/item/${m.lost.id}">${thumb(m.lost, 'thumb-s')}<div>${typeBadge(m.lost)}<b>${esc(m.lost.title)}</b><span class="muted small">${esc(m.lost.location)}</span></div></a>
      <div class="pair-mid">${scoreRing(m.score)}<span class="lab lab-${lab.cls}">${lab.text}</span></div>
      <a class="pair-side" href="#/item/${m.found.id}">${thumb(m.found, 'thumb-s')}<div>${typeBadge(m.found)}<b>${esc(m.found.title)}</b><span class="muted small">${esc(m.found.location)}</span></div></a>
    </div>`;
}

function pageMatches() {
  const list = allMatches(state);
  return `
    <section>
      <h1>Suggested matches</h1>
      <p class="muted">Every active lost report is compared with every active found report. Pairs with a matching probability of 40% or more appear here, best first.
        <a href="#/how">How does matching work?</a></p>
      ${list.length ? list.map(matchPairCard).join('') : '<p class="empty">No matches right now.</p>'}
    </section>`;
}

function pageMine() {
  const u = me();
  const mine = state.items.filter((i) => i.owner === u.email).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const chats = state.claims.filter((c) => roleIn(c) && (c.status === 'verified' || c.status === 'resolved'));
  const row = (i) => `
    <div class="card mine-row">
      <a href="#/item/${i.id}">${thumb(i, 'thumb-s')}</a>
      <div class="grow"><div class="row gap-s">${typeBadge(i)} ${statusBadge(i)}</div>
        <a href="#/item/${i.id}"><b>${esc(i.title)}</b></a>
        <p class="muted small">${ic('pin')} ${esc(i.location)} · reported ${timeAgo(i.createdAt)}</p></div>
      <div class="row gap-s">
        ${i.status === 'active' ? `<a class="btn ghost sm" href="#/edit/${i.id}">${ic('edit')} Edit</a>` : ''}
        <button class="btn ghost sm danger" data-act="delete" data-id="${i.id}">${ic('trash')} Delete</button>
      </div>
    </div>`;
  return `
    <section>
      <h1>My reports</h1>
      ${mine.length ? mine.map(row).join('') : '<p class="empty">You haven’t reported anything yet. <a href="#/report/lost">Report a lost item</a> or <a href="#/report/found">a found one</a>.</p>'}
      <h2>My chats</h2>
      ${chats.length ? chats.map((c) => {
        const lost = findItem(c.lostId);
        const last = c.messages[c.messages.length - 1];
        return `<a class="card chat-row" href="#/chat/${c.id}">${thumb(lost, 'thumb-s')}<div class="grow"><b>${esc(lost.title)}</b>
          <p class="muted small">You are the ${roleIn(c)} · ${last ? timeAgo(last.at) : ''}</p></div>${ic('chat', 'big-ic')}</a>`;
      }).join('') : '<p class="empty">Chats open here once an owner is verified.</p>'}
    </section>`;
}

function pageItem(id) {
  const item = findItem(id);
  if (!item) return `<p class="empty">This report doesn't exist (maybe it was deleted). <a href="#/">Go home</a></p>`;
  const u = me();
  const mine = isMine(item);
  const isLost = item.type === 'lost';
  let matches = item.status === 'active' ? matchesFor(item, state) : [];

  // A visitor looking at a FOUND item: show it only if it matches one of THEIR lost reports
  if (!mine && !isLost) matches = matches.filter((m) => m.lost.owner === u.email);
  if (!mine && isLost) matches = [];

  // Remember which matches the owner has now seen (for notifications)
  if (mine && item.status === 'active') {
    const key = u.email + '|' + item.id;
    const ids = matches.map((m) => m.other.id);
    const prev = state.seen[key] || [];
    if (ids.some((x) => !prev.includes(x))) { state.seen[key] = [...new Set([...prev, ...ids])]; save(); }
  }

  const claims = state.claims.filter((c) => (isLost ? c.lostId : c.foundId) === item.id && c.status !== 'rejected');
  const claimsHtml = claims.map((c) => {
    const role = roleIn(c);
    const lost = findItem(c.lostId), found = findItem(c.foundId);
    if (!lost || !found || !role) return '';
    if (c.status === 'pending') {
      return role === 'owner'
        ? `<div class="notice">You said <a href="#/item/${found.id}">${esc(found.title)}</a> is your item. Waiting for the finder to check your answer.</div>`
        : `<div class="notice">
            <b>${ic('user')} Someone says this is their item.</b>
            ${found.verifyQuestion ? `<p class="small">Q: ${esc(found.verifyQuestion)}<br>Their answer: <b>“${esc(c.answer)}”</b> · your answer: ${esc(found.verifyAnswer)}</p>` : `<p class="small">Their proof: <b>“${esc(c.answer)}”</b></p>`}
            <p class="small">Their lost report: <a href="#/item/${lost.id}">${esc(lost.title)}</a></p>
            <div class="row gap-s"><button class="btn btn-found sm" data-act="approve" data-claim="${c.id}">Yes, it’s theirs</button>
            <button class="btn ghost sm" data-act="reject" data-claim="${c.id}">No</button></div>
          </div>`;
    }
    if (c.status === 'verified') {
      return `<div class="notice success">
          <b>${ic('check')} Matched! Ownership verified.</b>
          <p class="small">Chat privately with the ${role === 'owner' ? 'finder' : 'owner'} and pick a safe spot on campus to meet. No phone numbers needed.</p>
          <a class="btn sm" href="#/chat/${c.id}">${ic('chat')} Open chat</a>
        </div>`;
    }
    if (c.status === 'resolved') return `<div class="notice success">${ic('check')} Resolved: this item is back with its owner. <a href="#/chat/${c.id}">View chat</a></div>`;
    return '';
  }).join('');

  const matchesHtml = matches.map((m) => {
    const lab = matchLabel(m.score);
    const claim = claimFor(m.lost.id, m.found.id);
    const iAmLostOwner = m.lost.owner === u.email;
    let actions = '';
    if (iAmLostOwner && !claim) {
      actions = `<button class="btn btn-lost sm" data-act="claim" data-lost="${m.lost.id}" data-found="${m.found.id}">This is my item</button>
                 <button class="btn ghost sm" data-act="dismiss" data-lost="${m.lost.id}" data-found="${m.found.id}">Not my item</button>`;
    } else if (!iAmLostOwner && !claim) {
      actions = `<span class="muted small">The owner has been notified and can claim it.</span>`;
    } else if (claim) {
      actions = `<span class="badge status-matched">Claim ${claim.status === 'pending' ? 'pending' : 'verified'}</span>`;
    }
    const other = m.other;
    return `
      <div class="card match">
        <div class="match-top">
          <a href="#/item/${other.id}">${thumb(other, 'thumb-s')}</a>
          <div class="grow">
            <div class="row gap-s">${typeBadge(other)}<span class="lab lab-${lab.cls}">${lab.text}</span>
              ${!mine ? `<span class="muted small">matches your “${esc(m.lost.title)}”</span>` : ''}</div>
            <a href="#/item/${other.id}"><h3>${esc(other.title)}</h3></a>
            <p class="muted small">${ic('pin')} ${esc(other.location)} · ${fmtDate(other.date)}</p>
          </div>
          ${scoreRing(m.score)}
        </div>
        <details><summary>Why we think this matches</summary>
          <div class="why">${reasonsList(m.reasons)}${signalBars(m.signals)}</div>
        </details>
        <div class="row gap-s">${actions}</div>
      </div>`;
  }).join('');

  const tags = [...(item.tags || [])].map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ');
  const ai = (item.aiTags || []).map((t) => `<span class="tag ai">${ic('spark')} ${esc(t)}</span>`).join(' ');

  let matchesSection = '';
  if (item.status === 'active') {
    if (mine) {
      matchesSection = `<h2>${matches.length ? `${matches.length} possible match${matches.length > 1 ? 'es' : ''}` : 'No matches yet'}</h2>
        ${matches.length ? matchesHtml : `<p class="empty">We’ll keep seeking. Every new ${isLost ? 'found' : 'lost'} report is compared with this one automatically, and you’ll get a notification.</p>`}`;
    } else if (matches.length) {
      matchesSection = `<h2>This may be yours!</h2>${matchesHtml}`;
    } else if (!isLost) {
      matchesSection = `<div class="notice">Is this yours? <a href="#/report/lost">Report it as lost</a> with some details and we’ll match it automatically.</div>`;
    } else {
      matchesSection = `<div class="notice">Have you seen this? <a href="#/report/found">Report it as found</a> and we’ll connect you with the owner privately.</div>`;
    }
  }

  return `
    <section class="item-page">
      <a href="#/browse" class="muted small">← All reports</a>
      <div class="item-head card">
        ${thumb(item, 'thumb-l')}
        <div class="grow">
          <div class="row between">
            <div class="row gap-s">${typeBadge(item)} ${statusBadge(item)} ${mine ? '<span class="badge badge-you">Your report</span>' : ''}</div>
            ${mine ? `<div class="row gap-s">
                ${item.status === 'active' ? `<a class="btn ghost sm" href="#/edit/${item.id}">${ic('edit')} Edit</a>` : ''}
                <button class="btn ghost sm danger" data-act="delete" data-id="${item.id}">${ic('trash')} Delete</button></div>` : ''}
          </div>
          <h1>${esc(item.title)}</h1>
          <p>${esc(item.description)}</p>
          <dl class="facts">
            <dt>Category</dt><dd>${esc(item.category)}</dd>
            ${item.color ? `<dt>Colour</dt><dd>${esc(item.color)}</dd>` : ''}
            ${item.brand ? `<dt>Brand</dt><dd>${esc(item.brand)}</dd>` : ''}
            <dt>${isLost ? 'Lost at' : 'Found at'}</dt><dd>${esc(item.location)}</dd>
            <dt>When</dt><dd>${fmtDate(item.date)}</dd>
            <dt>Reported by</dt><dd>${mine ? 'You' : 'A campus member (hidden for privacy)'}</dd>
            ${tags || ai ? `<dt>Tags</dt><dd>${tags} ${ai}</dd>` : ''}
            ${!isLost && item.verifyQuestion ? `<dt>Ownership check</dt><dd>${esc(item.verifyQuestion)}${mine ? ` <span class="muted">(answer: ${esc(item.verifyAnswer)})</span>` : ''}</dd>` : ''}
          </dl>
        </div>
      </div>
      ${claimsHtml}
      ${matchesSection}
    </section>`;
}

function pageChat(id) {
  const c = state.claims.find((x) => x.id === id);
  const role = c && roleIn(c);
  if (!c || !role || (c.status !== 'verified' && c.status !== 'resolved')) {
    return `<p class="empty">This chat isn’t available to you. <a href="#/mine">My reports</a></p>`;
  }
  const u = me();
  const lost = findItem(c.lostId), found = findItem(c.foundId);
  const otherLabel = role === 'owner' ? 'Finder' : 'Owner';
  // Mark messages as read (only save when something new arrived, so two
  // open tabs don't keep refreshing each other forever)
  const readKey = u.email + '|' + c.id;
  const newest = c.messages.filter((m) => m.from !== role).map((m) => m.at).sort().pop() || '';
  if (newest > (state.lastRead[readKey] || '')) { state.lastRead[readKey] = newest; save(); }

  const bubbles = c.messages.map((m, idx) => {
    if (m.from === 'system') return `<div class="sys">${esc(m.text)}</div>`;
    const mineMsg = m.from === role;
    const who = mineMsg ? 'You' : otherLabel;
    if (m.type === 'meetup') {
      const canAccept = !mineMsg && m.status === 'proposed' && c.status === 'verified';
      return `<div class="bubble ${mineMsg ? 'me' : 'them'} meetup">
          <span class="who">${who}</span>
          <b>${ic('pin')} Meetup ${m.status === 'accepted' ? 'confirmed ✓' : 'proposed'}</b>
          <p>${esc(m.place)}<br>${fmtDate(m.time)}</p>
          ${canAccept ? `<button class="btn btn-found sm" data-act="accept-meetup" data-claim="${c.id}" data-idx="${idx}">Accept</button>` : ''}
          ${mineMsg && m.status === 'proposed' ? '<span class="small muted">Waiting for them to accept…</span>' : ''}
          <time>${timeAgo(m.at)}</time>
        </div>`;
    }
    return `<div class="bubble ${mineMsg ? 'me' : 'them'}"><span class="who">${who}</span>${esc(m.text)}<time>${timeAgo(m.at)}</time></div>`;
  }).join('');

  const tomorrow = new Date(Date.now() + 24 * 3600000); tomorrow.setMinutes(0);
  return `
    <section class="chat-page">
      <a href="#/item/${role === 'owner' ? lost.id : found.id}" class="muted small">← Back to report</a>
      <div class="card chat-head">
        ${thumb(found, 'thumb-s')}
        <div class="grow"><b>${esc(lost.title)}</b>
          <p class="muted small">Private chat between owner and finder · you are the <b>${role}</b></p></div>
        <span class="badge status-${lost.status}">${STATUS_TEXT[lost.status]}</span>
      </div>
      <p class="safety">${ic('shield')} Identities are masked. Phone numbers, emails and social handles are hidden automatically. Always meet at a safe, public spot on campus.</p>
      <div class="card chat-box" id="chatBox">${bubbles || '<div class="sys">Say hi</div>'}</div>
      ${c.status === 'verified' ? `
        <form id="chatForm" class="chat-input" data-claim="${c.id}">
          <input id="chatText" maxlength="400" placeholder="Type a message…" autocomplete="off">
          <button class="btn" type="submit">Send</button>
        </form>
        <details class="card meet-form">
          <summary>${ic('pin')} Propose a safe meetup</summary>
          <form id="meetForm" data-claim="${c.id}">
            <div class="two">
              <div class="field"><label>Safe spot</label><select name="place">${SAFE_SPOTS.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
              <div class="field"><label>When</label><input type="datetime-local" name="time" value="${toLocalInputValue(tomorrow)}" min="${toLocalInputValue(new Date())}"></div>
            </div>
            <button class="btn btn-found sm" type="submit">Send proposal</button>
          </form>
        </details>
        <div class="resolve-box">
          <p class="muted small">Handed over?</p>
          <button class="btn btn-found" data-act="resolve" data-claim="${c.id}">${role === 'owner' ? 'I got my item back' : 'I handed it over'}</button>
        </div>` : `<div class="notice success">${ic('check')} Resolved: this item is back with its owner. Thanks for playing fair!</div>`}
    </section>`;
}

function pageHow() {
  const w = WEIGHTS, wp = WEIGHTS_WITH_PHOTOS;
  const row = (k, desc) => `<tr><td><b>${SIGNAL_NAMES[k]}</b></td><td>${desc}</td><td>${Math.round(w[k] * 100)}%</td><td>${Math.round(wp[k] * 100)}%</td></tr>`;
  return `
    <section class="card how">
      <h1>How Hide-and-Seek works</h1>
      <ol class="flow">
        <li><b>Report</b>: a lost or found item with name, description, tags, place, time and a photo. (Status: <span class="badge status-active">Active</span>)</li>
        <li><b>Automated matching</b>: every new report is compared against all older reports, and each pair gets a matching probability (%).</li>
        <li><b>Verify</b>: the owner clicks “This is my item” and answers the finder’s secret question. (Status: <span class="badge status-matched">Matched</span>)</li>
        <li><b>Masked chat + safe meetup</b>: the two talk privately without sharing phone numbers, and meet at a staffed campus spot.</li>
        <li><b>Handover</b>: either side marks it done. (Status: <span class="badge status-resolved">Resolved ✓</span>)</li>
      </ol>
      <h2>The matching score</h2>
      <table>
        <tr><th>Signal</th><th>How it’s measured</th><th>Weight</th><th>With photos</th></tr>
        ${row('text', 'TF-IDF keyword similarity of name, brand, tags and description. Synonyms are merged (earbuds = airpods = earphones) and rare words count more than common ones.')}
        ${row('category', 'Same category = 100%. Related ones (wallet ↔ ID card) get partial credit.')}
        ${row('location', 'Distance between the two places on the campus map.')}
        ${row('time', 'Found soon after it was lost scores high; this fades over about 5 days. Found <i>before</i> it was lost = 0.')}
        ${row('color', 'Same colour = 100%, similar shades (black/grey) = 50%.')}
        ${row('image', 'AI (MobileNet in the browser) compares what the photos show; a colour histogram is the backup.')}
      </table>
      <p>If a signal is missing (e.g. no photo), it’s skipped and the other weights are re-balanced.
         <b>What the item is matters most:</b> if neither the keywords nor the photo agree, the score is halved, so two unrelated
         things lost in the same place at the same time don’t get matched. Found days before it was lost → max 30%.</p>
      <p class="muted small">AI image model: <b id="aiStatus2">${ImageAI.status}</b> · Data: <b>${usingCloud ? 'shared online database' : 'saved on this device'}</b></p>
      <p class="small"><a href="#" id="resetDemo">Reset demo data</a></p>
    </section>`;
}

// ---------- router -------------------------------------------------------

let currentPage = '';
let lastHash = null;

function route() {
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  let page = parts[0] || 'home';

  // Still downloading data from the online database
  if (usingCloud && !Cloud.ready) {
    currentPage = 'loading';
    $app.innerHTML = '<p class="empty"><span class="spinner"></span> Connecting to the campus database…</p>';
    return;
  }

  // Campus login: everything except the login page needs an account
  if (!me() && page !== 'login') page = 'login';
  if (me() && page === 'login') page = 'home';

  let html;
  if (page === 'login') html = pageLogin(params);
  else if (page === 'report') html = pageReport(parts[1] === 'found' ? 'found' : 'lost');
  else if (page === 'edit') {
    const it = findItem(parts[1]);
    html = it && isMine(it) && it.status === 'active' ? pageReport(it.type, it) : '<p class="empty">You can only edit your own active reports.</p>';
  }
  else if (page === 'browse') html = pageBrowse(params);
  else if (page === 'matches') html = pageMatches();
  else if (page === 'mine') html = pageMine();
  else if (page === 'item') html = pageItem(parts[1]);
  else if (page === 'chat') html = pageChat(parts[1]);
  else if (page === 'how') html = pageHow();
  else { page = 'home'; html = pageHome(); }

  const pageChanged = currentPage !== page || location.hash !== lastHash;
  currentPage = page;
  lastHash = location.hash;
  $app.innerHTML = html;
  if (pageChanged) {                       // play the entrance animation only on real navigation
    $app.classList.remove('enter'); void $app.offsetWidth; $app.classList.add('enter');
    if (page === 'home') countUp();
  } else {
    $app.classList.remove('enter');
    document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = el.dataset.count; });
  }
  renderHeader();
  document.querySelectorAll('nav a[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === '#/' + (page === 'home' ? '' : page) || (page === 'edit' && a.getAttribute('href') === '#/mine'));
  });
  bindPage(page);
}

// Re-draw the current page without jumping to the top
function rerender() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// Someone else changed the data (another tab, or another device via the
// online database) → redraw, but never wipe a form the user is typing in.
function onExternalChange() {
  if (currentPage === 'loading') { route(); return; }
  if (currentPage === 'report' || currentPage === 'edit' || currentPage === 'login') { renderHeader(); return; }
  const typed = document.getElementById('chatText');
  const draft = typed ? typed.value : null;
  rerender();
  if (draft !== null && document.getElementById('chatText')) {
    const t = document.getElementById('chatText'); t.value = draft; t.focus();
  }
}

window.addEventListener('storage', (e) => {
  if (e.key !== STORE_KEY || usingCloud) return;
  state = Store.load() || state;
  onExternalChange();
});

// ---------- page behaviour ----------------------------------------------

function bindPage(page) {
  if (page === 'login') bindLogin();
  if (page === 'report' || page === 'edit') bindReportForm();
  if (page === 'browse') bindBrowse();
  if (page === 'chat') bindChat();
}

function bindLogin() {
  const form = document.getElementById('authForm');
  const err = document.getElementById('authError');
  const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.mode === 'signup') {
      // ---- SIGN UP: create a new account
      const email = (f.email || '').trim().toLowerCase();
      const username = (f.username || '').trim().toLowerCase().replace(/^@/, '');
      if (!f.name || !f.name.trim()) return fail('Please enter your name.');
      if (!USERNAME_RULE.test(username)) return fail('Username: 3–20 characters, only letters, numbers, dot or underscore.');
      if (state.users.some((u) => u.username === username)) return fail('That username is taken. Try another one.');
      if (!CAMPUS_EMAIL.test(email)) return fail('Please use your campus email (ending in .edu or .ac.in).');
      if (state.users.some((u) => u.email === email)) return fail('An account with this email already exists. Log in instead.');
      if ((f.password || '').length < 6) return fail('Password must be at least 6 characters.');
      state.users.push({ name: f.name.trim(), username, email, pw: hashPassword(f.password) });
      if (!save()) { state.users.pop(); return fail('Could not save your account. Try again.'); }
      Session.set(email);
      toast(`Welcome, ${f.name.trim()}! 🙈`);
    } else {
      // ---- LOG IN with username OR email
      const id = (f.login || '').trim().toLowerCase().replace(/^@/, '');
      const u = state.users.find((x) => x.email === id || x.username === id);
      if (!u || u.pw !== hashPassword(f.password || '')) return fail('Wrong username/email or password.');
      Session.set(u.email);
      toast(`Welcome back, ${u.name}!`);
    }
    location.hash = '#/';
    route();
  });

  document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    form.login.value = b.dataset.demo;
    form.password.value = DEMO_PASSWORD;
    form.requestSubmit();
  }));
}

function bindBrowse() {
  const go = () => {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    params.set('q', document.getElementById('search').value);
    params.set('cat', document.getElementById('catFilter').value);
    params.set('status', document.getElementById('statusFilter').value);
    history.replaceState(null, '', '#/browse?' + params.toString());
    route();
    const s = document.getElementById('search');
    s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  };
  let t;
  document.getElementById('search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(go, 250); });
  document.getElementById('catFilter').addEventListener('change', go);
  document.getElementById('statusFilter').addEventListener('change', go);
}

function bindReportForm() {
  const form = document.getElementById('reportForm');
  if (!form) return; // e.g. "you can only edit your own reports" page
  const input = document.getElementById('photo');
  const preview = document.getElementById('photoPreview');
  const note = document.getElementById('aiNote');
  const rm = document.getElementById('removePhoto');

  if (rm) rm.addEventListener('click', () => {
    removePhoto = true; pendingPhoto = null;
    preview.innerHTML = '<span class="big">' + ic('camera') + '</span><br>Photo removed. Click to add a new one.';
    rm.remove();
  });

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.', true); return; }
    preview.innerHTML = '<span class="spinner"></span> Analysing photo…';
    try {
      pendingPhoto = await ImageAI.analyze(file);
    } catch (e) {
      preview.innerHTML = 'Could not read that image. Try another one.';
      return;
    }
    removePhoto = false;
    preview.innerHTML = `<img src="${pendingPhoto.image}" alt="preview"><br><span class="muted small">Click to change photo</span>`;

    // Auto-fill fields the user hasn't filled yet
    const filled = [];
    if (!form.color.value && pendingPhoto.color) { form.color.value = pendingPhoto.color; filled.push(`colour → ${pendingPhoto.color}`); }
    if (!form.category.value && pendingPhoto.suggestedCategory) { form.category.value = pendingPhoto.suggestedCategory; filled.push(`category → ${pendingPhoto.suggestedCategory}`); }
    const tags = pendingPhoto.aiTags.length ? `AI thinks this is: <b>${pendingPhoto.aiTags.map(esc).join(', ')}</b>. ` : '';
    note.innerHTML = `${ic('spark')} ${tags}${filled.length ? `Filled in ${filled.join(', ')}. Change it if it’s wrong.` : 'The photo will be used for matching.'}`;
    note.classList.remove('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const err = document.getElementById('formError');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    const missing = [...form.querySelectorAll('[required]')].filter((el) => !el.value.trim())
      .map((el) => el.closest('.field').querySelector('label').textContent.replace('*', '').trim());
    if (missing.length) return fail('Please fill in: ' + missing.join(', '));
    const when = new Date(f.date);
    if (isNaN(when) || when - Date.now() > 5 * 60000) return fail('The date can’t be in the future.');
    if (f.verifyQuestion && !f.verifyAnswer) return fail('Please add the answer to your ownership question.');

    const fields = {
      title: f.title.trim(),
      category: f.category,
      color: f.color || '',
      brand: (f.brand || '').trim(),
      tags: parseTags(f.tags),
      description: f.description.trim(),
      location: f.location,
      date: when.toISOString(),
      verifyQuestion: (f.verifyQuestion || '').trim(),
      verifyAnswer: (f.verifyAnswer || '').trim(),
    };

    let item;
    const editId = form.dataset.edit;
    if (editId) {
      // ---- MODIFY an existing report
      item = findItem(editId);
      const backup = { ...item };
      Object.assign(item, fields);
      if (pendingPhoto) Object.assign(item, { image: pendingPhoto.image, hist: pendingPhoto.hist, aiTags: pendingPhoto.aiTags });
      else if (removePhoto) Object.assign(item, { image: null, hist: null, aiTags: [] });
      if (!save()) { Object.assign(item, backup); return; }
      ImageAI.forget(item.id);
    } else {
      // ---- ADD a new report
      item = {
        id: newId(form.dataset.type === 'lost' ? 'L' : 'F'),
        type: form.dataset.type,
        owner: me().email,
        ...fields,
        image: pendingPhoto ? pendingPhoto.image : null,
        hist: pendingPhoto ? pendingPhoto.hist : null,
        aiTags: pendingPhoto ? pendingPhoto.aiTags : [],
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      state.items.push(item);
      if (!save()) { state.items.pop(); return; }
    }
    if (item.image) await ImageAI.ensureEmbeddings([item]);

    const n = matchesFor(item, state).length;
    toast(editId ? `Saved. ${n} possible match${n === 1 ? '' : 'es'} now.` :
      n ? `Found ${n} possible match${n > 1 ? 'es' : ''}!` : 'Report saved. We’ll keep seeking as new reports come in.');
    location.hash = '#/item/' + item.id;
  });
}

function bindChat() {
  const box = document.getElementById('chatBox');
  if (box) box.scrollTop = box.scrollHeight;

  const form = document.getElementById('chatForm');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatText');
    const raw = input.value.trim();
    if (!raw) return;
    const c = state.claims.find((x) => x.id === form.dataset.claim);
    const text = maskContacts(raw);
    c.messages.push({ from: roleIn(c), text, at: new Date().toISOString() });
    save(); rerender();
    if (text !== raw) toast('Contact details were hidden for your safety.');
    document.getElementById('chatText').focus();
  });

  const meet = document.getElementById('meetForm');
  if (meet) meet.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = state.claims.find((x) => x.id === meet.dataset.claim);
    const time = new Date(meet.time.value);
    if (isNaN(time)) return toast('Please choose a time.', true);
    c.messages.forEach((m) => { if (m.type === 'meetup' && m.status === 'proposed') m.status = 'replaced'; });
    c.messages.push({ from: roleIn(c), type: 'meetup', place: meet.place.value, time: time.toISOString(), status: 'proposed', text: '', at: new Date().toISOString() });
    save(); rerender();
    toast('Meetup proposed.');
  });
}

// Buttons inside pages (one listener handles them all)
$app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const claim = btn.dataset.claim && state.claims.find((x) => x.id === btn.dataset.claim);

  if (act === 'dismiss') {
    state.dismissed.push({ lostId: btn.dataset.lost, foundId: btn.dataset.found });
    save(); rerender(); toast('Got it. We won’t suggest that one again.');
  }

  if (act === 'claim') startClaim(btn.dataset.lost, btn.dataset.found);

  if (act === 'approve' && claim) { verifyClaim(claim); toast('Owner verified. A private chat is now open.'); }
  if (act === 'reject' && claim) { claim.status = 'rejected'; save(); rerender(); toast('Claim rejected.'); }

  if (act === 'accept-meetup' && claim) {
    const m = claim.messages[+btn.dataset.idx];
    m.status = 'accepted';
    claim.messages.push({ from: 'system', text: `Meetup confirmed: ${m.place}, ${fmtDate(m.time)}. Bring your college ID.`, at: new Date().toISOString() });
    save(); rerender(); toast('Meetup confirmed!');
  }

  if (act === 'resolve' && claim) {
    if (!confirm('Mark this item as handed over? This closes the case.')) return;
    claim.status = 'resolved';
    findItem(claim.lostId).status = 'resolved';
    findItem(claim.foundId).status = 'resolved';
    claim.messages.push({ from: 'system', text: 'Item handed over. Case resolved!', at: new Date().toISOString() });
    save(); rerender(); toast('Resolved! Thank you for playing fair.');
  }

  if (act === 'delete') {
    const item = findItem(btn.dataset.id);
    if (!item || !isMine(item)) return;
    if (!confirm(`Delete “${item.title}”? This can’t be undone.`)) return;
    // ---- DELETE the report and anything linked to it
    state.claims.forEach((c) => {
      if ((c.lostId === item.id || c.foundId === item.id) && c.status === 'verified') {
        const other = findItem(c.lostId === item.id ? c.foundId : c.lostId);
        if (other && other.status === 'matched') other.status = 'active'; // free the other report again
      }
    });
    state.items = state.items.filter((i) => i.id !== item.id);
    state.claims = state.claims.filter((c) => c.lostId !== item.id && c.foundId !== item.id);
    state.dismissed = state.dismissed.filter((d) => d.lostId !== item.id && d.foundId !== item.id);
    ImageAI.forget(item.id);
    save();
    toast('Report deleted.');
    if (location.hash === '#/mine') rerender(); else location.hash = '#/mine';
  }
});

function verifyClaim(c) {
  c.status = 'verified';
  findItem(c.lostId).status = 'matched';
  findItem(c.foundId).status = 'matched';
  c.messages = c.messages || [];
  c.messages.push({ from: 'system', text: 'Ownership verified ✓ This chat is private. Phone numbers and emails are hidden automatically.', at: new Date().toISOString() });
  // other pending claims on the same found item are no longer valid
  state.claims.forEach((o) => { if (o !== c && o.foundId === c.foundId && o.status === 'pending') o.status = 'rejected'; });
  save(); rerender();
}

function startClaim(lostId, foundId) {
  const found = findItem(foundId);
  const hasQ = !!found.verifyQuestion;
  openModal(`
    <h2>Is “${esc(found.title)}” your item?</h2>
    ${hasQ
      ? `<p>To prove it, answer the finder’s question:</p><p class="question">${ic('lock')} ${esc(found.verifyQuestion)}</p>`
      : `<p>The finder didn’t set a question. Describe something only the owner would know (a mark, what’s inside, the lock screen…).</p>`}
    <form id="claimForm">
      <textarea id="claimAnswer" rows="2" placeholder="Your answer"></textarea>
      <div id="claimMsg" class="error hidden"></div>
      <button class="btn btn-lost wide" type="submit">${hasQ ? 'Check my answer' : 'Send to finder'}</button>
    </form>`);

  let attempts = 0;
  document.getElementById('claimForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const answer = document.getElementById('claimAnswer').value.trim();
    if (!answer) return;
    const claim = { id: newId('C'), lostId, foundId, answer, status: 'pending', messages: [], createdAt: new Date().toISOString() };

    if (!hasQ) {
      state.claims.push(claim); save(); closeModal(); rerender();
      toast('Sent! The finder will check your description.');
      return;
    }
    if (answerSimilarity(answer, found.verifyAnswer) >= ANSWER_PASS) {
      state.claims.push(claim);
      closeModal(); verifyClaim(claim);
      toast('Correct! It’s a match. Your private chat is open.');
      return;
    }
    attempts++;
    const msg = document.getElementById('claimMsg');
    if (attempts < 2) {
      msg.textContent = 'That doesn’t match the finder’s answer. You have one more try.';
      msg.classList.remove('hidden');
    } else {
      state.claims.push(claim); save(); closeModal(); rerender();
      toast('Answer didn’t match, so we sent it to the finder to review.', true);
    }
  });
}

// ---------- global UI ----------------------------------------------------

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.closest('.modal-close')) closeModal();
});

document.getElementById('userArea').addEventListener('click', (e) => {
  if (e.target.closest('#bellBtn')) { document.getElementById('bellPanel').classList.toggle('open'); return; }
  if (e.target.closest('#logoutBtn')) { Session.clear(); location.hash = '#/login'; route(); toast('Logged out.'); }
  if (e.target.closest('.bell-panel a')) document.getElementById('bellPanel').classList.remove('open');
});
document.addEventListener('click', (e) => {
  const p = document.getElementById('bellPanel');
  if (p && !e.target.closest('.bell-wrap')) p.classList.remove('open');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#resetDemo')) return;
  e.preventDefault();
  if (!confirm(usingCloud
    ? 'This deletes EVERYONE’s reports and accounts in the shared database and loads the demo data. Continue?'
    : 'Delete everything and load the demo data again?')) return;
  state = demoState(); save();
  Session.clear();
  location.hash = '#/login'; route();
  toast('Demo data restored.');
});

function showAiStatus(s) {
  const el = document.getElementById('aiStatus');
  if (!el) return;
  el.textContent = { loading: 'AI loading…', ready: 'AI photo matching on', unavailable: 'Basic photo matching' }[s];
  el.className = 'ai-pill ' + s;
  const el2 = document.getElementById('aiStatus2');
  if (el2) el2.textContent = s;
}

ImageAI.onStatus(async (s) => {
  showAiStatus(s);
  if (s === 'ready' && await ImageAI.ensureEmbeddings(state.items) && currentPage !== 'report' && currentPage !== 'edit') rerender();
});

showAiStatus('loading');
route();
ImageAI.loadModel();
