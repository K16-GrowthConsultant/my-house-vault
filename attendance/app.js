/* Office Attendance, v1.0.0
   Punch in / punch out on one shared office device (tablet or PC at the entrance), with a monthly register.
   Offline-first. All data stays in this browser (localStorage). Use Admin > Backup to keep copies. */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const KEY = 'office_attendance_v1';

  /* ------------------------------------------------------------------ helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const todayIso = () => iso(new Date());
  const hm = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtTime = ts => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const fmtDate = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  const dur = mins => { mins = Math.max(0, Math.round(mins)); return Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm'; };
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function hashPin(pin, salt) {
    const s = salt + ':' + pin;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for browsers without Web Crypto (non-secure origins). Weaker, but better than plain text.
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'fnv:' + (h >>> 0).toString(16);
  }

  /* ------------------------------------------------------------------ data */
  const DEFAULTS = {
    settings: {
      company: '', adminSalt: '', adminHash: '',
      start: '09:30', grace: 10, fullHours: 8, halfHours: 4,
      weekOffs: [0], mpRule: 'HD', autoCloseHours: 16, requirePin: true, theme: 'auto'
    },
    employees: [], sessions: [], leaves: {}, holidays: [], audit: []
  };
  let db = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), d, { settings: Object.assign({}, DEFAULTS.settings, d.settings || {}) });
      }
    } catch (e) { console.error(e); }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('Could not save. Storage may be full. Take a backup now.'); }
  }
  function audit(msg) {
    db.audit.unshift({ ts: Date.now(), msg });
    if (db.audit.length > 1000) db.audit.length = 1000;
  }
  const empById = id => db.employees.find(e => e.id === id);
  const activeEmps = () => db.employees.filter(e => e.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  /* ------------------------------------------------------------------ attendance rules */
  const autoCloseMs = () => (Number(db.settings.autoCloseHours) || 16) * 3600000;
  // The open session an employee can still punch out of (null if none or if it is too old).
  function openSession(empId) {
    const now = Date.now();
    let last = null;
    for (const s of db.sessions) if (s.emp === empId && (!last || s.in > last.in)) last = s;
    if (last && !last.out && now - last.in < autoCloseMs()) return last;
    return null;
  }
  function sessionsOn(empId, dateStr) {
    return db.sessions.filter(s => s.emp === empId && s.date === dateStr).sort((a, b) => a.in - b.in);
  }

  /* Day status codes:
     P present, HD half day, A absent, MP missing punch-out, L paid leave, LWP leave without pay,
     WO weekly off, H holiday, IN at work right now, '' not yet / future, '-' before joining or after leaving. */
  function dayInfo(emp, dateStr) {
    const S = db.settings;
    const d = parse(dateStr);
    const t = todayIso();
    const sess = sessionsOn(emp.id, dateStr);
    const leave = db.leaves[emp.id + '|' + dateStr];
    const hol = db.holidays.find(h => h.date === dateStr);
    const wo = (S.weekOffs || []).includes(d.getDay());
    const now = Date.now();
    let mins = 0, open = false, missing = false;
    for (const s of sess) {
      if (s.out) mins += (s.out - s.in) / 60000;
      else if (now - s.in < autoCloseMs()) { open = true; mins += (now - s.in) / 60000; }
      else missing = true;
    }
    const firstIn = sess.length ? sess[0].in : null;
    let late = false;
    if (firstIn && !hol && !wo) {
      const fd = new Date(firstIn);
      late = fd.getHours() * 60 + fd.getMinutes() > toMin(S.start) + (Number(S.grace) || 0);
    }
    let code;
    if ((emp.joined && dateStr < emp.joined) || (emp.left && dateStr > emp.left)) code = '-';
    else if (leave) code = leave;
    else if (sess.length) {
      if (open) code = 'IN';
      else if (missing) code = 'MP';
      else if (mins >= S.fullHours * 60) code = 'P';
      else if (mins >= S.halfHours * 60) code = 'HD';
      else code = 'A';
      if ((hol || wo) && (code === 'A' || code === 'MP')) code = hol ? 'H' : 'WO';
    } else if (hol) code = 'H';
    else if (wo) code = 'WO';
    else if (dateStr >= t) code = '';
    else code = 'A';
    const offDay = !!(hol || wo);
    const workedOff = offDay && (code === 'P' || code === 'HD' || code === 'IN') ? (code === 'HD' ? 0.5 : 1) : 0;
    const mpVal = S.mpRule === 'P' ? 1 : S.mpRule === 'A' ? 0 : 0.5;
    let pay = { P: 1, HD: 0.5, L: 1, WO: 1, H: 1, IN: 1, MP: mpVal }[code] || 0;
    if (offDay && code !== 'L' && code !== 'LWP' && code !== '-') pay = 1;
    return { code, mins, late, sess, firstIn, lastOut: sess.length ? sess[sess.length - 1].out : null, hol, wo, offDay, workedOff, pay, open };
  }

  function monthDays(y, m) {
    const n = new Date(y, m + 1, 0).getDate();
    const out = [];
    for (let i = 1; i <= n; i++) out.push(iso(new Date(y, m, i)));
    return out;
  }
  function monthSummary(emp, y, m) {
    const days = monthDays(y, m).map(ds => ({ ds, ...dayInfo(emp, ds) }));
    const c = k => days.filter(d => d.code === k).length;
    return {
      days,
      P: c('P') + c('IN'), HD: c('HD'), A: c('A'), MP: c('MP'), L: c('L'), LWP: c('LWP'), WO: c('WO'), H: c('H'),
      late: days.filter(d => d.late).length,
      mins: days.reduce((a, d) => a + d.mins, 0),
      workedOff: days.reduce((a, d) => a + d.workedOff, 0),
      payable: days.reduce((a, d) => a + d.pay, 0)
    };
  }

  /* ------------------------------------------------------------------ UI state */
  const ui = { view: 'kiosk', tab: 'today', admin: false, q: '', month: null, idleTimer: null };
  { const n = new Date(); ui.month = { y: n.getFullYear(), m: n.getMonth() }; }

  function applyTheme() {
    const th = db.settings.theme;
    if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th);
    else document.documentElement.removeAttribute('data-theme');
  }

  let toastTimer;
  function toast(msg) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  function modal(html, wide) {
    closeModal();
    const ov = document.createElement('div');
    ov.className = 'ov';
    ov.innerHTML = '<div class="modal' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    const f = ov.querySelector('[autofocus]') || ov.querySelector('input, select, button');
    if (f) f.focus();
    return ov;
  }
  function closeModal() { const o = $('.ov'); if (o) o.remove(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function confirmBox(msg, okLabel) {
    return new Promise(res => {
      const ov = modal('<p>' + esc(msg) + '</p><div class="row" style="justify-content:flex-end"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">' + esc(okLabel || 'OK') + '</button></div>');
      ov.addEventListener('click', e => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        closeModal(); res(a.dataset.a === 'yes');
      });
    });
  }

  /* PIN pad: resolves with the entered PIN, or null if cancelled. */
  function pinPad(title, sub, len = 4) {
    return new Promise(res => {
      let pin = '';
      const ov = modal(
        '<h2 style="text-align:center">' + esc(title) + '</h2>' +
        (sub ? '<p class="muted" style="text-align:center;margin:6px 0 0">' + sub + '</p>' : '') +
        '<div class="pinbox">' + Array.from({ length: len }, () => '<span></span>').join('') + '</div>' +
        '<div class="err" id="pinerr"></div>' +
        '<div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<button data-k="' + n + '">' + n + '</button>').join('') +
        '<button data-k="x" aria-label="Cancel">✕</button><button data-k="0">0</button><button data-k="b" aria-label="Delete">⌫</button></div>'
      );
      const paint = () => ov.querySelectorAll('.pinbox span').forEach((s, i) => s.classList.toggle('f', i < pin.length));
      const done = () => { const p = pin; pin = ''; paint(); res(p); };
      const press = k => {
        if (k === 'x') { closeModal(); res(null); return; }
        if (k === 'b') pin = pin.slice(0, -1);
        else if (/^\d$/.test(k) && pin.length < len) pin += k;
        paint();
        if (pin.length === len) setTimeout(done, 120);
      };
      ov.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
      ov.addEventListener('keydown', e => {
        if (/^\d$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') press('b');
      });
      ov.pinError = msg => { const el = ov.querySelector('#pinerr'); if (el) el.textContent = msg; };
      pinPad.current = ov;
    });
  }

  /* ------------------------------------------------------------------ rendering */
  const root = $('#root');
  function render() {
    applyTheme();
    if (!db.settings.adminHash) return renderSetup();
    root.innerHTML =
      '<div class="wrap">' +
      '<div class="topbar"><div class="brand"><img src="icon.svg" alt=""><span class="name">' + esc(db.settings.company || 'Office Attendance') + '</span></div>' +
      (ui.view === 'kiosk'
        ? '<button class="btn" data-act="admin">🔒 Admin</button>'
        : '<button class="btn" data-act="kiosk">⏱ Punch screen</button><button class="btn" data-act="lock">Lock</button>') +
      '</div>' +
      (ui.view === 'kiosk' ? kioskHtml() : adminHtml()) +
      '<p class="muted small" style="text-align:center;margin-top:28px">Office Attendance v' + VERSION + ' · data stays on this device</p>' +
      '</div>';
    if (ui.view === 'kiosk') startClock();
  }

  function renderSetup() {
    root.innerHTML =
      '<div class="wrap" style="max-width:560px;padding-top:40px"><div class="card stack">' +
      '<div class="brand"><img src="icon.svg" alt=""><h1>Office Attendance</h1></div>' +
      '<p class="muted">One-time setup. This device becomes your office punch-in station. All records stay in this browser. Nothing is sent to a server.</p>' +
      '<label class="f">Company / office name<input id="s_company" placeholder="e.g. Shree Traders, Ahmedabad"></label>' +
      '<div class="grid2"><label class="f">Admin PIN (4 digits)<input id="s_pin" inputmode="numeric" maxlength="4" type="password"></label>' +
      '<label class="f">Repeat admin PIN<input id="s_pin2" inputmode="numeric" maxlength="4" type="password"></label></div>' +
      '<div class="grid2"><label class="f">Office start time<input id="s_start" type="time" value="09:30"></label>' +
      '<label class="f">Grace minutes before "late"<input id="s_grace" type="number" min="0" value="10"></label></div>' +
      '<div class="err" id="s_err" style="text-align:left"></div>' +
      '<button class="btn primary big" data-act="setup">Start</button>' +
      '<p class="muted small">You can change timings, weekly offs and holidays later in Admin › Settings.</p>' +
      '</div></div>';
  }

  /* ---------- kiosk */
  let clockTimer;
  function startClock() {
    clearInterval(clockTimer);
    const tick = () => {
      const t = $('#clk'), d = $('#clkd');
      if (!t) { clearInterval(clockTimer); return; }
      const n = new Date();
      t.textContent = n.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      d.textContent = fmtDate(n);
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  function kioskHtml() {
    const emps = activeEmps().filter(e => !ui.q || (e.name + ' ' + (e.code || '') + ' ' + (e.dept || '')).toLowerCase().includes(ui.q.toLowerCase()));
    const t = todayIso();
    const tiles = emps.map(e => {
      const inf = dayInfo(e, t);
      const open = openSession(e.id);
      const status = open ? '<span class="pill in">IN since ' + esc(fmtTime(open.in)) + '</span>'
        : inf.sess.length ? '<span class="pill done">OUT ' + esc(fmtTime(inf.lastOut)) + '</span>'
          : '<span class="pill out">Not in yet</span>';
      return '<button class="tile" data-act="punch" data-id="' + e.id + '"><div class="avatar">' + esc(initials(e.name)) + '</div>' +
        '<div class="nm">' + esc(e.name) + '</div><div class="muted small">' + esc(e.code || '') + '</div>' + status + '</button>';
    }).join('');
    return '<div class="clock"><div class="time" id="clk"></div><div class="date" id="clkd"></div></div>' +
      (db.employees.length
        ? '<div class="kiosk-search"><input id="kq" type="search" placeholder="Find your name or employee code" value="' + esc(ui.q) + '" autocomplete="off"></div>' +
          '<p class="muted" style="text-align:center;margin-top:0">Tap your name to punch in or out.</p>' +
          '<div class="tiles">' + (tiles || '<p class="muted">No match.</p>') + '</div>'
        : '<div class="card" style="text-align:center"><p>No employees yet.</p><button class="btn primary" data-act="admin">Open Admin to add employees</button></div>');
  }

  async function punch(empId) {
    const e = empById(empId);
    if (!e) return;
    if (db.settings.requirePin && e.pinHash) {
      for (let tries = 0; tries < 5; tries++) {
        const p = pinPad(e.name, 'Enter your 4-digit PIN');
        const ov = pinPad.current;
        if (tries) ov.pinError('Wrong PIN. Try again.');
        const pin = await p;
        if (pin === null) return;
        if (await hashPin(pin, e.salt) === e.pinHash) { closeModal(); return confirmPunch(e); }
      }
      closeModal();
      toast('Too many wrong PINs. Ask your admin.');
      return;
    }
    confirmPunch(e);
  }

  function confirmPunch(e) {
    const open = openSession(e.id);
    const isIn = !open;
    const ov = modal(
      '<div class="success"><div class="avatar" style="margin:0 auto 8px">' + esc(initials(e.name)) + '</div>' +
      '<h2>' + esc(e.name) + '</h2>' +
      (open ? '<p class="muted">Punched in at ' + esc(fmtTime(open.in)) + ' · ' + esc(dur((Date.now() - open.in) / 60000)) + ' so far</p>' : '<p class="muted">You are not punched in.</p>') +
      '<button class="btn primary big" style="width:100%;margin-top:8px' + (isIn ? '' : ';background:var(--danger);border-color:var(--danger)') + '" data-a="go">' + (isIn ? '▶ Punch IN' : '■ Punch OUT') + '</button>' +
      '<button class="btn" style="width:100%;margin-top:10px" data-a="cancel">Cancel</button></div>'
    );
    ov.addEventListener('click', ev => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'cancel') return closeModal();
      const now = Date.now();
      let msg;
      if (isIn) {
        db.sessions.push({ id: uid(), emp: e.id, in: now, out: null, date: todayIso(), src: 'kiosk' });
        const late = dayInfo(e, todayIso()).late;
        msg = '<div class="big">✅</div><h2>Welcome, ' + esc(e.name.split(' ')[0]) + '</h2><div class="t">IN ' + esc(fmtTime(now)) + '</div>' +
          (late ? '<p><span class="pill late">Late arrival</span></p>' : '');
      } else {
        const s = db.sessions.find(x => x.id === open.id);
        s.out = now;
        msg = '<div class="big">👋</div><h2>Bye, ' + esc(e.name.split(' ')[0]) + '</h2><div class="t">OUT ' + esc(fmtTime(now)) + '</div>' +
          '<p class="muted">Worked today: ' + esc(dur(dayInfo(e, s.date).mins)) + '</p>';
      }
      save();
      ov.querySelector('.modal').innerHTML = '<div class="success">' + msg + '<button class="btn" style="margin-top:10px" data-a="cancel">Done</button></div>';
      setTimeout(() => { if (document.body.contains(ov)) { closeModal(); render(); } }, 3500);
      ui.q = '';
      render();
      document.body.appendChild(ov);
    });
  }

  /* ---------- admin */
  function adminHtml() {
    const tabs = [['today', 'Today'], ['month', 'Monthly register'], ['emps', 'Employees'], ['hols', 'Holidays'], ['settings', 'Settings'], ['backup', 'Backup & log']];
    const body = { today: todayHtml, month: monthHtml, emps: empsHtml, hols: holsHtml, settings: settingsHtml, backup: backupHtml }[ui.tab]();
    return '<div class="tabs" role="tablist">' + tabs.map(([k, l]) => '<button role="tab" class="' + (ui.tab === k ? 'on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' + body;
  }

  function todayHtml() {
    const t = todayIso();
    const rows = activeEmps().map(e => ({ e, i: dayInfo(e, t) }));
    const cnt = f => rows.filter(f).length;
    const inNow = cnt(r => r.i.open);
    const came = cnt(r => r.i.sess.length);
    const late = cnt(r => r.i.late);
    const onLeave = cnt(r => r.i.code === 'L' || r.i.code === 'LWP');
    const isOff = rows.length && rows[0].i.offDay;
    return '<div class="stack">' +
      '<h2>' + esc(fmtDate(new Date())) + (isOff ? ' <span class="pill out">' + (rows[0].i.hol ? esc(rows[0].i.hol.name) : 'Weekly off') + '</span>' : '') + '</h2>' +
      '<div class="stats">' +
      stat(inNow, 'In office now') + stat(came, 'Came today') + stat(rows.length - came - onLeave, 'Not in yet / absent') + stat(late, 'Late') + stat(onLeave, 'On leave') +
      '</div>' +
      '<div class="tablewrap"><table><thead><tr><th>Employee</th><th>Status</th><th>First in</th><th>Last out</th><th class="num">Worked</th><th></th></tr></thead><tbody>' +
      (rows.map(({ e, i }) =>
        '<tr><td><b>' + esc(e.name) + '</b> <span class="muted small">' + esc(e.code || '') + '</span></td>' +
        '<td>' + (i.open ? '<span class="pill in">IN</span>' : i.sess.length ? '<span class="pill done">OUT</span>' : i.code === 'L' || i.code === 'LWP' ? '<span class="pill out">' + i.code + '</span>' : '<span class="pill out">—</span>') +
        (i.late ? ' <span class="pill late">Late</span>' : '') + '</td>' +
        '<td>' + (i.firstIn ? esc(fmtTime(i.firstIn)) : '') + '</td><td>' + (i.lastOut && !i.open ? esc(fmtTime(i.lastOut)) : '') + '</td>' +
        '<td class="num">' + (i.mins ? esc(dur(i.mins)) : '') + '</td>' +
        '<td><button class="btn sm" data-act="day" data-id="' + e.id + '" data-d="' + t + '">Edit</button></td></tr>').join('') ||
        '<tr><td colspan="6" class="muted">No employees yet. Add them in the Employees tab.</td></tr>') +
      '</tbody></table></div></div>';
  }
  const stat = (n, l) => '<div class="stat"><div class="n">' + n + '</div><div class="l">' + esc(l) + '</div></div>';

  function monthHtml() {
    const { y, m } = ui.month;
    const days = monthDays(y, m);
    const label = new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const emps = db.employees.filter(e => e.active !== false || monthSummary(e, y, m).days.some(d => d.sess.length)).sort((a, b) => a.name.localeCompare(b.name));
    const head = '<tr><th class="emp">Employee</th>' + days.map(ds => {
      const d = parse(ds);
      const off = (db.settings.weekOffs || []).includes(d.getDay()) || db.holidays.some(h => h.date === ds);
      return '<th class="' + (off ? 'wk' : '') + '">' + d.getDate() + '<br>' + DOW[d.getDay()][0] + '</th>';
    }).join('') + '<th>P</th><th>HD</th><th>A</th><th>MP</th><th>L</th><th>LWP</th><th>Late</th><th>Hours</th><th>Payable</th></tr>';
    const body = emps.map(e => {
      const s = monthSummary(e, y, m);
      return '<tr><td class="emp"><b>' + esc(e.name) + '</b><br><span class="muted small">' + esc(e.code || '') + '</span></td>' +
        s.days.map(d => '<td class="c c-' + (d.code || 'none') + '" data-act="day" data-id="' + e.id + '" data-d="' + d.ds + '" title="' + esc(d.ds + (d.mins ? ' · ' + dur(d.mins) : '') + (d.late ? ' · late' : '')) + '">' +
          esc(d.code) + (d.late ? '<sup>•</sup>' : '') + '</td>').join('') +
        '<td>' + s.P + '</td><td>' + s.HD + '</td><td>' + s.A + '</td><td>' + s.MP + '</td><td>' + s.L + '</td><td>' + s.LWP + '</td><td>' + s.late + '</td>' +
        '<td>' + (s.mins / 60).toFixed(1) + '</td><td><b>' + s.payable + '</b></td></tr>';
    }).join('');
    return '<div class="stack">' +
      '<div class="row"><button class="btn sm" data-act="mprev" aria-label="Previous month">◀</button><h2 style="min-width:160px;text-align:center">' + esc(label) + '</h2><button class="btn sm" data-act="mnext" aria-label="Next month">▶</button>' +
      '<span style="flex:1"></span><button class="btn sm" data-act="csvsum">⬇ Register CSV</button><button class="btn sm" data-act="csvlog">⬇ Punch log CSV</button><button class="btn sm" data-act="print">🖨 Print</button></div>' +
      '<div class="legend">' + [['P', 'Present'], ['HD', 'Half day'], ['A', 'Absent'], ['MP', 'Missing punch-out'], ['L', 'Paid leave'], ['LWP', 'Leave without pay'], ['WO', 'Weekly off'], ['H', 'Holiday'], ['IN', 'At work now']]
        .map(([k, l]) => '<span><b class="c-' + k + '">' + k + '</b> ' + l + '</span>').join('') + '<span><sup style="color:var(--warn)">•</sup> late</span></div>' +
      (emps.length ? '<div class="tablewrap"><table class="reg"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' : '<p class="muted">No employees yet.</p>') +
      '<p class="muted small">Tap any cell to see punches, fix times, or mark leave. Payable days = P + ½·HD + L + WO + H (+ MP per your setting). Weekly offs and holidays are paid; working on them is shown in the CSV as "Off-days worked".</p>' +
      '</div>';
  }

  function empsHtml() {
    const list = db.employees.slice().sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name));
    return '<div class="stack"><div class="row"><h2 style="margin-right:auto">Employees (' + activeEmps().length + ' active)</h2><button class="btn primary" data-act="empnew">+ Add employee</button></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Code</th><th>Department</th><th>Joined</th><th>PIN</th><th>Status</th><th></th></tr></thead><tbody>' +
      (list.map(e => '<tr><td><b>' + esc(e.name) + '</b></td><td>' + esc(e.code || '') + '</td><td>' + esc(e.dept || '') + '</td><td>' + esc(e.joined || '') + '</td>' +
        '<td>' + (e.pinHash ? 'Set' : '<span class="muted">None</span>') + '</td><td>' + (e.active !== false ? '<span class="pill in">Active</span>' : '<span class="pill out">Left ' + esc(e.left || '') + '</span>') + '</td>' +
        '<td><button class="btn sm" data-act="empedit" data-id="' + e.id + '">Edit</button></td></tr>').join('') ||
        '<tr><td colspan="7" class="muted">No employees yet.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function empForm(e) {
    const isNew = !e;
    e = e || { name: '', code: '', dept: '', joined: todayIso(), active: true };
    const ov = modal(
      '<h2>' + (isNew ? 'Add employee' : 'Edit employee') + '</h2><div class="stack" style="margin-top:12px">' +
      '<label class="f">Full name<input id="e_name" value="' + esc(e.name) + '" autofocus></label>' +
      '<div class="grid2"><label class="f">Employee code<input id="e_code" value="' + esc(e.code || '') + '" placeholder="e.g. E001"></label>' +
      '<label class="f">Department<input id="e_dept" value="' + esc(e.dept || '') + '"></label></div>' +
      '<div class="grid2"><label class="f">Joining date<input id="e_joined" type="date" value="' + esc(e.joined || '') + '"></label>' +
      '<label class="f">' + (isNew ? 'PIN (4 digits)' : 'New PIN (leave blank to keep)') + '<input id="e_pin" inputmode="numeric" maxlength="4" type="password"></label></div>' +
      (isNew ? '' : '<label class="check"><input type="checkbox" id="e_active"' + (e.active !== false ? ' checked' : '') + '> Active (uncheck when the employee leaves)</label>' +
        '<label class="f">Last working day (if left)<input id="e_left" type="date" value="' + esc(e.left || '') + '"></label>') +
      '<div class="err" id="e_err" style="text-align:left"></div>' +
      '<div class="row" style="justify-content:flex-end">' + (isNew ? '' : '<button class="btn danger" data-a="del" style="margin-right:auto">Delete</button>') +
      '<button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div></div>'
    );
    ov.addEventListener('click', async ev => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'cancel') return closeModal();
      if (a.dataset.a === 'del') {
        const n = db.sessions.filter(s => s.emp === e.id).length;
        closeModal();
        if (!await confirmBox('Delete ' + e.name + ' and their ' + n + ' punch records? To keep history, mark them inactive instead.', 'Delete')) return;
        db.employees = db.employees.filter(x => x.id !== e.id);
        db.sessions = db.sessions.filter(s => s.emp !== e.id);
        Object.keys(db.leaves).forEach(k => { if (k.startsWith(e.id + '|')) delete db.leaves[k]; });
        audit('Deleted employee ' + e.name);
        save(); render(); return;
      }
      const name = $('#e_name').value.trim(), code = $('#e_code').value.trim(), pin = $('#e_pin').value.trim();
      const err = $('#e_err');
      if (!name) return (err.textContent = 'Name is required.');
      if (code && db.employees.some(x => x.id !== e.id && (x.code || '').toLowerCase() === code.toLowerCase())) return (err.textContent = 'This employee code is already used.');
      if ((isNew && db.settings.requirePin && !pin) || (pin && !/^\d{4}$/.test(pin))) return (err.textContent = 'PIN must be exactly 4 digits.');
      const rec = isNew ? { id: uid(), active: true } : empById(e.id);
      rec.name = name; rec.code = code; rec.dept = $('#e_dept').value.trim(); rec.joined = $('#e_joined').value;
      if (!isNew) {
        rec.active = $('#e_active').checked;
        rec.left = rec.active ? '' : ($('#e_left').value || todayIso());
      }
      if (pin) { rec.salt = uid(); rec.pinHash = await hashPin(pin, rec.salt); }
      if (isNew) db.employees.push(rec);
      audit((isNew ? 'Added employee ' : 'Updated employee ') + name + (pin ? ' (PIN set)' : ''));
      save(); closeModal(); render();
      toast('Saved ' + name);
    });
  }

  /* Day detail: punches for one employee on one date, with corrections and leave marking. */
  function dayModal(empId, ds) {
    const e = empById(empId);
    const inf = dayInfo(e, ds);
    const leave = db.leaves[e.id + '|' + ds] || '';
    const ov = modal(
      '<h2>' + esc(e.name) + '</h2><p class="muted" style="margin:4px 0 12px">' + esc(fmtDate(parse(ds))) + ' · <b>' + esc(inf.code || 'Pending') + '</b>' +
      (inf.mins ? ' · ' + esc(dur(inf.mins)) : '') + (inf.late ? ' · <span class="pill late">Late</span>' : '') +
      (inf.hol ? ' · Holiday: ' + esc(inf.hol.name) : inf.wo ? ' · Weekly off' : '') + '</p>' +
      '<h3>Punches</h3><div class="stack" id="sesslist" style="margin:8px 0 14px">' +
      (inf.sess.map(s => '<div class="sess" data-sid="' + s.id + '"><label class="f">In<input type="time" class="s_in" value="' + hm(s.in) + '"></label>' +
        '<label class="f">Out' + (s.out && iso(new Date(s.out)) !== ds ? ' (next day)' : '') + '<input type="time" class="s_out" value="' + (s.out ? hm(s.out) : '') + '"></label>' +
        '<button class="btn sm danger" data-a="sdel" data-sid="' + s.id + '">Remove</button></div>' +
        (s.edited ? '<div class="muted small">Edited by admin' + (s.note ? ': ' + esc(s.note) : '') + '</div>' : '')).join('') ||
        '<p class="muted">No punches.</p>') +
      '</div>' +
      '<div class="row"><button class="btn sm" data-a="sadd">+ Add punch pair</button></div>' +
      '<label class="f" style="margin-top:12px">Reason for change (saved in log)<input id="d_note" placeholder="e.g. Forgot to punch out, confirmed by manager"></label>' +
      '<h3 style="margin-top:16px">Leave</h3><div class="row" style="margin-top:6px">' +
      [['', 'None'], ['L', 'Paid leave'], ['LWP', 'Leave without pay']].map(([k, l]) => '<label class="check"><input type="radio" name="lv" value="' + k + '"' + (leave === k ? ' checked' : '') + '> ' + l + '</label>').join('') +
      '</div><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div>',
      true
    );
    const tsFor = (timeStr, base, after) => {
      const [h, mi] = timeStr.split(':').map(Number);
      const d = parse(ds); d.setHours(h, mi, 0, 0);
      let ts = d.getTime();
      if (after != null && ts <= after) ts += 86400000; // out earlier than in means it ended after midnight
      return ts;
    };
    ov.addEventListener('click', async ev => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      const act = a.dataset.a;
      if (act === 'cancel') return closeModal();
      if (act === 'sdel') { a.closest('.sess').remove(); return; }
      if (act === 'sadd') {
        const list = $('#sesslist', ov);
        const p = list.querySelector('p.muted'); if (p) p.remove();
        const div = document.createElement('div');
        div.className = 'sess'; div.dataset.sid = 'new';
        div.innerHTML = '<label class="f">In<input type="time" class="s_in" value="' + esc(db.settings.start) + '"></label><label class="f">Out<input type="time" class="s_out"></label><button class="btn sm danger" data-a="sdel">Remove</button>';
        list.appendChild(div);
        return;
      }
      if (act === 'save') {
        const note = $('#d_note', ov).value.trim();
        const rows = Array.from(ov.querySelectorAll('.sess'));
        const keep = new Set();
        const changes = [];
        for (const r of rows) {
          const vin = r.querySelector('.s_in').value, vout = r.querySelector('.s_out').value;
          if (!vin) continue;
          const tin = tsFor(vin);
          const tout = vout ? tsFor(vout, null, tin) : null;
          if (r.dataset.sid === 'new') {
            const s = { id: uid(), emp: e.id, in: tin, out: tout, date: ds, src: 'admin', edited: true, note };
            db.sessions.push(s); keep.add(s.id); changes.push('added ' + vin + '–' + (vout || '?'));
          } else {
            const s = db.sessions.find(x => x.id === r.dataset.sid);
            keep.add(s.id);
            if (s.in !== tin || s.out !== tout) {
              changes.push('changed ' + hm(s.in) + '–' + (s.out ? hm(s.out) : '?') + ' to ' + vin + '–' + (vout || '?'));
              s.in = tin; s.out = tout; s.edited = true; s.note = note;
            }
          }
        }
        inf.sess.forEach(s => { if (!keep.has(s.id)) { db.sessions = db.sessions.filter(x => x.id !== s.id); changes.push('removed ' + hm(s.in) + '–' + (s.out ? hm(s.out) : '?')); } });
        const lv = (ov.querySelector('input[name=lv]:checked') || {}).value || '';
        if (lv !== leave) {
          if (lv) db.leaves[e.id + '|' + ds] = lv; else delete db.leaves[e.id + '|' + ds];
          changes.push('leave ' + (leave || 'none') + ' → ' + (lv || 'none'));
        }
        if (changes.length) audit(e.name + ' ' + ds + ': ' + changes.join('; ') + (note ? ' (' + note + ')' : ''));
        save(); closeModal(); render();
        if (changes.length) toast('Saved');
      }
    });
  }

  function holsHtml() {
    const list = db.holidays.slice().sort((a, b) => a.date.localeCompare(b.date));
    return '<div class="stack"><h2>Holidays</h2>' +
      '<div class="card row"><label class="f" style="flex:1;min-width:150px">Date<input id="h_date" type="date"></label><label class="f" style="flex:2;min-width:180px">Name<input id="h_name" placeholder="e.g. Diwali"></label><button class="btn primary" data-act="holadd" style="align-self:flex-end">Add</button></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th></th></tr></thead><tbody>' +
      (list.map(h => '<tr><td>' + esc(h.date) + '</td><td>' + DOW[parse(h.date).getDay()] + '</td><td>' + esc(h.name) + '</td><td><button class="btn sm danger" data-act="holdel" data-d="' + h.date + '">Remove</button></td></tr>').join('') ||
        '<tr><td colspan="4" class="muted">No holidays added.</td></tr>') +
      '</tbody></table></div><p class="muted small">Holidays are paid days off. Anyone who works on one gets it counted under "Off-days worked".</p></div>';
  }

  function settingsHtml() {
    const S = db.settings;
    return '<div class="card stack" style="max-width:720px"><h2>Settings</h2>' +
      '<label class="f">Company / office name<input id="st_company" value="' + esc(S.company) + '"></label>' +
      '<div class="grid2"><label class="f">Office start time<input id="st_start" type="time" value="' + esc(S.start) + '"></label>' +
      '<label class="f">Grace minutes before "late"<input id="st_grace" type="number" min="0" value="' + esc(S.grace) + '"></label>' +
      '<label class="f">Hours for a full day (P)<input id="st_full" type="number" min="0" step="0.25" value="' + esc(S.fullHours) + '"></label>' +
      '<label class="f">Hours for a half day (HD)<input id="st_half" type="number" min="0" step="0.25" value="' + esc(S.halfHours) + '"></label></div>' +
      '<div><div class="f" style="font-size:.85rem;font-weight:600;color:var(--muted);margin-bottom:6px">Weekly off days</div>' +
      DOW.map((d, i) => '<label class="check"><input type="checkbox" class="st_wo" value="' + i + '"' + ((S.weekOffs || []).includes(i) ? ' checked' : '') + '> ' + d + '</label>').join('') + '</div>' +
      '<div class="grid2"><label class="f">Missing punch-out counts as<select id="st_mp">' +
      [['HD', 'Half day'], ['P', 'Full day'], ['A', 'Absent']].map(([k, l]) => '<option value="' + k + '"' + (S.mpRule === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      '<label class="f">Auto-close a punch-in after (hours)<input id="st_auto" type="number" min="4" max="24" value="' + esc(S.autoCloseHours) + '"></label>' +
      '<label class="f">Theme<select id="st_theme">' + [['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => '<option value="' + k + '"' + (S.theme === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label></div>' +
      '<label class="check"><input type="checkbox" id="st_pin"' + (S.requirePin ? ' checked' : '') + '> Ask employees for their PIN when punching (recommended, stops buddy punching)</label>' +
      '<p class="muted small">Rules: worked hours ≥ full-day hours → P; ≥ half-day hours → HD; less → A. "Late" means the first punch-in of the day came after start time + grace. If someone forgets to punch out, the punch closes as "MP" after the auto-close hours; fix it from the register.</p>' +
      '<div class="row"><button class="btn primary" data-act="stsave">Save settings</button><button class="btn" data-act="adminpin">Change admin PIN</button></div></div>';
  }

  function backupHtml() {
    return '<div class="stack"><div class="card stack" style="max-width:720px"><h2>Backup</h2>' +
      '<p class="muted">Records live only in this browser on this device. Clearing browser data, resetting the device, or uninstalling the app deletes them. Download a backup at least once a week and before every payroll.</p>' +
      '<div class="row"><button class="btn primary" data-act="bkdown">⬇ Download backup (.json)</button><label class="btn">⬆ Restore from backup<input type="file" id="bkfile" accept="application/json,.json" class="hidden"></label></div>' +
      '<div class="row"><button class="btn danger" data-act="wipe">Erase all data on this device</button></div></div>' +
      '<div class="card"><h2>Change log</h2><p class="muted small">Every admin correction and employee change is recorded here.</p>' +
      '<div class="tablewrap" style="max-height:420px;overflow:auto;margin-top:8px"><table><tbody>' +
      (db.audit.slice(0, 300).map(a => '<tr><td class="muted small">' + esc(new Date(a.ts).toLocaleString('en-IN')) + '</td><td style="white-space:normal">' + esc(a.msg) + '</td></tr>').join('') || '<tr><td class="muted">Nothing yet.</td></tr>') +
      '</tbody></table></div></div></div>';
  }

  /* ------------------------------------------------------------------ exports */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  // Leading = + - @ are prefixed so spreadsheet apps do not run them as formulas.
  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const monthTag = () => ui.month.y + '-' + pad(ui.month.m + 1);

  function exportSummary() {
    const { y, m } = ui.month;
    const days = monthDays(y, m);
    const rows = [['Code', 'Name', 'Department', ...days.map(d => d.slice(8)), 'Present', 'Half days', 'Absent', 'Missing punch-out', 'Paid leave', 'LWP', 'Weekly off', 'Holidays', 'Late', 'Hours worked', 'Off-days worked', 'Payable days']];
    db.employees.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
      const s = monthSummary(e, y, m);
      rows.push([e.code || '', e.name, e.dept || '', ...s.days.map(d => d.code + (d.late ? '*' : '')), s.P, s.HD, s.A, s.MP, s.L, s.LWP, s.WO, s.H, s.late, (s.mins / 60).toFixed(2), s.workedOff, s.payable]);
    });
    rows.push([]);
    rows.push(['* = late arrival. Payable days = P + 0.5×HD + L + WO + H + MP (' + db.settings.mpRule + ' rule).']);
    download('attendance-register-' + monthTag() + '.csv', csv(rows), 'text/csv');
  }
  function exportLog() {
    const { y, m } = ui.month;
    const pre = y + '-' + pad(m + 1);
    const rows = [['Date', 'Code', 'Name', 'Department', 'In', 'Out', 'Minutes', 'Source', 'Edited', 'Note']];
    db.sessions.filter(s => s.date.startsWith(pre)).sort((a, b) => a.in - b.in).forEach(s => {
      const e = empById(s.emp) || { name: '(deleted)' };
      rows.push([s.date, e.code || '', e.name, e.dept || '', new Date(s.in).toLocaleString('en-IN'), s.out ? new Date(s.out).toLocaleString('en-IN') : '',
        s.out ? Math.round((s.out - s.in) / 60000) : '', s.src || '', s.edited ? 'yes' : '', s.note || '']);
    });
    download('punch-log-' + monthTag() + '.csv', csv(rows), 'text/csv');
  }

  /* ------------------------------------------------------------------ admin access */
  async function askAdmin() {
    for (let tries = 0; tries < 5; tries++) {
      const p = pinPad('Admin', 'Enter the admin PIN');
      if (tries) pinPad.current.pinError('Wrong PIN.');
      const pin = await p;
      if (pin === null) return false;
      if (await hashPin(pin, db.settings.adminSalt) === db.settings.adminHash) { closeModal(); return true; }
    }
    closeModal(); toast('Too many wrong attempts.');
    return false;
  }
  // Lock admin automatically after 5 minutes without any touch, so the kiosk is never left open.
  function bumpIdle() {
    clearTimeout(ui.idleTimer);
    if (ui.view === 'admin') ui.idleTimer = setTimeout(() => { ui.view = 'kiosk'; closeModal(); render(); toast('Admin locked'); }, 5 * 60000);
  }
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, bumpIdle, { passive: true }));

  /* ------------------------------------------------------------------ events */
  document.addEventListener('input', e => {
    if (e.target.id === 'kq') {
      ui.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const k = $('#kq'); k.focus(); k.setSelectionRange(pos, pos);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'kq' && e.key === 'Enter') {
      const first = $('.tile[data-act=punch]');
      if (first) punch(first.dataset.id);
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'bkfile' && e.target.files[0]) {
      const r = new FileReader();
      r.onload = async () => {
        try {
          const d = JSON.parse(r.result);
          if (!d || !Array.isArray(d.employees) || !Array.isArray(d.sessions) || !d.settings) throw new Error('bad');
          if (!await confirmBox('Replace everything on this device with this backup (' + d.employees.length + ' employees, ' + d.sessions.length + ' punches)?', 'Restore')) return;
          db = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), d, { settings: Object.assign({}, DEFAULTS.settings, d.settings) });
          audit('Restored from backup');
          save(); render(); toast('Backup restored');
        } catch (err) { toast('That file is not an attendance backup.'); }
      };
      r.readAsText(e.target.files[0]);
    }
  });

  document.addEventListener('click', async e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { ui.tab = tab.dataset.tab; return render(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    switch (act) {
      case 'setup': {
        const pin = $('#s_pin').value.trim(), pin2 = $('#s_pin2').value.trim(), err = $('#s_err');
        if (!/^\d{4}$/.test(pin)) return (err.textContent = 'Admin PIN must be exactly 4 digits.');
        if (pin !== pin2) return (err.textContent = 'The two PINs do not match.');
        const S = db.settings;
        S.company = $('#s_company').value.trim(); S.start = $('#s_start').value || '09:30'; S.grace = Number($('#s_grace').value) || 0;
        S.adminSalt = uid(); S.adminHash = await hashPin(pin, S.adminSalt);
        audit('Set up');
        save(); ui.view = 'admin'; ui.tab = 'emps'; render(); bumpIdle();
        return;
      }
      case 'admin': if (await askAdmin()) { ui.view = 'admin'; render(); bumpIdle(); } return;
      case 'kiosk': case 'lock': ui.view = 'kiosk'; return render();
      case 'punch': return punch(id);
      case 'day': return dayModal(id, b.dataset.d);
      case 'mprev': case 'mnext': {
        const d = new Date(ui.month.y, ui.month.m + (act === 'mnext' ? 1 : -1), 1);
        ui.month = { y: d.getFullYear(), m: d.getMonth() }; return render();
      }
      case 'csvsum': return exportSummary();
      case 'csvlog': return exportLog();
      case 'print': return window.print();
      case 'empnew': return empForm(null);
      case 'empedit': return empForm(empById(id));
      case 'holadd': {
        const d = $('#h_date').value, n = $('#h_name').value.trim();
        if (!d || !n) return toast('Enter a date and a name.');
        db.holidays = db.holidays.filter(h => h.date !== d).concat({ date: d, name: n });
        audit('Holiday added: ' + d + ' ' + n); save(); return render();
      }
      case 'holdel':
        db.holidays = db.holidays.filter(h => h.date !== b.dataset.d);
        audit('Holiday removed: ' + b.dataset.d); save(); return render();
      case 'stsave': {
        const S = db.settings;
        const full = Number($('#st_full').value), half = Number($('#st_half').value);
        if (!(full > 0) || !(half > 0) || half > full) return toast('Half-day hours must be more than 0 and not more than full-day hours.');
        S.company = $('#st_company').value.trim(); S.start = $('#st_start').value || S.start; S.grace = Number($('#st_grace').value) || 0;
        S.fullHours = full; S.halfHours = half;
        S.weekOffs = Array.from(document.querySelectorAll('.st_wo:checked')).map(x => Number(x.value));
        S.mpRule = $('#st_mp').value; S.autoCloseHours = Math.min(24, Math.max(4, Number($('#st_auto').value) || 16));
        S.requirePin = $('#st_pin').checked; S.theme = $('#st_theme').value;
        audit('Settings changed'); save(); render(); return toast('Settings saved');
      }
      case 'adminpin': {
        const p1 = await pinPad('New admin PIN', 'Enter a new 4-digit PIN');
        if (p1 === null) return;
        const p2 = await pinPad('New admin PIN', 'Enter it again');
        closeModal();
        if (p2 === null) return;
        if (p1 !== p2) return toast('PINs did not match. Not changed.');
        db.settings.adminSalt = uid(); db.settings.adminHash = await hashPin(p1, db.settings.adminSalt);
        audit('Admin PIN changed'); save(); return toast('Admin PIN changed');
      }
      case 'bkdown':
        download('attendance-backup-' + todayIso() + '.json', JSON.stringify(db, null, 1), 'application/json');
        db.settings.lastBackup = Date.now(); save(); return;
      case 'wipe':
        if (!await confirmBox('Erase ALL employees, punches, holidays and settings from this device? This cannot be undone. Download a backup first.', 'Erase everything')) return;
        try { localStorage.removeItem(KEY); } catch (er) { /* ignore */ }
        db = JSON.parse(JSON.stringify(DEFAULTS)); ui.view = 'kiosk'; return render();
    }
  });

  // Keep the kiosk tiles fresh (status changes, midnight roll-over) without disturbing someone mid-punch.
  setInterval(() => { if (ui.view === 'kiosk' && !$('.ov') && document.activeElement?.id !== 'kq') render(); }, 60000);
  // Another tab on the same device changed the data.
  window.addEventListener('storage', e => { if (e.key === KEY) { db = load(); if (!$('.ov')) render(); } });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
