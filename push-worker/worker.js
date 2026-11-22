/**
 * DailyJon Push — Cloudflare Worker (gratis)
 * Mengirim notifikasi Web Push ke iPhone tepat waktu, walau DailyJon tertutup.
 *
 * Butuh:  1 KV namespace dengan binding bernama  KV
 *         1 Cron Trigger:  * * * * *   (tiap menit)
 * Kunci VAPID dibuat otomatis saat pertama dipakai dan disimpan di KV.
 *
 * Endpoint:
 *   GET  /            → status
 *   GET  /vapid       → { key }  kunci publik VAPID untuk PushManager.subscribe
 *   POST /subscribe   → { token, sub }            simpan langganan perangkat
 *   POST /schedule    → { token, items:[{t,title,body,tag,url}] }  jadwal 7 hari ke depan
 *   POST /test        → { token }                 kirim notifikasi uji sekarang
 *   POST /unsubscribe → { token }
 */
const enc = new TextEncoder();
const b64u = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ub64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

async function getVapid(env) {
  let k = await env.KV.get('vapid', 'json');
  if (!k) {
    const kp = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
    k = {jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey))};
    await env.KV.put('vapid', JSON.stringify(k));
  }
  return k;
}
async function vapidHeader(endpoint, k, subject) {
  const h = b64u(enc.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const p = b64u(enc.encode(JSON.stringify({aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject})));
  const key = await crypto.subtle.importKey('jwk', {...k.jwk, key_ops: ['sign']}, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, enc.encode(`${h}.${p}`));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${k.pub}`;
}
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt, info}, key, len * 8));
}
// RFC 8291 (Message Encryption for Web Push) + RFC 8188 (aes128gcm)
async function encryptPayload(sub, text) {
  const uaPub = ub64u(sub.keys.p256dh), auth = ub64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaKey}, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, key, concat(enc.encode(text), new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}
async function sendPush(env, u, data) {
  const k = await getVapid(env);
  const res = await fetch(u.sub.endpoint, {
    method: 'POST',
    headers: {Authorization: await vapidHeader(u.sub.endpoint, k, u.subject || 'mailto:dailyjon@example.com'),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high'},
    body: await encryptPayload(u.sub, JSON.stringify(data).slice(0, 3000))
  });
  return res.status;
}
async function idOf(token) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(token))).slice(0, 32); }
const clean = (s, n) => String(s ?? '').slice(0, n);

async function runDue(env, at) {
  // Jendela tetap per menit: setiap item hanya masuk ke satu jendela → tidak terkirim ganda.
  const from = at - 40000, to = at + 20000;
  const ids = (await env.KV.get('ids', 'json')) || [];
  for (const id of ids) {
    const u = await env.KV.get('u:' + id, 'json');
    if (!u || !u.sub) continue;
    const due = (u.items || []).filter(it => it.t > from && it.t <= to).slice(0, 6);
    for (const it of due) {
      const st = await sendPush(env, u, {title: it.title, body: it.body, tag: it.tag, url: it.url});
      if (st === 404 || st === 410) { // langganan sudah tidak berlaku
        await env.KV.delete('u:' + id);
        await env.KV.put('ids', JSON.stringify(ids.filter(x => x !== id)));
        break;
      }
    }
  }
}

export default {
  async fetch(req, env) {
    const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'};
    const J = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {...cors, 'Content-Type': 'application/json'}});
    if (req.method === 'OPTIONS') return new Response(null, {headers: cors});
    const url = new URL(req.url);
    try {
      if (!env.KV) return J({error: 'KV belum dihubungkan (binding harus bernama KV)'}, 500);
      if (url.pathname === '/') return J({ok: true, app: 'DailyJon Push', time: new Date().toISOString()});
      if (url.pathname === '/vapid') return J({key: (await getVapid(env)).pub});
      if (req.method !== 'POST') return J({error: 'gunakan POST'}, 405);
      const b = await req.json();
      if (typeof b.token !== 'string' || b.token.length < 20) return J({error: 'token tidak valid'}, 400);
      const id = await idOf(b.token), key = 'u:' + id;
      if (url.pathname === '/subscribe') {
        const s = b.sub;
        if (!s || !/^https:\/\//.test(s.endpoint || '') || !s.keys?.p256dh || !s.keys?.auth) return J({error: 'langganan tidak valid'}, 400);
        const u = (await env.KV.get(key, 'json')) || {items: []};
        u.sub = {endpoint: s.endpoint, keys: {p256dh: s.keys.p256dh, auth: s.keys.auth}};
        u.subject = env.VAPID_SUBJECT || `https://${url.hostname}`;
        await env.KV.put(key, JSON.stringify(u));
        const ids = (await env.KV.get('ids', 'json')) || [];
        if (!ids.includes(id)) { ids.push(id); while (ids.length > 10) ids.shift(); await env.KV.put('ids', JSON.stringify(ids)); }
        return J({ok: true});
      }
      const u = await env.KV.get(key, 'json');
      if (!u) return J({error: 'perangkat belum terdaftar'}, 404);
      if (url.pathname === '/schedule') {
        const now = Date.now();
        u.items = (Array.isArray(b.items) ? b.items : [])
          .filter(it => typeof it.t === 'number' && it.t > now - 60000 && it.t < now + 8 * 864e5)
          .map(it => ({t: it.t, title: clean(it.title, 120), body: clean(it.body, 240), tag: clean(it.tag, 64), url: clean(it.url, 200)}))
          .sort((a, c) => a.t - c.t).slice(0, 400);
        await env.KV.put(key, JSON.stringify(u));
        return J({ok: true, count: u.items.length});
      }
      if (url.pathname === '/test') {
        const st = await sendPush(env, u, {title: 'DailyJon 🔔', body: 'Notifikasi berhasil! Pengingatmu akan muncul di sini.', tag: 'test'});
        return J({ok: st >= 200 && st < 300, status: st}, st >= 200 && st < 300 ? 200 : 502);
      }
      if (url.pathname === '/unsubscribe') {
        await env.KV.delete(key);
        const ids = (await env.KV.get('ids', 'json')) || [];
        await env.KV.put('ids', JSON.stringify(ids.filter(x => x !== id)));
        return J({ok: true});
      }
      return J({error: 'tidak ditemukan'}, 404);
    } catch (e) { return J({error: String(e?.message || e)}, 500); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runDue(env, event.scheduledTime)); }
};
