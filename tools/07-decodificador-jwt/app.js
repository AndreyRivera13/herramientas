(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var tokenEl = $('token'), statusEl = $('status'), coloredEl = $('colored'), resultEl = $('result');
  var headerEl = $('header'), payloadEl = $('payload'), claimsEl = $('claims'), timeInfo = $('timeInfo');
  var sigInfo = $('sigInfo'), secretEl = $('secret'), secretB64 = $('secretB64'), verifyStatus = $('verifyStatus');
  var current = null;
  var SAMPLE_SECRET = 'secreto-de-ejemplo';

  var CLAIMS = {
    iss: 'Emisor (issuer)', sub: 'Sujeto (subject)', aud: 'Audiencia (audience)',
    exp: 'Expira (expiration time)', nbf: 'No válido antes de (not before)', iat: 'Emitido el (issued at)',
    jti: 'ID único del token', name: 'Nombre', email: 'Correo', role: 'Rol', roles: 'Roles',
    scope: 'Alcances (scopes)', azp: 'Parte autorizada', nonce: 'Nonce', sid: 'ID de sesión',
    auth_time: 'Momento de autenticación', preferred_username: 'Usuario preferido', given_name: 'Nombre de pila',
    family_name: 'Apellido', locale: 'Idioma', email_verified: 'Correo verificado'
  };
  var TIME_CLAIMS = { exp: 1, nbf: 1, iat: 1, auth_time: 1 };

  function setStatus(el, msg, kind) { el.textContent = msg || ''; el.className = 'status' + (kind ? ' status--' + kind : ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function b64urlToBytes(s) {
    if (!/^[A-Za-z0-9_\-+/]*={0,2}$/.test(s)) throw new Error('contiene caracteres que no son Base64URL');
    s = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (s.length % 4 === 1) throw new Error('longitud Base64URL inválida');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64url(bytes) {
    var bin = ''; bytes = new Uint8Array(bytes);
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function strToB64url(str) { return bytesToB64url(new TextEncoder().encode(str)); }
  function decodePart(part, label) {
    var bytes;
    try { bytes = b64urlToBytes(part); } catch (e) { throw new Error('El ' + label + ' ' + e.message + '.'); }
    var text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { throw new Error('El ' + label + ' no es texto UTF‑8 válido.'); }
    try { return JSON.parse(text); } catch (e) { throw new Error('El ' + label + ' no es JSON válido: ' + e.message); }
  }

  function fmtDate(sec) {
    var d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'medium' }) + ' (hora local) · ' + d.toISOString();
  }
  function rel(sec) {
    var diff = Math.round(sec - Date.now() / 1000), a = Math.abs(diff), txt;
    if (a < 60) txt = a + ' s';
    else if (a < 3600) txt = Math.round(a / 60) + ' min';
    else if (a < 86400) txt = (a / 3600).toFixed(1).replace('.0', '') + ' h';
    else txt = Math.round(a / 86400) + ' días';
    return diff >= 0 ? 'en ' + txt : 'hace ' + txt;
  }

  function cleanToken(raw) {
    return raw.trim().replace(/^bearer\s+/i, '').replace(/^authorization:\s*bearer\s+/i, '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
  }

  function decode() {
    var raw = cleanToken(tokenEl.value);
    current = null; setStatus(verifyStatus, '');
    tokenEl.classList.remove('valid', 'invalid');
    if (!raw) { resultEl.hidden = true; coloredEl.hidden = true; setStatus(statusEl, ''); return; }
    var parts = raw.split('.');
    if (parts.length === 5) { fail('Parece un JWE (token cifrado, 5 partes): su contenido no se puede leer sin la clave privada.'); return; }
    if (parts.length !== 3) { fail('Un JWT debe tener 3 partes separadas por puntos (encabezado.payload.firma); este tiene ' + parts.length + '.'); return; }
    var header, payload;
    try { header = decodePart(parts[0], 'encabezado'); payload = decodePart(parts[1], 'payload'); }
    catch (e) { fail(e.message); return; }
    current = { parts: parts, header: header, payload: payload };
    tokenEl.classList.add('valid');
    coloredEl.innerHTML = '<span class="h">' + esc(parts[0]) + '</span><span class="dot">.</span><span class="p">' + esc(parts[1]) + '</span><span class="dot">.</span><span class="s">' + esc(parts[2]) + '</span>';
    coloredEl.hidden = false;
    headerEl.textContent = JSON.stringify(header, null, 2);
    payloadEl.textContent = (payload !== null && typeof payload === 'object') ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
    renderClaims(payload);
    renderSig(header, parts[2]);
    resultEl.hidden = false;
    setStatus(statusEl, '✓ Token decodificado (' + (header.alg || 'sin alg') + (header.typ ? ', ' + header.typ : '') + ').', 'ok');
  }

  function fail(msg) {
    tokenEl.classList.add('invalid');
    resultEl.hidden = true; coloredEl.hidden = true;
    setStatus(statusEl, '✗ ' + msg, 'error');
  }

  function renderClaims(p) {
    var rows = [], now = Date.now() / 1000, notes = [];
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      Object.keys(p).forEach(function (k) {
        var v = p[k], valHtml = '<code>' + esc(typeof v === 'string' ? v : JSON.stringify(v)) + '</code>';
        if (TIME_CLAIMS[k] && typeof v === 'number') {
          valHtml += '<br><span class="meta">' + esc(fmtDate(v)) + ' — ' + esc(rel(v)) + '</span>';
        }
        rows.push('<tr><td><code>' + esc(k) + '</code></td><td>' + valHtml + '</td><td>' + esc(CLAIMS[k] || '—') + '</td></tr>');
      });
      if (typeof p.exp === 'number') notes.push(p.exp < now ? '<span class="bad">⛔ Expirado ' + esc(rel(p.exp)) + '.</span>' : '<span class="ok">✓ Vigente: expira ' + esc(rel(p.exp)) + '.</span>');
      else notes.push('<span class="warn">⚠ Sin claim «exp»: el token no expira.</span>');
      if (typeof p.nbf === 'number' && p.nbf > now) notes.push('<span class="warn">⏳ Aún no es válido (nbf ' + esc(rel(p.nbf)) + ').</span>');
      if (typeof p.iat === 'number' && p.iat > now + 60) notes.push('<span class="warn">⚠ «iat» está en el futuro.</span>');
    }
    claimsEl.innerHTML = rows.join('') || '<tr><td colspan="3" class="meta">El payload no es un objeto con claims.</td></tr>';
    timeInfo.innerHTML = notes.join(' ');
  }

  var HS = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
  function renderSig(header, sig) {
    var alg = header.alg || '';
    var len = 0; try { len = b64urlToBytes(sig).length; } catch (_) {}
    sigInfo.textContent = 'Algoritmo: ' + (alg || '(ninguno)') + ' · Firma: ' + (sig ? len + ' bytes' : 'vacía');
    var canVerify = !!HS[alg];
    $('verifyBtn').disabled = !canVerify; secretEl.disabled = !canVerify; secretB64.disabled = !canVerify;
    if (alg === 'none' || !sig) setStatus(verifyStatus, '⚠ Token sin firma (alg «none»): cualquiera puede modificarlo.', 'warn');
    else if (!canVerify) setStatus(verifyStatus, 'La verificación aquí solo admite HMAC (HS256/384/512). Para ' + alg + ' se necesita la clave pública y verificarla en tu backend.', 'warn');
  }

  async function hmac(alg, keyBytes, data) {
    var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: HS[alg] }, false, ['sign']);
    return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  }

  async function verify() {
    if (!current) return;
    var alg = current.header.alg;
    if (!HS[alg]) return;
    if (!window.crypto || !crypto.subtle) { setStatus(verifyStatus, 'Tu navegador no soporta Web Crypto (requiere HTTPS).', 'error'); return; }
    var keyBytes;
    try { keyBytes = secretB64.checked ? b64urlToBytes(secretEl.value.trim()) : new TextEncoder().encode(secretEl.value); }
    catch (e) { setStatus(verifyStatus, 'El secreto no es Base64 válido.', 'error'); return; }
    if (!keyBytes.length) { setStatus(verifyStatus, 'Escribe el secreto para verificar.', 'warn'); return; }
    var sig = await hmac(alg, keyBytes, current.parts[0] + '.' + current.parts[1]);
    if (bytesToB64url(sig) === current.parts[2]) setStatus(verifyStatus, '✓ Firma válida: el token fue firmado con este secreto y no ha sido modificado.', 'ok');
    else setStatus(verifyStatus, '✗ Firma inválida: el secreto no coincide o el token fue alterado.', 'error');
  }

  async function sample() {
    var now = Math.floor(Date.now() / 1000);
    var h = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    var p = strToB64url(JSON.stringify({ sub: '1234567890', name: 'María Pérez', email: 'maria@ejemplo.com', role: 'admin', iat: now, exp: now + 3600, iss: 'https://auth.ejemplo.com' }));
    var sig = await hmac('HS256', new TextEncoder().encode(SAMPLE_SECRET), h + '.' + p);
    tokenEl.value = h + '.' + p + '.' + bytesToB64url(sig);
    secretEl.value = SAMPLE_SECRET; secretB64.checked = false;
    decode();
  }

  function copy(el, btn) {
    var t = el.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
      var o = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(function () { btn.textContent = o; }, 1200);
    }).catch(function () {});
  }

  tokenEl.addEventListener('input', decode);
  $('clearBtn').addEventListener('click', function () { tokenEl.value = ''; secretEl.value = ''; decode(); tokenEl.focus(); });
  $('sampleBtn').addEventListener('click', function () { sample().catch(function (e) { setStatus(statusEl, 'No se pudo generar el ejemplo: ' + e.message, 'error'); }); });
  $('verifyBtn').addEventListener('click', function () { verify().catch(function (e) { setStatus(verifyStatus, 'Error al verificar: ' + e.message, 'error'); }); });
  secretEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') $('verifyBtn').click(); });
  $('copyHeader').addEventListener('click', function () { copy(headerEl, this); });
  $('copyPayload').addEventListener('click', function () { copy(payloadEl, this); });
  if (tokenEl.value) decode();
})();
