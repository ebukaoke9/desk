/* Snapshot crypto for the Plan B static app. The 32-byte desk key lives only in the phone
   (from the #k= link, kept in localStorage) and in the desk's secrets/. The host only ever sees
   ciphertext under hashed file names. HKDF-SHA256 -> AES-256-GCM (data, AAD = logical name)
   and HMAC-SHA256 (file names). Same scheme as tools/publish.py. Works in browsers and Node 18+. */
(function (root) {
  'use strict';
  const C = (root.crypto || globalThis.crypto), S = C.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64u = {
    from(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); },
    to(b) { b = new Uint8Array(b); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  };
  const memo = new Map();
  async function keys(k) {
    if (memo.has(k)) return memo.get(k);
    const raw = b64u.from(k); if (raw.length !== 32) throw new Error('bad desk key');
    const base = await S.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const h = info => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) });
    const out = {
      data: await S.deriveKey(h('desk-data-v1'), base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']),
      sub: await S.deriveKey(h('desk-sub-v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']),
      name: await S.deriveKey(h('desk-name-v1'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
    };
    memo.set(k, out); return out;
  }
  async function fileName(k, logical) {
    const sig = new Uint8Array(await S.sign('HMAC', (await keys(k)).name, te.encode('desk-file:' + logical)));
    return Array.from(sig.slice(0, 16), x => x.toString(16).padStart(2, '0')).join('');
  }
  async function open(k, logical, buf) {
    const b = new Uint8Array(buf); if (b.length < 29) throw new Error('short file');
    return new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: te.encode(logical) }, (await keys(k)).data, b.slice(12)));
  }
  async function openJson(k, logical, buf) { return JSON.parse(td.decode(await open(k, logical, buf))); }
  async function sealSub(k, text) {
    const iv = C.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('push-sub') }, (await keys(k)).sub, te.encode(text)));
    const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
    return 'DESKSUB1.' + b64u.to(all);
  }
  root.DeskCrypt = { b64u, fileName, open, openJson, sealSub };
  if (typeof module !== 'undefined') module.exports = root.DeskCrypt;
})(typeof window !== 'undefined' ? window : globalThis);
