/* Ghar ka Vault: Family Money & Documents Vault, v1.1.0
   Offline-first. All data stays in this browser (localStorage), optionally encrypted with a passcode.
   Interface languages: English, Hindi, Gujarati (see i18n.js). Access is gated by a signed licence key (see license-config.js). */
(function () {
  'use strict';

  const VERSION = '1.1.0';
  const LIC = window.FV_LICENSE || {};
  const I18N = window.FV_I18N || {};

  /* ------------------------------------------------------------------ environment flags */
  const DEV_HOST = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const DEMO_MODE = /[?&]demo(=|&|$)/.test(location.search);
  const ENFORCE = LIC.enforce !== false && (!DEV_HOST || /[?&]gate=1/.test(location.search));
  const HAS_CRYPTO = !!(window.crypto && crypto.subtle);

  /* ------------------------------------------------------------------ language */
  const LANGS = { en: { name: 'English', loc: 'en-IN' }, hi: { name: 'हिन्दी', loc: 'hi-IN' }, gu: { name: 'ગુજરાતી', loc: 'gu-IN' } };
  let lang = 'en';
  function t(s, vars) {
    if (!s) return '';
    let out = s;
    if (lang !== 'en') {
      const d = I18N[lang];
      if (d && Object.prototype.hasOwnProperty.call(d, s)) out = d[s];
      else if (window.__FV_DEBUG) (window.__missing = window.__missing || new Set()).add(s);
    }
    if (window.__FV_DEBUG) (window.__tk = window.__tk || new Set()).add(s);
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return out;
  }
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (s, vars) => esc(t(s, vars));
  // Like T, but the values passed in vars are inserted as ready-made HTML (escape them yourself).
  const TH = (s, vars) => esc(t(s)).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
  const LOC = () => LANGS[lang].loc;

  /* ------------------------------------------------------------------ helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const diffDays = (a, b) => Math.round((a - b) / 86400000);
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => {
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), last));
    return r;
  };
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const fmtDate = d => d.toLocaleDateString(LOC(), { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = d => d.toLocaleDateString(LOC(), { day: 'numeric', month: 'short' });
  const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString(LOC(), { month: 'short' });
  const money = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const UNITS = { en: ['L', 'Cr'], hi: [' लाख', ' करोड़'], gu: [' લાખ', ' કરોડ'] };
  const compact = n => {
    n = Number(n) || 0;
    const a = Math.abs(n), u = UNITS[lang];
    if (a >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + u[1];
    if (a >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + u[0];
    return money(n);
  };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { localStorage.setItem(k, v); };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const b64uToBytes = s => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));

  /* ------------------------------------------------------------------ modules (the schema drives forms, lists, calendar, emergency sheet) */
  const FREQ = { 'Monthly': 1, 'Quarterly': 3, 'Half-yearly': 6, 'Yearly': 12 };
  const FREQ_OPTS = ['Yearly', 'Half-yearly', 'Quarterly', 'Monthly'];
  const DOC_TYPES = ['Aadhaar', 'PAN card', 'Passport', 'Driving licence', 'Voter ID', 'Ration card', 'Birth certificate', 'Marriage certificate',
    'Property papers', 'Rent agreement', 'Will', 'Education certificates', 'Employment / salary papers', 'Tax returns / Form 16', 'PF / UAN / pension papers',
    'Vehicle RC', 'Insurance originals', 'Medical records', 'Vaccination records', 'Share / demat papers', 'Business registration / GST papers', 'Other'];

  const MODULES = [
    {
      key: 'insurance', title: 'Insurance', one: 'policy', icon: '🛡️',
      tip: 'Health, term, life, motor, home. Store only the last 4 digits of a policy number.',
      eg: 'Example: your family health policy and the date it renews.',
      fields: [
        { k: 'type', label: 'Type', type: 'select', opts: ['Health', 'Term life', 'Life / LIC', 'Motor', 'Home', 'Travel', 'Personal accident', 'Other'] },
        { k: 'insurer', label: 'Insurer', type: 'text', ph: 'e.g. HDFC Ergo, LIC', req: 1 },
        { k: 'holder', label: 'Who is covered', type: 'text', ph: 'e.g. Family floater, Papa' },
        { k: 'last4', label: 'Policy no. (last 4 digits only)', type: 'text', last4: 1 },
        { k: 'sum', label: 'Sum assured (₹)', type: 'number' },
        { k: 'premium', label: 'Premium (₹)', type: 'number' },
        { k: 'freq', label: 'Premium frequency', type: 'select', opts: FREQ_OPTS.concat(['One-time / no renewal']), def: 'Yearly' },
        { k: 'due', label: 'Next premium / renewal date', type: 'date' },
        { k: 'auto', label: 'Auto-debit (do not flag as overdue)', type: 'check', full: 1 },
        { k: 'nominee', label: 'Nominee', type: 'text' },
        { k: 'agent', label: 'Agent / helpline', type: 'text', ph: 'Name and phone' },
        { k: 'where', label: 'Where is the original?', type: 'text', ph: 'e.g. Almirah, blue file', full: 1 },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => t(r.type || 'Policy') + ' · ' + (r.insurer || ''),
      sub: r => [r.holder, r.last4 ? '••' + r.last4 : ''].filter(Boolean).join(' · '),
      dates: [{ f: 'due', label: 'Premium due', freq: 'freq', amt: 'premium', auto: 'auto' }],
      amount: 'premium'
    },
    {
      key: 'loans', title: 'Loans & EMIs', one: 'loan', icon: '🏦',
      tip: 'Home, car, personal, education, credit card. Never store card numbers or logins.',
      eg: 'Example: home loan EMI of ₹38,400 on the 5th of every month.',
      fields: [
        { k: 'type', label: 'Type', type: 'select', opts: ['Home loan', 'Car loan', 'Personal loan', 'Education loan', 'Credit card', 'Gold loan', 'Business loan', 'Other'] },
        { k: 'lender', label: 'Lender', type: 'text', ph: 'e.g. SBI, HDFC Bank', req: 1 },
        { k: 'who', label: 'Borrower', type: 'text' },
        { k: 'last4', label: 'Loan / card no. (last 4 digits only)', type: 'text', last4: 1 },
        { k: 'emi', label: 'EMI / monthly payment (₹)', type: 'number' },
        { k: 'next', label: 'Next EMI date', type: 'date' },
        { k: 'end', label: 'Last EMI date', type: 'date' },
        { k: 'outstanding', label: 'Outstanding amount (₹)', type: 'number' },
        { k: 'rate', label: 'Interest rate (% a year)', type: 'number' },
        { k: 'auto', label: 'Auto-debit (do not flag as overdue)', type: 'check', def: true, full: 1 },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => t(r.type || 'Loan') + ' · ' + (r.lender || ''),
      sub: r => [r.who, r.last4 ? '••' + r.last4 : '', r.outstanding ? t('{amt} outstanding', { amt: money(r.outstanding) }) : ''].filter(Boolean).join(' · '),
      dates: [{ f: 'next', label: 'EMI', step: 1, amt: 'emi', auto: 'auto' }, { f: 'end', label: 'Final EMI' }],
      amount: 'emi'
    },
    {
      key: 'investments', title: 'FDs & Investments', one: 'investment', icon: '📈',
      tip: 'FDs, PPF, SIPs, NPS, demat, gold. Record what exists and who the nominee is.',
      eg: 'Example: an FD maturing in March, or a monthly SIP.',
      fields: [
        { k: 'kind', label: 'Type', type: 'select', opts: ['Fixed deposit', 'Recurring deposit', 'Mutual fund / SIP', 'PPF', 'EPF', 'NPS', 'Stocks / demat', 'Gold / SGB', 'Post office', 'Other'] },
        { k: 'inst', label: 'Bank / company', type: 'text', ph: 'e.g. SBI, HDFC AMC', req: 1 },
        { k: 'holder', label: 'In whose name', type: 'text' },
        { k: 'last4', label: 'Account / folio no. (last 4 digits only)', type: 'text', last4: 1 },
        { k: 'value', label: 'Amount / current value (₹)', type: 'number' },
        { k: 'maturity', label: 'Maturity date', type: 'date' },
        { k: 'contrib', label: 'Monthly SIP / RD amount (₹)', type: 'number' },
        { k: 'contribDate', label: 'Next SIP / RD date', type: 'date' },
        { k: 'nominee', label: 'Nominee', type: 'text' },
        { k: 'joint', label: 'Joint holder', type: 'text' },
        { k: 'where', label: 'Where are the papers / login kept?', type: 'text', ph: 'e.g. Certificate in locker; login with spouse', full: 1 },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => t(r.kind || 'Investment') + ' · ' + (r.inst || ''),
      sub: r => [r.holder, r.last4 ? '••' + r.last4 : '', r.nominee ? t('Nominee: {name}', { name: r.nominee }) : ''].filter(Boolean).join(' · '),
      dates: [{ f: 'maturity', label: 'Matures' }, { f: 'contribDate', label: 'SIP / RD', step: 1, amt: 'contrib', always: 1 }],
      amount: 'value'
    },
    {
      key: 'subscriptions', title: 'Subscriptions & Bills', one: 'bill', icon: '🔁',
      tip: 'OTT, apps, cloud storage, internet, society maintenance, school fees, memberships.',
      eg: 'Example: Netflix, broadband, society maintenance, school fees.',
      fields: [
        { k: 'name', label: 'Name', type: 'text', ph: 'e.g. Netflix, JioFiber, School fees', req: 1 },
        { k: 'cat', label: 'Category', type: 'select', opts: ['OTT / entertainment', 'App / software', 'Cloud storage', 'Internet / mobile', 'Society / rent', 'School / education', 'Gym / membership', 'Utilities', 'Other'] },
        { k: 'amount', label: 'Amount (₹)', type: 'number' },
        { k: 'freq', label: 'Billing frequency', type: 'select', opts: FREQ_OPTS, def: 'Monthly' },
        { k: 'next', label: 'Next renewal / due date', type: 'date' },
        { k: 'via', label: 'Paid through', type: 'select', opts: ['UPI AutoPay', 'Credit card', 'Debit card', 'Net banking', 'Manual / cash'] },
        { k: 'auto', label: 'Auto-debit (do not flag as overdue)', type: 'check', def: true, full: 1 },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => r.name || t('Bill'),
      sub: r => [r.cat && t(r.cat), r.via && t(r.via)].filter(Boolean).join(' · '),
      dates: [{ f: 'next', label: 'Renews', freq: 'freq', amt: 'amount', auto: 'auto' }],
      amount: 'amount'
    },
    {
      key: 'vehicles', title: 'Vehicles', one: 'vehicle', icon: '🚗',
      tip: 'Insurance, PUC and service dates, so a lapsed document never costs you a fine.',
      eg: 'Example: your car, with insurance expiry and PUC dates.',
      fields: [
        { k: 'name', label: 'Vehicle', type: 'text', ph: 'e.g. Honda City, Activa', req: 1 },
        { k: 'reg', label: 'Registration number', type: 'text', ph: 'e.g. GJ01AB1234' },
        { k: 'owner', label: 'Owner', type: 'text' },
        { k: 'insurer', label: 'Insurer', type: 'text' },
        { k: 'insExp', label: 'Insurance expires on', type: 'date' },
        { k: 'puc', label: 'PUC expires on', type: 'date' },
        { k: 'service', label: 'Next service due', type: 'date' },
        { k: 'where', label: 'Where are the RC and papers?', type: 'text', ph: 'e.g. Glove box, DigiLocker', full: 1 },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => (r.name || t('Vehicle')) + (r.reg ? ' · ' + r.reg : ''),
      sub: r => [r.owner, r.insurer].filter(Boolean).join(' · '),
      dates: [{ f: 'insExp', label: 'Insurance' }, { f: 'puc', label: 'PUC' }, { f: 'service', label: 'Service' }]
    },
    {
      key: 'warranties', title: 'Warranties', one: 'item', icon: '🧾',
      tip: 'Appliances and gadgets: know what is still under warranty and where the bill is.',
      eg: 'Example: fridge, washing machine, AC, phone.',
      fields: [
        { k: 'item', label: 'Item', type: 'text', ph: 'e.g. Samsung fridge', req: 1 },
        { k: 'brand', label: 'Brand / model', type: 'text' },
        { k: 'bought', label: 'Purchase date', type: 'date' },
        { k: 'price', label: 'Price (₹)', type: 'number' },
        { k: 'end', label: 'Warranty ends on', type: 'date' },
        { k: 'service', label: 'Service centre / number', type: 'text' },
        { k: 'bill', label: 'Where is the bill?', type: 'text', ph: 'e.g. Email folder "Bills", drawer', full: 1 },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => r.item || t('Item'),
      sub: r => [r.brand, r.service].filter(Boolean).join(' · '),
      dates: [{ f: 'end', label: 'Warranty ends' }],
      amount: 'price'
    },
    {
      key: 'accounts', title: 'Bank Accounts', one: 'account', icon: '💳',
      tip: 'Savings, joint, demat, locker. Last 4 digits only. No passwords, ever.',
      eg: 'Example: salary account with the branch and nominee.',
      fields: [
        { k: 'bank', label: 'Bank / broker', type: 'text', ph: 'e.g. SBI, HDFC, Zerodha', req: 1 },
        { k: 'kind', label: 'Type', type: 'select', opts: ['Savings', 'Salary', 'Current', 'Joint', 'Demat', 'Locker', 'Credit card', 'Wallet / UPI', 'Other'] },
        { k: 'holder', label: 'Account holder', type: 'text' },
        { k: 'last4', label: 'Account no. (last 4 digits only)', type: 'text', last4: 1 },
        { k: 'branch', label: 'Branch / relationship manager', type: 'text' },
        { k: 'nominee', label: 'Nominee', type: 'text' },
        { k: 'renew', label: 'Yearly fee / locker rent due', type: 'date' },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => (r.bank || t('Account')) + ' · ' + t(r.kind || ''),
      sub: r => [r.holder, r.last4 ? '••' + r.last4 : ''].filter(Boolean).join(' · '),
      dates: [{ f: 'renew', label: 'Fee / rent due', step: 12 }]
    },
    {
      key: 'documents', title: 'Documents Map', one: 'document', icon: '📁',
      tip: 'Write down where originals and copies are. Do not paste the documents themselves here.',
      eg: 'Example: property papers are in the bank locker; the will is with the lawyer.',
      fields: [
        { k: 'doc', label: 'Document', type: 'select', opts: DOC_TYPES },
        { k: 'name', label: 'If "Other", what is it?', type: 'text', ph: 'e.g. Gift deed, Society share certificate' },
        { k: 'who', label: 'For whom', type: 'text' },
        { k: 'ref', label: 'Number (last 4 digits only)', type: 'text', last4: 1 },
        { k: 'where', label: 'Where is the original?', type: 'text', ph: 'e.g. SBI locker no. 12', req: 1, full: 1 },
        { k: 'digital', label: 'Digital copy', type: 'text', ph: 'e.g. DigiLocker, Drive > Family > Property', full: 1 },
        { k: 'expiry', label: 'Expires on (if it does)', type: 'date' },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => ((r.doc === 'Other' && r.name) ? r.name : t(r.doc || 'Document')) + (r.who ? ' · ' + r.who : ''),
      sub: r => [r.where ? t('Original: {where}', { where: r.where }) : '', r.ref ? '••' + r.ref : ''].filter(Boolean).join(' · '),
      dates: [{ f: 'expiry', label: 'Expires' }]
    },
    {
      key: 'contacts', title: 'Key Contacts', one: 'contact', icon: '☎️',
      tip: 'The people your family should call first: relatives, CA, lawyer, agent, doctor, banker.',
      eg: 'Example: your CA, insurance agent and family doctor.',
      fields: [
        { k: 'name', label: 'Name', type: 'text', req: 1 },
        { k: 'role', label: 'Who are they', type: 'select', opts: ['Family', 'Friend', 'CA / accountant', 'Lawyer', 'Insurance agent', 'Banker / advisor', 'Doctor', 'Employer / HR', 'Other'] },
        { k: 'phone', label: 'Phone', type: 'tel' },
        { k: 'email', label: 'Email', type: 'email' },
        { k: 'notes', label: 'Notes', type: 'textarea', full: 1 }
      ],
      head: r => r.name || t('Contact'),
      sub: r => [r.role && t(r.role), r.phone].filter(Boolean).join(' · '),
      dates: []
    }
  ];
  const MOD = Object.fromEntries(MODULES.map(m => [m.key, m]));
  // Pseudo-module for the yearly cover-review reminder (not a section the user fills in).
  MOD.review = { key: 'review', title: 'Cover review', icon: '🔍', head: () => t('Review your insurance cover'), sub: () => '', dates: [] };

  /* ------------------------------------------------------------------ state & storage */
  const KEYS = { plain: 'fv.v1.data', enc: 'fv.v1.enc', prefs: 'fv.v1.prefs', corrupt: 'fv.v1.corrupt', lic: 'fv.v1.lic' };
  let state = null;
  let cryptoKey = null;
  let cryptoSalt = null;
  let storageOk = true;
  let installEvt = null;
  let licence = null;
  let screenFn = null;
  const ui = { calYear: new Date().getFullYear(), lastRoute: '' };

  function blank() {
    return { v: 1, meta: { created: new Date().toISOString(), lastBackup: null, onboarded: false }, settings: { household: '', note: '', window: 60, review: { on: true, last: null, snooze: null } }, data: {} };
  }
  function normalize(s) {
    s = s && typeof s === 'object' ? s : blank();
    s.meta = Object.assign({ created: new Date().toISOString(), lastBackup: null, onboarded: false }, s.meta || {});
    s.settings = Object.assign({ household: '', note: '', window: 60 }, s.settings || {});
    s.settings.review = Object.assign({ on: true, last: null, snooze: null }, s.settings.review || {});
    s.data = s.data && typeof s.data === 'object' ? s.data : {};
    MODULES.forEach(m => { if (!Array.isArray(s.data[m.key])) s.data[m.key] = []; });
    return s;
  }
  function getPrefs() { try { return JSON.parse(lsGet(KEYS.prefs) || '{}'); } catch (e) { return {}; } }
  function setPrefs(p) { try { lsSet(KEYS.prefs, JSON.stringify(Object.assign(getPrefs(), p))); } catch (e) { /* ignore */ } }
  function applyTheme() {
    const th = getPrefs().theme || 'auto';
    if (th === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }
  function initLang() {
    let l = getPrefs().lang;
    if (!LANGS[l]) {
      const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
      l = LANGS[nav] ? nav : 'en';
    }
    lang = l;
    document.documentElement.lang = l;
  }
  function langSelect() {
    return '<select class="langsel" aria-label="' + T('Language') + '">' + Object.keys(LANGS).map(k => '<option value="' + k + '" ' + (k === lang ? 'selected' : '') + '>' + esc(LANGS[k].name) + '</option>').join('') + '</select>';
  }
  function setLang(l) {
    if (!LANGS[l]) return;
    lang = l; setPrefs({ lang: l });
    document.documentElement.lang = l;
    $$('.overlay').forEach(o => o.remove());
    if (screenFn) screenFn();
  }

  const toB64 = buf => {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = s => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptText(text, key, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return { v: 1, s: toB64(salt), i: toB64(iv), c: toB64(ct) };
  }
  async function decryptBlob(blob, key) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.i) }, key, fromB64(blob.c));
    return new TextDecoder().decode(pt);
  }

  let saveChain = Promise.resolve();
  function save() {
    if (!state || DEMO_MODE) return saveChain;
    const snap = JSON.stringify(state);
    const key = cryptoKey, salt = cryptoSalt;
    saveChain = saveChain.then(async () => {
      try {
        if (key) lsSet(KEYS.enc, JSON.stringify(await encryptText(snap, key, salt)));
        else lsSet(KEYS.plain, snap);
        storageOk = true;
      } catch (e) {
        storageOk = false;
        toast(t('Could not save on this device. Export a backup now.'));
      }
    });
    return saveChain;
  }

  /* ------------------------------------------------------------------ licence */
  async function verifyKey(raw) {
    const key = (raw || '').trim().replace(/\s+/g, '');
    const m = /^GKV1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
    if (!m) return { ok: false, why: 'format' };
    if (!LIC.publicKey) return { ok: false, why: 'setup' };
    if (!HAS_CRYPTO) return { ok: false, why: 'crypto' };
    try {
      const pub = await crypto.subtle.importKey('jwk', LIC.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64uToBytes(m[2]), new TextEncoder().encode(m[1]));
      if (!good) return { ok: false, why: 'bad' };
      const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(m[1])));
      return { ok: true, payload, key };
    } catch (e) { return { ok: false, why: 'bad' }; }
  }
  async function fetchRevoked() {
    try {
      const r = await fetch('revoked.json', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      return Array.isArray(j.ids) ? j.ids : null;
    } catch (e) { return null; }
  }
  async function checkLicence() {
    if (!ENFORCE || DEMO_MODE) return true;
    if (!LIC.publicKey) { renderGate('setup'); return false; }
    const hm = /[#&]k=([^&]+)/.exec(location.hash);
    const fromLink = hm ? decodeURIComponent(hm[1]) : null;
    if (hm) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } }
    const candidate = fromLink || lsGet(KEYS.lic);
    if (candidate) {
      const v = await verifyKey(candidate);
      if (v.ok) {
        const revoked = await fetchRevoked();
        if (revoked && revoked.indexOf(v.payload.id) >= 0) { renderGate('revoked'); return false; }
        try { lsSet(KEYS.lic, v.key); } catch (e) { /* ignore */ }
        licence = v.payload;
        if (fromLink) setTimeout(() => toast(t('Licence activated for {name}.', { name: v.payload.n || '' })), 400);
        return true;
      }
      if (fromLink) { renderGate(v.why, fromLink); return false; }
    }
    renderGate();
    return false;
  }
  function renderGate(reason, keyTry) {
    screenFn = () => renderGate(reason, keyTry);
    const msgs = {
      bad: 'This key is not valid. Check that you pasted the whole key.',
      format: 'That does not look like a licence key. It starts with GKV1.',
      revoked: 'This key has been deactivated. Please contact support.',
      crypto: 'This browser cannot check keys. Open the https link in Chrome or Safari.',
      setup: 'Licence keys are not set up on this site yet. The site owner needs to run the setup step.'
    };
    const buy = LIC.buyUrl ? '<a href="' + esc(LIC.buyUrl) + '" target="_blank" rel="noopener">' + T('Get a key') + '</a> · ' : '';
    $('#root').innerHTML = '<div class="center"><div class="card"><div class="row between"><h1>🔑 ' + T('Ghar ka Vault') + '</h1>' + langSelect() + '</div>' +
      '<p class="muted">' + T('Enter the licence key you received after payment.') + '</p>' +
      '<form id="gatef"><textarea id="gatek" rows="3" placeholder="GKV1.…" autocomplete="off" spellcheck="false" required>' + esc(keyTry || '') + '</textarea>' +
      '<div class="err" id="gateerr" role="alert">' + (reason ? T(msgs[reason] || msgs.bad) : '') + '</div>' +
      '<button class="btn primary" style="width:100%;margin-top:10px" type="submit">' + T('Activate') + '</button></form>' +
      '<p class="small muted" style="margin-bottom:0">' + T('No key yet?') + ' ' + buy + '<a href="?demo">' + T('Try the live demo') + '</a></p></div></div>';
    $('#gatef').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#gatef button'); btn.disabled = true;
      const v = await verifyKey($('#gatek').value);
      if (!v.ok) { renderGate(v.why, $('#gatek').value); return; }
      const revoked = await fetchRevoked();
      if (revoked && revoked.indexOf(v.payload.id) >= 0) { renderGate('revoked'); return; }
      try { lsSet(KEYS.lic, v.key); } catch (er) { /* ignore */ }
      licence = v.payload;
      afterLicence();
    });
  }

  /* ------------------------------------------------------------------ events engine */
  function reviewBase() {
    const R = state.settings.review || {};
    if (R.on === false || !state.data.insurance.length) return null;
    let base;
    if (R.last) base = addMonths(parse(R.last), 12);
    else { const c = new Date(state.meta.created); base = addDays(new Date(c.getFullYear(), c.getMonth(), c.getDate()), 14); }
    if (R.snooze) { const s = parse(R.snooze); if (s && s > base) base = s; }
    return base;
  }
  function eventsOf(rec, mod, T0) {
    const out = [];
    (mod.dates || []).forEach(d => {
      const base = parse(rec[d.f]);
      if (!base) return;
      const step = d.step || (d.freq ? FREQ[rec[d.freq]] : 0) || 0;
      const auto = !!(step && (d.always || (d.auto && rec[d.auto])));
      let date = base;
      if (auto) {
        let k = Math.max(0, Math.floor(monthsBetween(base, T0) / step));
        while (addMonths(base, k * step) < T0) k++;
        date = addMonths(base, k * step);
      }
      out.push({ mod: mod.key, id: rec.id, field: d.f, label: d.label, rec, base, date, step, auto, amt: d.amt ? Number(rec[d.amt]) || 0 : 0, days: diffDays(date, T0) });
    });
    return out;
  }
  function allEvents(T0, includeExpired) {
    const out = [];
    MODULES.forEach(m => (state.data[m.key] || []).forEach(r => eventsOf(r, m, T0).forEach(e => out.push(e))));
    const rb = reviewBase();
    if (rb) out.push({ mod: 'review', id: 'review', field: 'review', label: 'Yearly check', rec: {}, base: rb, date: rb, step: 12, auto: false, amt: 0, days: diffDays(rb, T0) });
    return out.filter(e => includeExpired || !isExpired(e)).sort((a, b) => a.date - b.date);
  }
  const isExpired = e => !e.step && e.days < -60;
  function occurrences(e, start, end) {
    const out = [];
    if (!e.step) { if (e.base >= start && e.base <= end) out.push(e.base); return out; }
    let k = Math.max(0, Math.floor(monthsBetween(e.base, start) / e.step) - 1);
    for (let guard = 0; guard < 600; guard++, k++) {
      const d = addMonths(e.base, k * e.step);
      if (d > end) break;
      if (d >= start) out.push(d);
    }
    return out;
  }
  const statusOf = days => days < 0 ? 'over' : days <= 15 ? 'urgent' : days <= 45 ? 'soon' : 'ok';
  function rel(days) {
    if (days < 0) return days === -1 ? t('1 day overdue') : t('{n} days overdue', { n: -days });
    if (days === 0) return t('Today');
    if (days === 1) return t('Tomorrow');
    if (days <= 45) return t('in {n} days', { n: days });
    return t('in {n} months', { n: Math.round(days / 30) });
  }

  /* ------------------------------------------------------------------ UI primitives */
  let toastT = null;
  function toast(msg, undo) {
    $$('.toast').forEach(n => n.remove());
    clearTimeout(toastT);
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status');
    el.textContent = msg + ' ';
    if (undo) {
      const b = document.createElement('button');
      b.className = 'btn sm'; b.textContent = t('Undo');
      b.addEventListener('click', () => { undo(); el.remove(); });
      el.appendChild(b);
    }
    document.body.appendChild(el);
    toastT = setTimeout(() => el.remove(), undo ? 6000 : 3200);
  }
  const focusStack = [];
  function openSheet(inner, label) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(label || '') + '">' + inner + '</div>';
    ov.addEventListener('mousedown', e => { if (e.target === ov) closeSheet(); });
    focusStack.push(document.activeElement);
    document.body.appendChild(ov);
    const first = $('input:not([type=checkbox]):not([type=hidden]), select, textarea, button', ov.firstChild);
    if (first) setTimeout(() => first.focus(), 30);
    return ov;
  }
  function closeSheet() {
    const all = $$('.overlay');
    if (all.length) all[all.length - 1].remove();
    const f = focusStack.pop();
    if (f && f.focus && document.body.contains(f)) f.focus();
  }
  function confirmBox(msg, okLabel, danger) {
    return new Promise(resolve => {
      const ov = openSheet('<h2>' + T('Please confirm') + '</h2><p>' + esc(msg) + '</p><div class="footer"><button class="btn" data-x="no">' + T('Cancel') + '</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-x="yes">' + esc(okLabel || t('Yes')) + '</button></div>', t('Please confirm'));
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        closeSheet(); resolve(b.dataset.x === 'yes');
      });
    });
  }
  function askText(title, body, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const ov = openSheet('<h2>' + esc(title) + '</h2><p class="muted">' + esc(body) + '</p><form id="askf"><label class="f"><input type="password" name="p" autocomplete="off" required></label>' +
        (opts.confirm ? '<label class="f" style="margin-top:10px">' + T('Type it again') + '<input type="password" name="p2" autocomplete="off" required></label>' : '') +
        '<div class="err" id="askerr"></div><div class="footer"><button type="button" class="btn" data-x="no">' + T('Cancel') + '</button><button class="btn primary" type="submit">' + esc(opts.ok || t('OK')) + '</button></div></form>', title);
      ov.addEventListener('click', e => { if (e.target.closest('[data-x="no"]')) { closeSheet(); resolve(null); } });
      $('#askf', ov).addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target, p = f.p.value;
        if (opts.min && p.length < opts.min) { $('#askerr', ov).textContent = t('Use at least {n} characters.', { n: opts.min }); return; }
        if (opts.confirm && p !== f.p2.value) { $('#askerr', ov).textContent = t('The two entries do not match.'); return; }
        closeSheet(); resolve(p);
      });
    });
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; }
      ta.remove(); return ok;
    }
  }

  /* ------------------------------------------------------------------ forms */
  function fieldHTML(f, val) {
    const name = esc(f.k), label = T(f.label);
    if (f.type === 'check') return '<label class="ck ' + (f.full ? 'full' : '') + '"><input type="checkbox" name="' + name + '" ' + (val ? 'checked' : '') + '> ' + label + '</label>';
    let ctl;
    if (f.type === 'select') {
      const cur = val || f.def || f.opts[0];
      const opts = f.opts.indexOf(cur) < 0 ? f.opts.concat([cur]) : f.opts;
      ctl = '<select name="' + name + '">' + opts.map(o => '<option value="' + esc(o) + '" ' + (o === cur ? 'selected' : '') + '>' + T(o) + '</option>').join('') + '</select>';
    } else if (f.type === 'textarea') {
      ctl = '<textarea name="' + name + '" placeholder="' + T(f.ph || '') + '">' + esc(val) + '</textarea>';
    } else {
      const num = f.type === 'number';
      ctl = '<input type="' + f.type + '" name="' + name + '" value="' + esc(val) + '" placeholder="' + T(f.ph || '') + '" ' + (num ? 'inputmode="decimal" min="0" step="any"' : '') + ' ' + (f.req ? 'required' : '') + ' autocomplete="off">';
    }
    return '<label class="f ' + (f.full ? 'full' : '') + '">' + label + (f.req ? ' *' : '') + ctl + '</label>';
  }

  function openForm(modKey, id, focusField) {
    const mod = MOD[modKey];
    const rec = id ? state.data[modKey].find(r => r.id === id) : null;
    if (id && !rec) return;
    const vals = rec || {};
    const body = mod.fields.map(f => {
      let v = vals[f.k];
      if (!rec && v === undefined && f.def !== undefined) v = f.def;
      return fieldHTML(f, v);
    }).join('');
    const one = t(mod.one);
    const ov = openSheet('<h2>' + mod.icon + ' ' + T(rec ? 'Edit {one}' : 'Add {one}', { one }) + '</h2><p class="muted small" style="margin:-6px 0 12px">' + T(mod.tip) + '</p>' +
      '<form id="recf" novalidate><div class="fields">' + body + '</div><div class="err" id="recerr" role="alert"></div>' +
      '<div class="footer"><div class="row">' + (rec ? '<button type="button" class="btn danger" data-x="del">' + T('Delete') + '</button><button type="button" class="btn" data-x="dup">' + T('Duplicate') + '</button>' : '') + '</div>' +
      '<div class="row"><button type="button" class="btn" data-x="cancel">' + T('Cancel') + '</button><button class="btn primary" type="submit">' + T('Save') + '</button></div></div></form>', t(mod.title));
    if (focusField) { const el = $('[name="' + focusField + '"]', ov); if (el) setTimeout(() => el.focus(), 40); }
    ov.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'cancel') closeSheet();
      if (x === 'del') {
        if (await confirmBox(t('Delete this {one}? This cannot be undone (unless you have a backup).', { one }), t('Delete'), true)) {
          const copy = Object.assign({}, rec);
          state.data[modKey] = state.data[modKey].filter(r => r.id !== id);
          closeSheet(); save(); render();
          toast(t('Deleted.'), () => { state.data[modKey].push(copy); save(); render(); });
        }
      }
      if (x === 'dup') {
        const copy = Object.assign({}, rec, { id: uid(), demo: false });
        const f0 = mod.fields.find(f => f.type === 'text') || mod.fields[0];
        if (copy[f0.k]) copy[f0.k] = copy[f0.k] + ' (copy)';
        state.data[modKey].push(copy); closeSheet(); save(); render(); toast(t('Duplicated.'));
      }
    });
    $('#recf', ov).addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target), out = {};
      const err = $('#recerr', ov);
      for (const f of mod.fields) {
        if (f.type === 'check') { out[f.k] = fd.get(f.k) === 'on'; continue; }
        let v = (fd.get(f.k) || '').toString().trim();
        if (f.req && !v) { err.textContent = t('{field} is required.', { field: t(f.label) }); return; }
        if (f.last4 && v) {
          v = v.replace(/[\s-]/g, '');
          if (v.length > 4) { err.textContent = t('Please enter only the last 4 digits. Do not store the full number.'); return; }
        }
        if (f.type === 'number') v = v === '' ? '' : Number(v);
        out[f.k] = v;
      }
      if (rec) Object.assign(rec, out);
      else state.data[modKey].push(Object.assign({ id: uid() }, out));
      closeSheet(); save(); render(); toast(t('Saved.'));
    });
  }

  function openPicker() {
    const ov = openSheet('<h2>' + T('What do you want to add?') + '</h2><div class="pick">' +
      MODULES.map(m => '<button data-x="' + m.key + '"><span style="font-size:22px">' + m.icon + '</span>' + T(m.title) + '</button>').join('') +
      '</div><div class="footer"><button class="btn" data-x="close">' + T('Close') + '</button></div>', t('Quick add'));
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      closeSheet();
      if (b.dataset.x !== 'close') openForm(b.dataset.x);
    });
  }

  /* ------------------------------------------------------------------ yearly cover review */
  function reviewFindings() {
    const d = state.data, T0 = today(), out = [];
    const sumOf = types => d.insurance.filter(r => types.indexOf(r.type) >= 0).reduce((a, r) => a + (Number(r.sum) || 0), 0);
    const nOf = types => d.insurance.filter(r => types.indexOf(r.type) >= 0).length;
    const health = sumOf(['Health']), life = sumOf(['Term life', 'Life / LIC']);
    out.push(nOf(['Health']) ? { ok: true, text: t('Health cover recorded: {amt} (policies: {n}).', { amt: compact(health), n: nOf(['Health']) }) } : { ok: false, text: t('No health insurance recorded.') });
    out.push(nOf(['Term life', 'Life / LIC']) ? { ok: true, text: t('Life cover recorded: {amt} (policies: {n}).', { amt: compact(life), n: nOf(['Term life', 'Life / LIC']) }) } : { ok: false, text: t('No life or term cover recorded.') });
    const noNom = d.insurance.filter(r => (r.type === 'Term life' || r.type === 'Life / LIC') && !r.nominee).length;
    if (noNom) out.push({ ok: false, text: t('Life policies with no nominee recorded: {n}.', { n: noNom }) });
    const noNomInv = d.investments.filter(r => !r.nominee).length;
    if (noNomInv) out.push({ ok: false, text: t('Investments with no nominee recorded: {n}.', { n: noNomInv }) });
    const noDate = d.insurance.filter(r => r.freq !== 'One-time / no renewal' && !r.due).length;
    if (noDate) out.push({ ok: false, text: t('Policies with no renewal date: {n}.', { n: noDate }) });
    const overdue = allEvents(T0).filter(e => e.mod === 'insurance' && e.days < 0).length;
    if (overdue) out.push({ ok: false, text: t('Overdue premiums: {n}. A lapsed policy may lose cover.', { n: overdue }) });
    const noWhere = d.insurance.filter(r => !r.where).length;
    if (noWhere) out.push({ ok: false, text: t('Policies that do not say where the original is kept: {n}.', { n: noWhere }) });
    return out;
  }
  function openReview() {
    const Q = ['Has your family or income changed since last year (marriage, child, new loan, new home)?',
      'Is your life cover still enough? A common rule of thumb is about 10 to 15 times yearly income. Check with your advisor.',
      'Is your health cover enough for a serious hospital bill in your city? Are your parents covered?',
      'Are nominee names and contact details up to date with each insurer?',
      'Do you know what your policies exclude (waiting periods, sub-limits)?',
      'Does your family know where the policies are? Reprint your emergency sheet.'];
    const ov = openSheet('<h2>🔍 ' + T('Review your insurance cover') + '</h2><p class="muted small" style="margin-top:-6px">' + T('Once a year, check that your cover still fits your life. It takes about 5 minutes.') + '</p>' +
      '<h3 style="margin:12px 0 6px">' + T('What the vault noticed') + '</h3>' +
      reviewFindings().map(f => '<div class="check ' + (f.ok ? 'done' : 'warn') + '"><span class="box">' + (f.ok ? '✓' : '!') + '</span><span class="tx">' + esc(f.text) + '</span></div>').join('') +
      '<h3 style="margin:14px 0 6px">' + T('Ask yourself') + '</h3>' +
      Q.map(q => '<label class="ck" style="padding:6px 0;font-weight:400"><input type="checkbox"> ' + T(q) + '</label>').join('') +
      '<p class="muted small">' + T('This is a prompt for you, not financial advice. Talk to your insurer or advisor before changing any policy.') + '</p>' +
      '<div class="footer"><div class="row"><a class="btn" href="#/m/insurance" data-x="goins">' + T('Open insurance') + '</a><button class="btn" data-x="later">' + T('Remind me in 30 days') + '</button></div><button class="btn primary" data-x="done">' + T('Mark review done') + '</button></div>', t('Review your insurance cover'));
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x, R = state.settings.review;
      if (x === 'goins') { closeSheet(); return; }
      if (x === 'later') { R.snooze = iso(addDays(today(), 30)); closeSheet(); save(); render(); toast(t('We will remind you in 30 days.')); }
      if (x === 'done') { R.last = iso(today()); R.snooze = null; closeSheet(); save(); render(); toast(t('Review saved. Next one on {date}.', { date: fmtDate(addMonths(today(), 12)) })); }
    });
  }

  /* ------------------------------------------------------------------ derived numbers */
  function snapshot() {
    const d = state.data;
    let monthly = 0;
    d.loans.forEach(r => { monthly += Number(r.emi) || 0; });
    d.subscriptions.forEach(r => { const s = FREQ[r.freq]; if (s) monthly += (Number(r.amount) || 0) / s; });
    d.insurance.forEach(r => { const s = FREQ[r.freq]; if (s) monthly += (Number(r.premium) || 0) / s; });
    d.investments.forEach(r => { monthly += Number(r.contrib) || 0; });
    const sumOf = types => d.insurance.filter(r => types.indexOf(r.type) >= 0).reduce((a, r) => a + (Number(r.sum) || 0), 0);
    return {
      monthly,
      loans: d.loans.reduce((a, r) => a + (Number(r.outstanding) || 0), 0),
      invest: d.investments.reduce((a, r) => a + (Number(r.value) || 0), 0),
      life: sumOf(['Term life', 'Life / LIC']),
      health: sumOf(['Health'])
    };
  }
  function readiness() {
    const d = state.data;
    return [
      { ok: d.insurance.some(r => r.type === 'Health'), text: 'Add your health insurance', mod: 'insurance' },
      { ok: d.insurance.some(r => r.type === 'Term life' || r.type === 'Life / LIC'), text: 'Add life / term cover', mod: 'insurance' },
      { ok: d.accounts.length > 0, text: 'List your bank accounts (last 4 digits only)', mod: 'accounts' },
      { ok: d.contacts.length >= 2, text: 'Add 2 key contacts (family, CA, agent)', mod: 'contacts' },
      { ok: d.documents.length > 0, text: 'Record where your important papers are', mod: 'documents' },
      { ok: (state.settings.note || '').trim().length > 10, text: 'Write a short note to your family', href: '#/emergency' },
      { ok: !!state.meta.lastBackup, text: 'Take your first backup', act: 'export' }
    ];
  }
  function recordCount() { return MODULES.reduce((a, m) => a + state.data[m.key].length, 0); }
  function evTitle(e) { return MOD[e.mod].head(e.rec); }
  function summaryText(days) {
    const T0 = today();
    const evs = allEvents(T0).filter(e => e.days <= days);
    const name = state.settings.household || t('Our family');
    const lines = ['*' + t('{name}: dues in the next {n} days', { name, n: days }) + '* (' + fmtDate(T0) + ')', ''];
    if (!evs.length) lines.push(t('Nothing due. All clear.'));
    let total = 0;
    evs.forEach(e => {
      total += e.amt;
      lines.push('• ' + (e.days < 0 ? t('OVERDUE') + ' ' : '') + fmtShort(e.date) + ': ' + evTitle(e) + ' (' + t(e.label) + ')' + (e.amt ? ' ' + money(e.amt) : ''));
    });
    if (total) lines.push('', t('Total: {amt}', { amt: money(total) }));
    lines.push('', '_Ghar ka Vault_');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ views */
  function evRow(e) {
    const st = statusOf(e.days), mod = MOD[e.mod];
    const d = 'data-mod="' + e.mod + '" data-id="' + e.id + '" data-field="' + e.field + '"';
    let action = '', edit = '<button class="btn sm ghost" data-act="edit" data-mod="' + e.mod + '" data-id="' + e.id + '">' + T('Edit') + '</button>';
    if (e.mod === 'review') { action = '<button class="btn sm" data-act="review">' + T('Start review') + '</button>'; edit = ''; }
    else if (e.step && !e.auto) action = '<button class="btn sm" data-act="paid" ' + d + '>' + T('Paid') + ' ✓</button>';
    else if (!e.step) action = '<button class="btn sm" data-act="renew" ' + d + '>' + T('Renewed') + ' ✎</button>';
    return '<div class="ev ' + st + '"><div class="bar"></div><div><div class="ttl">' + esc(evTitle(e)) + '</div><div class="meta">' + esc(t(mod.title) + ' · ' + t(e.label) + (e.amt ? ' · ' + money(e.amt) : '') + (e.auto ? ' · ' + t('auto') : '')) + '</div></div>' +
      '<div class="when"><div class="d">' + fmtDate(e.date) + '</div><span class="chip ' + st + '">' + esc(rel(e.days)) + '</span><div class="actions">' + action + edit + '</div></div></div>';
  }

  function viewHome() {
    const T0 = today(), win = state.settings.window || 60;
    const evs = allEvents(T0);
    const over = evs.filter(e => e.days < 0);
    const up = evs.filter(e => e.days >= 0 && e.days <= win);
    const in15 = evs.filter(e => e.days >= 0 && e.days <= 15).length;
    const totalDue = over.concat(up).reduce((a, e) => a + e.amt, 0);
    const snap = snapshot(), ready = readiness();
    const done = ready.filter(r => r.ok).length, pct = Math.round(done / ready.length * 100);
    const name = state.settings.household;
    const groups = [['This week', up.filter(e => e.days <= 7)], ['This month', up.filter(e => e.days > 7 && e.days <= 30)], ['Later', up.filter(e => e.days > 30)]];
    const rb = reviewBase();

    let h = '<section class="hero"><h1>' + T('Namaste') + (name ? ', ' + esc(name) : '') + ' 👋</h1><div class="sub">' + esc(fmtDate(T0)) + ' · ' + T('here is what needs you') + '</div>' +
      '<div class="stats"><div class="stat ' + (over.length ? 'alert' : '') + '"><div class="n">' + over.length + '</div><div class="l">' + T('Overdue') + '</div></div>' +
      '<div class="stat"><div class="n">' + in15 + '</div><div class="l">' + T('Due in 15 days') + '</div></div>' +
      '<div class="stat"><div class="n">' + esc(compact(totalDue)) + '</div><div class="l">' + T('To pay (next {n} d)', { n: win }) + '</div></div></div></section>';

    if (DEMO_MODE) h += '<div class="banner info"><div><b>' + T('Demo mode.') + '</b> ' + T('Nothing you enter here is saved.') + '</div>' + (LIC.buyUrl ? '<a class="btn sm primary" href="' + esc(LIC.buyUrl) + '" target="_blank" rel="noopener">' + T('Get my key') + '</a>' : '') + '</div>';
    else if (hasDemo()) h += '<div class="banner info"><div><b>' + T('You are looking at demo data.') + '</b> ' + T('Clear it when you are ready to add your own.') + '</div><button class="btn sm" data-act="demo-off">' + T('Clear demo data') + '</button></div>';
    if (backupDue()) h += '<div class="banner warn"><div><b>' + T('Back up your vault.') + '</b> ' + T('Your data lives only on this device. A backup takes 5 seconds.') + '</div><button class="btn sm primary" data-act="export">' + T('Back up now') + '</button></div>';
    if (!storageOk) h += '<div class="banner warn"><div><b>' + T('Saving is blocked in this browser.') + '</b> ' + T('Export a backup to keep your data.') + '</div></div>';
    if (rb && diffDays(rb, T0) <= 30) h += '<div class="banner brand"><div><b>🔍 ' + T('Time for your yearly cover review.') + '</b> ' + T('Check nominees, sums assured and renewal dates. It takes about 5 minutes.') + '</div><div class="row"><button class="btn sm primary" data-act="review">' + T('Start review') + '</button><button class="btn sm" data-act="review-later">' + T('Later') + '</button></div></div>';

    h += '<section class="section"><h2>' + T('Your money at a glance') + '</h2><div class="tiles">' +
      '<div class="tile"><div class="l">' + T('Monthly commitments') + '</div><div class="n">' + esc(compact(snap.monthly)) + '</div><div class="s">' + T('EMIs, bills, premiums, SIPs') + '</div></div>' +
      '<div class="tile"><div class="l">' + T('Loans outstanding') + '</div><div class="n">' + esc(compact(snap.loans)) + '</div><div class="s">' + T('as entered by you') + '</div></div>' +
      '<div class="tile"><div class="l">' + T('Investments & deposits') + '</div><div class="n">' + esc(compact(snap.invest)) + '</div><div class="s">' + T('as entered by you') + '</div></div>' +
      '<div class="tile"><div class="l">' + T('Insurance cover') + '</div><div class="n">' + esc(compact(snap.life + snap.health)) + '</div><div class="s">' + T('Life {a} · Health {b}', { a: compact(snap.life), b: compact(snap.health) }) + '</div></div></div></section>';

    h += '<section class="section"><h2>' + T('Coming up') + ' <span class="row noprint">' + [30, 60, 90].map(n => '<button class="chip ' + (n === win ? 'ok' : '') + '" data-act="win" data-n="' + n + '" style="border:0;cursor:pointer">' + T('{n} days', { n }) + '</button>').join('') + '</span></h2>';
    if (over.length) h += '<div class="evgroup" style="color:var(--danger)">' + T('Overdue ({n})', { n: over.length }) + '</div>' + over.map(evRow).join('');
    groups.forEach(g => { if (g[1].length) h += '<div class="evgroup">' + T(g[0]) + '</div>' + g[1].map(evRow).join(''); });
    if (!over.length && !up.length) {
      h += recordCount() ? '<div class="empty"><div class="big">🎉</div><p>' + T('Nothing due in the next {n} days.', { n: win }) + '</p></div>'
        : '<div class="empty"><div class="big">🗄️</div><p>' + T('Your vault is empty. Add your first policy, EMI or bill, and its due dates will show up here.') + '</p><button class="btn primary" data-act="quickadd">+ ' + T('Add something') + '</button></div>';
    }
    h += '<div class="row" style="margin-top:12px"><button class="btn" data-act="copy-summary">📋 ' + T('Copy summary') + '</button><button class="btn" data-act="wa-summary">💬 ' + T('Share on WhatsApp') + '</button></div></section>';

    h += '<section class="section"><div class="card"><div class="row between" style="align-items:center"><div><h2>' + T('Is your family prepared?') + '</h2><div class="muted small">' + T('{done} of {total} done', { done, total: ready.length }) + '</div></div><div class="ring" style="--p:' + pct + '"><div>' + pct + '%</div></div></div><div style="margin-top:8px">' +
      ready.map(r => '<div class="check ' + (r.ok ? 'done' : '') + '"><span class="box">' + (r.ok ? '✓' : '') + '</span><span class="tx">' + T(r.text) + '</span>' +
        (r.ok ? '' : (r.mod ? '<button class="btn sm" data-act="add" data-mod="' + r.mod + '">' + T('Add') + '</button>' : r.href ? '<a class="btn sm" href="' + r.href + '">' + T('Open') + '</a>' : '<button class="btn sm" data-act="' + r.act + '">' + T('Do it') + '</button>')) + '</div>').join('') + '</div></div></section>';
    return h;
  }

  function viewVault() {
    const T0 = today(), evs = allEvents(T0);
    return '<div class="pagehead"><div class="t"><div class="badge-ico">🗄️</div><div><h1>' + T('Vault') + '</h1><div class="muted small">' + T("Everything about your family's money and papers") + '</div></div></div></div>' +
      '<div class="grid">' + MODULES.map(m => {
        const n = state.data[m.key].length;
        const next = evs.filter(e => e.mod === m.key && e.days >= 0)[0];
        return '<a class="mod" href="#/m/' + m.key + '"><span class="ico">' + m.icon + '</span><span class="n">' + T(m.title) + '</span><span class="c">' + T('{n} saved', { n }) + (next ? ' · ' + T('next {date}', { date: fmtShort(next.date) }) : '') + '</span></a>';
      }).join('') + '</div>';
  }

  function recCard(mod, r, T0) {
    const evs = eventsOf(r, mod, T0);
    const chips = evs.map(e => {
      if (isExpired(e)) return '<span class="chip expired">' + T(e.label) + ' ' + esc(fmtShort(e.date)) + '</span>';
      return '<span class="chip ' + statusOf(e.days) + '">' + T(e.label) + ' ' + esc(fmtShort(e.date)) + ' · ' + esc(rel(e.days)) + '</span>';
    }).join('');
    const amt = mod.amount && r[mod.amount] ? '<div class="amt">' + money(r[mod.amount]) + '</div>' : '';
    const text = (mod.head(r) + ' ' + mod.sub(r) + ' ' + Object.values(r).join(' ')).toLowerCase();
    return '<button class="rec" data-act="edit" data-mod="' + mod.key + '" data-id="' + r.id + '" data-text="' + esc(text) + '"><div class="top"><div><div class="h">' + esc(mod.head(r)) + (r.demo ? '<span class="demo-tag">' + T('demo') + '</span>' : '') + '</div><div class="s">' + esc(mod.sub(r)) + '</div></div>' + amt + '</div>' +
      (chips ? '<div class="chips">' + chips + '</div>' : '') + (r.where && mod.key !== 'documents' ? '<div class="where">📍 ' + esc(r.where) + '</div>' : '') + '</button>';
  }
  function viewModule(key) {
    const mod = MOD[key];
    if (!mod || key === 'review') return viewVault();
    const T0 = today();
    const first = r => { const e = eventsOf(r, mod, T0); return e.length ? Math.min.apply(null, e.map(x => x.date)) : null; };
    const recs = state.data[key].slice().sort((a, b) => {
      const fa = first(a), fb = first(b);
      if (fa !== null && fb !== null) return fa - fb;
      if (fa !== null) return -1;
      if (fb !== null) return 1;
      return mod.head(a).localeCompare(mod.head(b));
    });
    const one = t(mod.one);
    let h = '<div class="pagehead"><div class="t"><div class="badge-ico">' + mod.icon + '</div><div><h1>' + T(mod.title) + '</h1><div class="muted small">' + T('{n} saved', { n: recs.length }) + '</div></div></div><button class="btn primary" data-act="add" data-mod="' + key + '">+ ' + T('Add {one}', { one }) + '</button></div>';
    h += '<div class="banner brand" style="margin-bottom:12px"><div>' + T(mod.tip) + '</div></div>';
    if (recs.length > 5) h += '<div class="search" style="max-width:none;margin-bottom:12px"><input type="text" id="modq" placeholder="' + T('Filter') + '" aria-label="' + T('Filter') + '"></div>';
    if (!recs.length) h += '<div class="empty"><div class="big">' + mod.icon + '</div><p>' + T('Nothing here yet.') + ' ' + T(mod.eg) + '</p><button class="btn primary" data-act="add" data-mod="' + key + '">+ ' + T('Add {one}', { one }) + '</button></div>';
    else h += '<div id="reclist">' + recs.map(r => recCard(mod, r, T0)).join('') + '</div>';
    return h;
  }

  function viewSearch(q) {
    const needle = q.toLowerCase().trim(), T0 = today();
    let found = 0, h = '<div class="pagehead"><div class="t"><div class="badge-ico">🔍</div><div><h1>' + T('Search') + '</h1><div class="muted small">“' + esc(q) + '”</div></div></div></div>';
    MODULES.forEach(m => {
      const hits = state.data[m.key].filter(r => (m.head(r) + ' ' + Object.values(r).join(' ')).toLowerCase().includes(needle));
      if (!hits.length) return;
      found += hits.length;
      h += '<section class="section"><h2>' + m.icon + ' ' + T(m.title) + '</h2>' + hits.map(r => recCard(m, r, T0)).join('') + '</section>';
    });
    if (!found) h += '<div class="empty"><div class="big">🤷</div><p>' + T('Nothing matched. Try a name, insurer, bank or place.') + '</p></div>';
    return h;
  }

  function viewCalendar() {
    const T0 = today(), year = ui.calYear;
    const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
    const evs = allEvents(T0, true);
    const months = Array.from({ length: 12 }, () => []);
    evs.forEach(e => occurrences(e, start, end).forEach(d => months[d.getMonth()].push({ d, e })));
    const totals = months.map(list => list.reduce((a, x) => a + x.e.amt, 0));
    const max = Math.max.apply(null, totals), mi = max > 0 ? totals.indexOf(max) : -1;
    let h = '<div class="pagehead"><div class="t"><div class="badge-ico">📅</div><div><h1>' + T('Calendar {year}', { year }) + '</h1><div class="muted small">' + T('Every renewal, EMI and expiry in one year') + '</div></div></div>' +
      '<div class="row"><button class="btn sm" data-act="calprev" aria-label="' + T('Previous year') + '">◀</button><button class="btn sm" data-act="calnext" aria-label="' + T('Next year') + '">▶</button><button class="btn sm primary" data-act="export-ics">' + T('Add to my calendar') + '</button></div></div>';
    h += '<div class="card"><div class="bars">' + totals.map((tt, i) => '<div class="b ' + (i === mi ? 'max' : '') + '"><span>' + (tt ? esc(compact(tt).replace('₹', '')) : '') + '</span><i style="height:' + (max ? Math.max(3, tt / max * 78) : 3) + 'px"></i><span>' + esc(monthName(year, i)) + '</span></div>').join('') + '</div>' +
      (mi >= 0 ? '<p class="muted small" style="margin:10px 0 0">' + T('Heaviest month: {month} with {amt} going out. Plan for it.', { month: monthName(year, mi), amt: money(max) }) + '</p>' : '<p class="muted small" style="margin:10px 0 0">' + T('Add dates and amounts to see your heavy months.') + '</p>') + '</div>';
    months.forEach((list, i) => {
      if (!list.length) return;
      list.sort((a, b) => a.d - b.d);
      h += '<div class="month"><h3><span>' + esc(monthName(year, i)) + ' ' + year + '</span><span class="muted">' + (totals[i] ? money(totals[i]) : '') + '</span></h3>' +
        list.map(x => '<div class="occ"><span class="dt">' + x.d.getDate() + ' ' + esc(monthName(year, i)) + '</span><span>' + esc(evTitle(x.e)) + ' <span class="muted small">· ' + T(x.e.label) + '</span></span><span>' + (x.e.amt ? money(x.e.amt) : '') + '</span></div>').join('') + '</div>';
    });
    if (!months.some(l => l.length)) h += '<div class="empty"><div class="big">📅</div><p>' + T('No dates in {year} yet.', { year }) + '</p></div>';
    return h;
  }

  function tbl(modKey, cols) {
    const rows = state.data[modKey];
    if (!rows.length) return '<div class="none">' + T('Nothing recorded.') + '</div>';
    return '<div class="tablewrap"><table><thead><tr>' + cols.map(c => '<th>' + T(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + cols.map(c => '<td>' + esc(c[1](r) || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function viewEmergency() {
    const S = state.settings;
    const snap = snapshot();
    const tr = v => (v ? t(v) : '');
    let h = '<div class="pagehead noprint"><div class="t"><div class="badge-ico">🚨</div><div><h1>' + T('Emergency sheet') + '</h1><div class="muted small">' + T('One page your family can use if you are unavailable') + '</div></div></div><button class="btn primary" data-act="print">🖨️ ' + T('Print / Save as PDF') + '</button></div>';
    h += '<div class="card noprint" style="margin-bottom:14px"><label class="f">' + T('My note to my family') + '<textarea id="note" placeholder="' + T('Where to look first, who to call, anything they should know. Plain and simple.') + '">' + esc(S.note) + '</textarea></label><div class="muted small" style="margin-top:6px">' + T('Saved automatically on this device.') + '</div></div>';
    h += '<div class="sheet-doc"><h1>' + T('If something happens to me, open this first') + '</h1><div style="color:#555;font-size:.9rem">' + esc(S.household || t('Our family')) + ' · ' + T('prepared on {date}', { date: fmtDate(today()) }) + '</div>';
    h += '<h2>' + T('Note from me') + '</h2>' + ((S.note || '').trim() ? '<div class="note">' + esc(S.note) + '</div>' : '<div class="none">' + T('No note written yet.') + '</div>');
    h += '<h2>' + T('Call these people first') + '</h2>' + tbl('contacts', [['Name', r => r.name], ['Who', r => tr(r.role)], ['Phone', r => r.phone], ['Email', r => r.email]]);
    h += '<h2>' + T('Bank accounts') + '</h2>' + tbl('accounts', [['Bank', r => r.bank], ['Type', r => tr(r.kind)], ['Holder', r => r.holder], ['Last 4', r => r.last4], ['Nominee', r => r.nominee], ['Branch', r => r.branch]]);
    h += '<h2>' + T('Insurance') + '</h2>' + tbl('insurance', [['Type', r => tr(r.type)], ['Insurer', r => r.insurer], ['Covered', r => r.holder], ['Last 4', r => r.last4], ['Sum assured', r => r.sum ? money(r.sum) : ''], ['Nominee', r => r.nominee], ['Agent / helpline', r => r.agent], ['Original at', r => r.where]]);
    h += '<h2>' + T('Investments & deposits') + '</h2>' + tbl('investments', [['Type', r => tr(r.kind)], ['Where', r => r.inst], ['Holder', r => r.holder], ['Last 4', r => r.last4], ['Value', r => r.value ? money(r.value) : ''], ['Nominee', r => r.nominee], ['Papers / login', r => r.where]]);
    h += '<h2>' + T('Loans') + '</h2>' + tbl('loans', [['Type', r => tr(r.type)], ['Lender', r => r.lender], ['Borrower', r => r.who], ['EMI', r => r.emi ? money(r.emi) : ''], ['Outstanding', r => r.outstanding ? money(r.outstanding) : '']]);
    h += '<h2>' + T('Vehicles') + '</h2>' + tbl('vehicles', [['Vehicle', r => r.name], ['Reg. no.', r => r.reg], ['Owner', r => r.owner], ['Insurer', r => r.insurer], ['Papers at', r => r.where]]);
    h += '<h2>' + T('Where my important papers are') + '</h2>' + tbl('documents', [['Document', r => (r.doc === 'Other' && r.name) ? r.name : tr(r.doc)], ['For', r => r.who], ['Original at', r => r.where], ['Digital copy', r => r.digital]]);
    h += '<h2>' + T('Monthly money going out') + '</h2><p style="margin:4px 0;font-size:.92rem">' + T('About {amt} a month (EMIs, bills, premiums, SIPs).', { amt: money(snap.monthly) }) + '</p>';
    h += '<p style="color:#777;font-size:.78rem;margin-top:20px">' + T('Generated from Ghar ka Vault. Contains personal information, so keep the printout somewhere safe. Passwords and full account numbers are deliberately not stored.') + '</p></div>';
    return h;
  }

  function viewSettings() {
    const prefs = getPrefs(), S = state.settings, R = S.review;
    const encOn = !!cryptoKey;
    const lastB = state.meta.lastBackup ? fmtDate(new Date(state.meta.lastBackup)) : t('never');
    const lastR = R.last ? fmtDate(parse(R.last)) : t('never');
    let h = '<div class="pagehead"><div class="t"><div class="badge-ico">⚙️</div><div><h1>' + T('Settings & backup') + '</h1><div class="muted small">' + T('Version {v}', { v: VERSION }) + '</div></div></div></div>';
    h += '<div class="card"><h2>' + T('Household') + '</h2><label class="f" style="margin-top:8px">' + T('Family / household name') + '<input type="text" id="hh" value="' + esc(S.household) + '" placeholder="' + T('e.g. Patel family') + '"></label>' +
      '<div class="row" style="margin-top:12px"><label class="f" style="flex:1;min-width:150px">' + T('Language') + langSelect() + '</label>' +
      '<label class="f" style="flex:1;min-width:150px">' + T('Theme') + '<select id="theme"><option value="auto" ' + (!prefs.theme || prefs.theme === 'auto' ? 'selected' : '') + '>' + T('Match my device') + '</option><option value="light" ' + (prefs.theme === 'light' ? 'selected' : '') + '>' + T('Light') + '</option><option value="dark" ' + (prefs.theme === 'dark' ? 'selected' : '') + '>' + T('Dark') + '</option></select></label>' +
      '<label class="f" style="flex:1;min-width:150px">' + T('Show dues for the next') + '<select id="win"><option value="30" ' + (S.window === 30 ? 'selected' : '') + '>' + T('{n} days', { n: 30 }) + '</option><option value="60" ' + (S.window === 60 ? 'selected' : '') + '>' + T('{n} days', { n: 60 }) + '</option><option value="90" ' + (S.window === 90 ? 'selected' : '') + '>' + T('{n} days', { n: 90 }) + '</option></select></label></div></div>';

    h += '<div class="card"><h2>' + T('Yearly cover review') + '</h2><p class="muted small">' + TH('Once a year the vault reminds you to check nominees, sums assured and renewal dates. Last review: {date}.', { date: '<b>' + esc(lastR) + '</b>' }) + '</p>' +
      '<label class="ck" style="padding-top:0"><input type="checkbox" id="revon" ' + (R.on !== false ? 'checked' : '') + '> ' + T('Remind me every year') + '</label>' +
      '<div class="row" style="margin-top:10px"><button class="btn" data-act="review">' + T('Start review now') + '</button></div></div>';

    if (DEMO_MODE) {
      h += '<div class="card"><h2>' + T('Demo mode') + '</h2><p class="muted small" style="margin:0">' + T('Backup, passcode and erase are turned off in the demo. Nothing you enter is saved.') + '</p></div>';
      return h;
    }
    if (licence) h += '<div class="card"><h2>' + T('Licence') + '</h2><p class="muted small">' + TH('Licensed to {name} · key {id}', { name: esc(licence.n || ''), id: esc(licence.id || '') }) + '</p><button class="btn" data-act="copy-key">🔑 ' + T('Copy my licence key') + '</button><p class="muted small" style="margin-bottom:0">' + T('You will need the key if you install on another device or on an iPhone home screen.') + '</p></div>';

    h += '<div class="card"><h2>' + T('Backup & restore') + '</h2><p class="muted small">' + TH('Your data is stored only on this device and browser. If you clear browser data or change phones, it is gone, so back up regularly. Last backup: {date}.', { date: '<b>' + esc(lastB) + '</b>' }) + '</p>' +
      '<div class="row"><button class="btn primary" data-act="export">⬇️ ' + T('Download backup') + '</button><button class="btn" data-act="import">⬆️ ' + T('Restore from backup') + '</button><input type="file" id="impf" accept=".json,application/json" class="hidden"></div>' +
      '<p class="muted small" style="margin-bottom:0">' + (encOn ? T('Your backup file is encrypted with your passcode.') : T('The backup file is not encrypted. Keep it somewhere private, or set a passcode below first.')) + '</p></div>';

    h += '<div class="card"><h2>' + T('Calendar reminders') + '</h2><p class="muted small">' + T('Download all dates for the next 12 months as a calendar file. Open it on your phone or in Google Calendar and you will get reminders 7 days and 1 day before each due date, even when this app is closed. The file lists titles and amounts, so share it carefully.') + '</p><button class="btn" data-act="export-ics">📅 ' + T('Download calendar file (.ics)') + '</button></div>';

    h += '<div class="card"><h2>' + T('Passcode lock') + '</h2>' + (!HAS_CRYPTO ? '<p class="muted small">' + T('Encryption is not available in this browser. Open the app from a secure (https) address to use it.') + '</p>' :
      '<p class="muted small">' + (encOn ? '🔒 ' + T('Your vault is encrypted on this device and locks after 5 minutes of inactivity.') : T('Encrypt your data with a passcode so nobody who picks up your phone can read it.')) + ' <b>' + T('If you forget the passcode, the data cannot be recovered') + '</b>, ' + T('so keep a backup.') + '</p>' +
      '<div class="row">' + (encOn ? '<button class="btn" data-act="lock">' + T('Lock now') + '</button><button class="btn" data-act="pass-change">' + T('Change passcode') + '</button><button class="btn danger" data-act="pass-remove">' + T('Remove passcode') + '</button>' : '<button class="btn primary" data-act="pass-set">' + T('Set a passcode') + '</button>') + '</div>') + '</div>';

    h += '<div class="card"><h2>' + T('Install on your phone') + '</h2>' + (installEvt ? '<button class="btn primary" data-act="install">' + T('Install app') + '</button>' : '<p class="muted small" style="margin:0">' + T('Open this page in Chrome (Android) and choose Add to Home screen, or in Safari (iPhone) tap Share, then Add to Home Screen. It then opens like a normal app, even offline.') + '</p>') + '</div>';

    h += '<div class="card"><h2>' + T('Demo data') + '</h2><p class="muted small">' + T('Fill the vault with sample records to see how it works. Demo records are tagged and can be cleared in one tap.') + '</p><div class="row"><button class="btn" data-act="demo-on">' + T('Load demo data') + '</button>' + (hasDemo() ? '<button class="btn" data-act="demo-off">' + T('Clear demo data') + '</button>' : '') + '</div></div>';

    h += '<div class="card"><h2>' + T('Privacy') + '</h2><ul class="muted small" style="margin:0;padding-left:18px"><li>' + T('No account, no server, no tracking. Your records never leave this device unless you export them.') + '</li><li>' + T('Do not store passwords, PINs, CVV or full account or policy numbers. The app asks for last 4 digits only.') + '</li><li>' + T('This is a record-keeping tool, not financial, tax or legal advice. Check figures with your advisor.') + '</li></ul></div>';

    h += '<div class="card"><h2>' + T('Danger zone') + '</h2><p class="muted small">' + T('Delete everything stored by this app on this device.') + '</p><button class="btn danger" data-act="erase">' + T('Erase all my data') + '</button></div>';
    return h;
  }

  function hasDemo() { return MODULES.some(m => state.data[m.key].some(r => r.demo)); }
  function backupDue() {
    if (DEMO_MODE || recordCount() < 3 || hasDemo()) return false;
    const lb = state.meta.lastBackup;
    return !lb || (Date.now() - new Date(lb).getTime()) > 30 * 86400000;
  }

  /* ------------------------------------------------------------------ router / shell */
  function shell() {
    screenFn = () => { shell(); render(); };
    $('#root').innerHTML =
      '<div class="app"><aside class="sidebar" aria-label="' + T('Main navigation') + '"><a class="brand" href="#/home"><span class="logo">🏠</span><span class="name">Ghar ka Vault</span></a>' +
      '<a href="#/home" data-nav="home">🏠 ' + T('Home') + '</a><a href="#/vault" data-nav="vault">🗄️ ' + T('Vault') + '</a><a href="#/calendar" data-nav="calendar">📅 ' + T('Calendar') + '</a><a href="#/emergency" data-nav="emergency">🚨 ' + T('Emergency sheet') + '</a>' +
      '<div class="group">' + T('Sections') + '</div>' + MODULES.map(m => '<a href="#/m/' + m.key + '" data-nav="m/' + m.key + '">' + m.icon + ' ' + T(m.title) + '</a>').join('') +
      '<div class="group">' + T('App') + '</div><a href="#/settings" data-nav="settings">⚙️ ' + T('Settings & backup') + '</a></aside>' +
      '<main class="main"><header class="topbar"><a class="brand" href="#/home" aria-label="' + T('Home') + '"><span class="logo">🏠</span></a>' +
      '<form class="search" id="searchForm" role="search"><input type="text" id="q" enterkeyhint="search" placeholder="' + T('Search your vault') + '" aria-label="' + T('Search your vault') + '"></form>' + langSelect() +
      '<button class="btn primary desk" data-act="quickadd">+ ' + T('Add') + '</button><a class="iconbtn" href="#/settings" aria-label="' + T('Settings') + '">⚙️</a></header><div id="view"></div></main></div>' +
      '<nav class="bottomnav" aria-label="' + T('Main navigation') + '"><a href="#/home" data-nav="home"><span class="ico">🏠</span>' + T('Home') + '</a><a href="#/vault" data-nav="vault"><span class="ico">🗄️</span>' + T('Vault') + '</a>' +
      '<button class="fab" data-act="quickadd" aria-label="' + T('Add') + '"><span class="ico">+</span>' + T('Add') + '</button><a href="#/calendar" data-nav="calendar"><span class="ico">📅</span>' + T('Calendar') + '</a><a href="#/emergency" data-nav="emergency"><span class="ico">🚨</span>' + T('Emergency') + '</a></nav>';
    $('#searchForm').addEventListener('submit', e => {
      e.preventDefault();
      const q = $('#q').value.trim();
      if (q) location.hash = '#/search/' + encodeURIComponent(q);
    });
  }

  function render() {
    if (!state || !$('#view')) return;
    const route = (location.hash || '#/home').slice(2).split('/');
    const r0 = route[0] || 'home';
    let html, nav = r0;
    switch (r0) {
      case 'vault': html = viewVault(); break;
      case 'm': html = viewModule(route[1]); nav = 'm/' + route[1]; break;
      case 'calendar': html = viewCalendar(); break;
      case 'emergency': html = viewEmergency(); break;
      case 'settings': html = viewSettings(); break;
      case 'search': html = viewSearch(decodeURIComponent(route.slice(1).join('/'))); nav = 'vault'; break;
      default: html = viewHome(); nav = 'home';
    }
    $('#view').innerHTML = html;
    $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    const key = location.hash;
    if (key !== ui.lastRoute) { window.scrollTo(0, 0); ui.lastRoute = key; }
    document.title = 'Ghar ka Vault';
  }

  /* ------------------------------------------------------------------ actions */
  async function exportBackup() {
    let payload;
    if (cryptoKey) payload = { fvBackup: 1, encrypted: true, blob: await encryptText(JSON.stringify(state), cryptoKey, cryptoSalt) };
    else payload = { fvBackup: 1, encrypted: false, state };
    download('GharKaVault-backup-' + iso(today()) + '.json', JSON.stringify(payload), 'application/json');
    state.meta.lastBackup = new Date().toISOString();
    save(); render();
    toast(t('Backup downloaded. Keep the file somewhere safe.'));
  }
  async function importBackup(file) {
    let obj;
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || !payload.fvBackup) throw new Error('not a backup');
      if (payload.encrypted) {
        const pass = await askText(t('Backup is encrypted'), t('Enter the passcode that was set when this backup was made.'), { ok: t('Decrypt') });
        if (pass == null) return;
        const key = await deriveKey(pass, fromB64(payload.blob.s));
        obj = JSON.parse(await decryptBlob(payload.blob, key));
      } else obj = payload.state;
      if (!obj || typeof obj.data !== 'object') throw new Error('bad data');
    } catch (e) {
      toast(t('That file could not be read. Wrong file or wrong passcode.'));
      return;
    }
    const n = MODULES.reduce((a, m) => a + (Array.isArray(obj.data[m.key]) ? obj.data[m.key].length : 0), 0);
    if (!(await confirmBox(t('Replace everything in this vault with the backup ({n} records)? Your current data will be overwritten.', { n }), t('Replace'), true))) return;
    state = normalize(obj);
    state.meta.onboarded = true;
    await save(); render(); toast(t('Backup restored.'));
  }
  function buildICS() {
    const T0 = today(), end = addMonths(T0, 12), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const esc2 = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const fold = line => { const out = []; while (line.length > 70) { out.push(line.slice(0, 70)); line = ' ' + line.slice(70); } out.push(line); return out.join('\r\n'); };
    const ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ghar ka Vault//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Ghar ka Vault'];
    allEvents(T0, true).forEach(e => occurrences(e, T0, end).forEach(d => {
      const title = e.mod === 'review' ? evTitle(e) : evTitle(e) + ': ' + t(e.label) + (e.amt ? ' (' + money(e.amt) + ')' : '');
      lines.push('BEGIN:VEVENT', 'UID:fv-' + e.id + '-' + e.field + '-' + ymd(d) + '@gharkavault', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(d), 'DTEND;VALUE=DATE:' + ymd(addDays(d, 1)), fold('SUMMARY:' + esc2(title)),
        fold('DESCRIPTION:' + esc2('Ghar ka Vault · ' + t(MOD[e.mod].title))),
        'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', 'DESCRIPTION:7 days', 'END:VALARM',
        'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:1 day', 'END:VALARM', 'END:VEVENT');
    }));
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function demoRecords() {
    const T0 = today(), D = n => iso(addDays(T0, n));
    return {
      insurance: [
        { type: 'Health', insurer: 'HDFC Ergo', holder: 'Family floater', last4: '4821', sum: 1000000, premium: 24500, freq: 'Yearly', due: D(9), nominee: 'Spouse', agent: 'Rakesh Mehta 98250 00000', where: 'Blue file, almirah shelf 2' },
        { type: 'Term life', insurer: 'HDFC Life', holder: 'Self', last4: '3307', sum: 20000000, premium: 18200, freq: 'Yearly', due: D(120), nominee: 'Spouse', where: 'Bank locker' },
        { type: 'Motor', insurer: 'ICICI Lombard', holder: 'Honda City', last4: '7710', premium: 9800, freq: 'Yearly', due: D(26), where: 'Glove box + email' },
        { type: 'Life / LIC', insurer: 'LIC', holder: 'Papa', last4: '1159', sum: 500000, premium: 12000, freq: 'Yearly', due: D(-5), nominee: 'Mummy', where: 'Almirah, red folder' }
      ],
      loans: [
        { type: 'Home loan', lender: 'SBI', who: 'Self + Spouse', last4: '9012', emi: 38400, next: D(4), end: D(5400), outstanding: 3100000, rate: 8.5, auto: true },
        { type: 'Car loan', lender: 'HDFC Bank', who: 'Self', last4: '2288', emi: 14200, next: D(12), end: D(700), outstanding: 480000, rate: 9.2, auto: true }
      ],
      investments: [
        { kind: 'Fixed deposit', inst: 'SBI', holder: 'Self', last4: '6620', value: 500000, maturity: D(34), nominee: 'Spouse', where: 'Receipt in locker' },
        { kind: 'PPF', inst: 'Post office', holder: 'Spouse', last4: '5544', value: 780000, nominee: 'Self', where: 'Passbook in almirah' },
        { kind: 'Mutual fund / SIP', inst: 'HDFC AMC', holder: 'Self', last4: '7781', value: 410000, contrib: 10000, contribDate: D(3), nominee: 'Spouse', where: 'Login: spouse knows' }
      ],
      subscriptions: [
        { name: 'Netflix', cat: 'OTT / entertainment', amount: 649, freq: 'Monthly', next: D(6), via: 'Credit card', auto: true },
        { name: 'JioFiber broadband', cat: 'Internet / mobile', amount: 1179, freq: 'Monthly', next: D(14), via: 'UPI AutoPay', auto: true },
        { name: 'Society maintenance', cat: 'Society / rent', amount: 7500, freq: 'Quarterly', next: D(17), via: 'Net banking', auto: false },
        { name: 'School fees', cat: 'School / education', amount: 18500, freq: 'Quarterly', next: D(40), via: 'Net banking', auto: false },
        { name: 'Amazon Prime', cat: 'OTT / entertainment', amount: 1499, freq: 'Yearly', next: D(200), via: 'Credit card', auto: true }
      ],
      vehicles: [
        { name: 'Honda City', reg: 'GJ01AB1234', owner: 'Self', insurer: 'ICICI Lombard', insExp: D(26), puc: D(11), service: D(60), where: 'RC in glove box; scan in DigiLocker' },
        { name: 'Activa', reg: 'GJ01CD5678', owner: 'Spouse', insurer: 'New India', insExp: D(150), puc: D(95), service: D(30), where: 'RC in almirah' }
      ],
      warranties: [
        { item: 'Samsung fridge', brand: '253L double door', bought: D(-400), price: 28990, end: D(330), service: '1800 40 7267864', bill: 'Email folder "Bills"' },
        { item: 'LG washing machine', brand: 'Front load 7kg', bought: D(-700), price: 34500, end: D(20), service: '1800 315 9999', bill: 'Drawer, kitchen' },
        { item: 'Voltas AC', brand: '1.5 ton split', bought: D(-300), price: 38000, end: D(75), bill: 'Email folder "Bills"' }
      ],
      accounts: [
        { bank: 'SBI', kind: 'Savings', holder: 'Self', last4: '2201', branch: 'Satellite, Ahmedabad', nominee: 'Spouse' },
        { bank: 'HDFC Bank', kind: 'Salary', holder: 'Self', last4: '5532', branch: 'SG Highway', nominee: 'Spouse' },
        { bank: 'SBI', kind: 'Locker', holder: 'Self + Spouse', last4: '0012', branch: 'Satellite, Ahmedabad', renew: D(150) }
      ],
      documents: [
        { doc: 'Property papers', who: 'Family', where: 'SBI locker no. 12', digital: 'Drive > Family > Property' },
        { doc: 'Will', who: 'Self', where: 'With lawyer, Mr. Shah', digital: 'Copy in locker' },
        { doc: 'Passport', who: 'Papa', where: 'Almirah, top drawer', expiry: D(300) },
        { doc: 'Aadhaar', who: 'Self', ref: '4410', where: 'Almirah, documents folder', digital: 'DigiLocker' },
        { doc: 'Driving licence', who: 'Self', ref: '8821', where: 'Wallet; scan in DigiLocker', expiry: D(500) }
      ],
      contacts: [
        { name: 'Anjali (spouse)', role: 'Family', phone: '98250 11111' },
        { name: 'CA Rohan Desai', role: 'CA / accountant', phone: '98790 22222' },
        { name: 'Rakesh Mehta', role: 'Insurance agent', phone: '98250 00000' },
        { name: 'Dr. Patel', role: 'Doctor', phone: '079 4000 0000' }
      ]
    };
  }
  function loadDemo() {
    const rows = demoRecords();
    MODULES.forEach(m => rows[m.key].forEach(r => state.data[m.key].push(Object.assign({ id: uid(), demo: true }, r))));
    if (!(state.settings.note || '').trim()) {
      state.settings.note = 'Sab zaruri papers almirah ke neeche wale khane aur SBI locker mein hain.\nPehle Anjali aur CA Rohan ko call karna. Insurance ke liye Rakesh bhai ko.\nKoi jaldi nahi, sab kuch is sheet mein likha hai.';
      state.settings.demoNote = true;
    }
    state.meta.onboarded = true;
  }
  function clearDemo() {
    MODULES.forEach(m => { state.data[m.key] = state.data[m.key].filter(r => !r.demo); });
    if (state.settings.demoNote) { state.settings.note = ''; delete state.settings.demoNote; }
  }

  const BLOCKED_IN_DEMO = ['erase', 'pass-set', 'pass-change', 'pass-remove', 'import', 'demo-on', 'demo-off', 'lock'];
  const handlers = {
    quickadd: () => openPicker(),
    add: tg => openForm(tg.dataset.mod),
    edit: tg => openForm(tg.dataset.mod, tg.dataset.id),
    renew: tg => openForm(tg.dataset.mod, tg.dataset.id, tg.dataset.field),
    paid: tg => {
      const mod = MOD[tg.dataset.mod], rec = state.data[mod.key].find(r => r.id === tg.dataset.id);
      if (!rec) return;
      const spec = mod.dates.find(d => d.f === tg.dataset.field);
      const step = spec.step || FREQ[rec[spec.freq]];
      const before = rec[spec.f], next = addMonths(parse(before), step);
      rec[spec.f] = iso(next);
      save(); render();
      toast(t('Marked paid. Next: {date}.', { date: fmtDate(next) }), () => { rec[spec.f] = before; save(); render(); });
    },
    review: () => openReview(),
    'review-later': () => { state.settings.review.snooze = iso(addDays(today(), 30)); save(); render(); toast(t('We will remind you in 30 days.')); },
    win: tg => { state.settings.window = +tg.dataset.n; save(); render(); },
    'copy-summary': async () => toast((await copyText(summaryText(state.settings.window || 60))) ? t('Summary copied. Paste it in WhatsApp.') : t('Could not copy.')),
    'wa-summary': () => window.open('https://wa.me/?text=' + encodeURIComponent(summaryText(state.settings.window || 60)), '_blank', 'noopener'),
    'copy-key': async () => toast((await copyText(lsGet(KEYS.lic) || '')) ? t('Licence key copied.') : t('Could not copy.')),
    calprev: () => { ui.calYear--; render(); },
    calnext: () => { ui.calYear++; render(); },
    export: () => exportBackup(),
    import: () => $('#impf') && $('#impf').click(),
    'export-ics': () => { download('GharKaVault-reminders.ics', buildICS(), 'text/calendar'); toast(t('Calendar file downloaded. Open it to add the reminders.')); },
    print: () => window.print(),
    'demo-on': async () => {
      if (recordCount() && !(await confirmBox(t('Add sample records to your vault? You can clear them any time.'), t('Add samples')))) return;
      loadDemo(); await save(); render(); toast(t('Demo data added.'));
    },
    'demo-off': async () => { clearDemo(); await save(); render(); toast(t('Demo data cleared.')); },
    lock: () => lock(),
    'pass-set': async () => {
      const p = await askText(t('Set a passcode'), t('At least 6 characters. If you forget it, your data cannot be recovered.'), { confirm: true, min: 6, ok: t('Encrypt') });
      if (p == null) return;
      cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
      cryptoKey = await deriveKey(p, cryptoSalt);
      await save(); lsDel(KEYS.plain); bumpIdle(); render(); toast(t('Passcode set. Your vault is now encrypted.'));
    },
    'pass-change': async () => {
      const p = await askText(t('New passcode'), t('At least 6 characters.'), { confirm: true, min: 6, ok: t('Change') });
      if (p == null) return;
      cryptoSalt = crypto.getRandomValues(new Uint8Array(16));
      cryptoKey = await deriveKey(p, cryptoSalt);
      await save(); render(); toast(t('Passcode changed.'));
    },
    'pass-remove': async () => {
      if (!(await confirmBox(t('Remove the passcode? Your data will be stored on this device without encryption.'), t('Remove'), true))) return;
      cryptoKey = null; cryptoSalt = null;
      await save(); lsDel(KEYS.enc); clearTimeout(idleT); render(); toast(t('Passcode removed.'));
    },
    install: async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); } },
    erase: async () => {
      if (!(await confirmBox(t('This permanently deletes every record on this device. Download a backup first if you might need it.'), t('Erase everything'), true))) return;
      [KEYS.plain, KEYS.enc, KEYS.corrupt].forEach(lsDel);
      cryptoKey = null; cryptoSalt = null; state = normalize(null);
      location.hash = '#/home'; welcome();
    },
    'start-fresh': () => {
      state.settings.household = ($('#wname').value || '').trim();
      state.meta.onboarded = true; save(); start();
    },
    'start-demo': () => {
      state.settings.household = ($('#wname').value || '').trim();
      loadDemo(); save(); start();
    },
    'unlock-erase': async () => {
      if (!(await confirmBox(t('Forgot your passcode? The only way forward is to erase the encrypted vault and start fresh, or restore from a backup afterwards. Erase now?'), t('Erase and start fresh'), true))) return;
      [KEYS.plain, KEYS.enc].forEach(lsDel);
      state = normalize(null); cryptoKey = null; welcome();
    }
  };

  document.addEventListener('click', e => {
    const tg = e.target.closest('[data-act]');
    if (!tg || tg.closest('.overlay [data-x]')) return;
    const act = tg.dataset.act, fn = handlers[act];
    if (!fn) return;
    e.preventDefault();
    if (DEMO_MODE && BLOCKED_IN_DEMO.indexOf(act) >= 0) { toast(t('Not available in the demo.')); return; }
    fn(tg, e);
  });
  document.addEventListener('change', e => {
    const tg = e.target;
    if (tg.classList && tg.classList.contains('langsel')) { setLang(tg.value); return; }
    if (!state) return;
    if (tg.id === 'hh') { state.settings.household = tg.value.trim(); save(); toast(t('Saved.')); }
    if (tg.id === 'theme') { setPrefs({ theme: tg.value }); applyTheme(); }
    if (tg.id === 'win') { state.settings.window = +tg.value; save(); toast(t('Saved.')); }
    if (tg.id === 'revon') { state.settings.review.on = tg.checked; save(); toast(t('Saved.')); }
    if (tg.id === 'impf' && tg.files[0]) { importBackup(tg.files[0]); tg.value = ''; }
  });
  document.addEventListener('input', e => {
    const tg = e.target;
    if (tg.id === 'note' && state) { state.settings.note = tg.value; clearTimeout(tg._s); tg._s = setTimeout(save, 400); }
    if (tg.id === 'modq') {
      const q = tg.value.toLowerCase();
      $$('#reclist .rec').forEach(c => c.classList.toggle('hidden', q && !c.dataset.text.includes(q)));
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('.overlay')) closeSheet(); });
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (state && /settings/.test(location.hash)) render(); });

  /* ------------------------------------------------------------------ lock, welcome, boot */
  let idleT = null;
  function bumpIdle() {
    if (!cryptoKey) return;
    clearTimeout(idleT);
    idleT = setTimeout(lock, 5 * 60 * 1000);
  }
  ['pointerdown', 'keydown', 'scroll'].forEach(ev => window.addEventListener(ev, bumpIdle, { passive: true }));
  function lock() {
    if (!cryptoKey) return;
    clearTimeout(idleT);
    $$('.overlay').forEach(o => o.remove());
    state = null; cryptoKey = null; cryptoSalt = null;
    renderLock();
  }
  function renderLock(msg) {
    screenFn = () => renderLock();
    $('#root').innerHTML = '<div class="center"><div class="card"><div class="row between"><h1>🔒 ' + T('Vault locked') + '</h1>' + langSelect() + '</div><p class="muted">' + T('Enter your passcode to open your vault.') + '</p>' +
      '<form id="lockf"><label class="f"><input type="password" id="lockp" autocomplete="current-password" placeholder="' + T('Passcode') + '" required></label><div class="err" id="lockerr" role="alert">' + esc(msg || '') + '</div>' +
      '<button class="btn primary" style="width:100%;margin-top:10px" type="submit">' + T('Unlock') + '</button></form>' +
      '<p class="small muted" style="margin-bottom:0">' + T('Forgot it?') + ' <a href="#" data-act="unlock-erase">' + T('Erase and start fresh') + '</a>. ' + T('You can restore a backup afterwards.') + '</p></div></div>';
    $('#lockf').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#lockf button'); btn.disabled = true; btn.textContent = t('Unlocking…');
      try {
        const blob = JSON.parse(lsGet(KEYS.enc));
        const salt = fromB64(blob.s), key = await deriveKey($('#lockp').value, salt);
        const obj = JSON.parse(await decryptBlob(blob, key));
        state = normalize(obj); cryptoKey = key; cryptoSalt = salt;
        start();
      } catch (er) {
        renderLock(t('Wrong passcode. Try again.'));
      }
    });
    setTimeout(() => { const p = $('#lockp'); if (p) p.focus(); }, 30);
  }
  function welcome() {
    screenFn = () => { const v = $('#wname') ? $('#wname').value : ''; welcome(); if ($('#wname')) $('#wname').value = v; };
    $('#root').innerHTML = '<div class="center"><div class="card"><div class="row between"><h1>🏠 Ghar ka Vault</h1>' + langSelect() + '</div><p class="muted" style="margin-top:0">' + T("Your family's money and papers, in one safe place.") + '</p>' +
      '<ul class="points"><li>🔐 <span><b>' + T('Private by design.') + '</b> ' + T('Everything stays on this device. No account, no cloud.') + '</span></li>' +
      '<li>⏰ <span><b>' + T('Never miss a due date.') + '</b> ' + T('Insurance, EMIs, bills, vehicle papers, warranties.') + '</span></li>' +
      '<li>🚨 <span><b>' + T('Be ready for emergencies.') + '</b> ' + T('A one-page sheet your family can use if you are unavailable.') + '</span></li></ul>' +
      '<label class="f">' + T('Family name (optional)') + '<input type="text" id="wname" placeholder="' + T('e.g. Patel family') + '"></label>' +
      '<div class="row" style="margin-top:14px"><button class="btn primary" style="flex:1" data-act="start-fresh">' + T('Start my vault') + '</button><button class="btn" style="flex:1" data-act="start-demo">' + T('Try with demo data') + '</button></div>' +
      '<p class="small muted" style="margin-bottom:0">' + T('Record-keeping tool only, not financial or legal advice. Never enter passwords or full account numbers.') + '</p></div></div>';
  }
  function start() {
    if (!state.meta.onboarded) { welcome(); return; }
    shell(); render(); bumpIdle();
    if (!DEMO_MODE && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  function afterLicence() {
    if (lsGet(KEYS.enc)) { renderLock(); return; }
    const raw = lsGet(KEYS.plain);
    try { state = normalize(raw ? JSON.parse(raw) : null); } catch (e) {
      try { lsSet(KEYS.corrupt, raw); } catch (er) { /* ignore */ }
      state = normalize(null);
    }
    start();
  }
  async function boot() {
    applyTheme(); initLang();
    try { lsSet('fv.probe', '1'); lsDel('fv.probe'); } catch (e) { storageOk = false; }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    if (DEMO_MODE) { state = normalize(null); loadDemo(); start(); return; }
    if (await checkLicence()) afterLicence();
  }
  if (window.__FV_DEBUG) window.__FV = { MODULES, readiness: () => readiness().map(r => r.text), UNITS };
  boot();
})();
