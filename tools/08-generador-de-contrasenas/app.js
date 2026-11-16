(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var WORDS = window.PALABRAS_ES || [];
  var SETS = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~|'
  };
  var AMBIGUOUS = 'Il1O0o|';
  var GUESSES_PER_SEC = 1e10;
  var mode = 'password';
  var lastList = [];

  // Entero aleatorio uniforme en [0, max) sin sesgo (muestreo por rechazo).
  function randInt(max) {
    if (max <= 0 || max > 4294967296) throw new Error('rango inválido');
    var limit = 4294967296 - (4294967296 % max), buf = new Uint32Array(1), x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % max;
  }
  function pick(str) { return str.charAt(randInt(str.length)); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) { var j = randInt(i + 1), t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function uniq(s) { var seen = {}, out = ''; for (var i = 0; i < s.length; i++) { var c = s[i]; if (!seen[c]) { seen[c] = 1; out += c; } } return out; }
  function filterSet(set, excl) { var o = ''; for (var i = 0; i < set.length; i++) if (excl.indexOf(set[i]) < 0) o += set[i]; return o; }
  function setStatus(msg, kind) { var el = $('status'); el.textContent = msg || ''; el.className = 'status' + (kind ? ' status--' + kind : ''); }
  function clampInput(el, min, max) { var v = parseInt(el.value, 10); if (isNaN(v)) v = min; v = Math.max(min, Math.min(max, v)); el.value = v; return v; }
  function log2(x) { return Math.log(x) / Math.LN2; }

  // ---------- Generadores ----------
  function passwordConfig() {
    var excl = $('pwExclude').value + ($('pwAmbiguous').checked ? AMBIGUOUS : '');
    var groups = [];
    ['upper', 'lower', 'digits', 'symbols'].forEach(function (k) {
      var id = { upper: 'pwUpper', lower: 'pwLower', digits: 'pwDigits', symbols: 'pwSymbols' }[k];
      if ($(id).checked) { var s = filterSet(SETS[k], excl); if (s) groups.push(s); }
    });
    var len = clampInput($('pwLenNum'), 4, 128);
    var all = uniq(groups.join(''));
    return { groups: groups, all: all, len: len, each: $('pwEach').checked };
  }
  function genPassword(cfg) {
    if (!cfg.all.length) throw new Error('Selecciona al menos un tipo de carácter (o revisa los caracteres excluidos).');
    var chars = [];
    if (cfg.each && cfg.groups.length <= cfg.len) cfg.groups.forEach(function (g) { chars.push(pick(g)); });
    while (chars.length < cfg.len) chars.push(pick(cfg.all));
    return shuffle(chars).join('');
  }
  function passwordEntropy(cfg) { return cfg.all.length ? cfg.len * log2(cfg.all.length) : 0; }

  function passphraseConfig() {
    return { n: clampInput($('ppWordsNum'), 3, 12), sep: $('ppSep').value, cap: $('ppCap').checked, num: $('ppNum').checked };
  }
  function genPassphrase(cfg) {
    if (!WORDS.length) throw new Error('No se pudo cargar la lista de palabras.');
    var w = [];
    for (var i = 0; i < cfg.n; i++) {
      var word = WORDS[randInt(WORDS.length)];
      if (cfg.cap) word = word.charAt(0).toUpperCase() + word.slice(1);
      w.push(word);
    }
    if (cfg.num) { var k = randInt(w.length); w[k] = w[k] + randInt(10); }
    return w.join(cfg.sep);
  }
  function passphraseEntropy(cfg) { return cfg.n * log2(WORDS.length || 1) + (cfg.num ? log2(10) + log2(cfg.n) : 0); }

  function isTrivialPin(p) {
    if (/^(\d)\1+$/.test(p)) return true;                       // 0000, 7777
    var asc = '01234567890123456789', desc = '98765432109876543210';
    if (asc.indexOf(p) >= 0 || desc.indexOf(p) >= 0) return true; // 1234, 9876
    if (p.length % 2 === 0 && /^(\d\d)\1+$/.test(p)) return true; // 1212
    if (/^(19|20)\d\d$/.test(p)) return true;                     // años
    return false;
  }
  function pinConfig() { return { len: clampInput($('pinLenNum'), 4, 12), noTrivial: $('pinNoTrivial').checked }; }
  function genPin(cfg) {
    var p;
    do { p = ''; for (var i = 0; i < cfg.len; i++) p += randInt(10); } while (cfg.noTrivial && isTrivialPin(p));
    return p;
  }
  function pinEntropy(cfg) { return cfg.len * log2(10); }

  function current() {
    if (mode === 'passphrase') { var c1 = passphraseConfig(); return { gen: function () { return genPassphrase(c1); }, bits: passphraseEntropy(c1) }; }
    if (mode === 'pin') { var c2 = pinConfig(); return { gen: function () { return genPin(c2); }, bits: pinEntropy(c2) }; }
    var c3 = passwordConfig(); return { gen: function () { return genPassword(c3); }, bits: passwordEntropy(c3) };
  }

  // ---------- Fortaleza ----------
  function crackTimeText(bits) {
    var secs = Math.pow(2, bits) / 2 / GUESSES_PER_SEC; // promedio: la mitad del espacio
    if (!isFinite(secs) || secs > 1e30) return 'más de mil billones de siglos';
    if (secs < 1) return 'instantáneo';
    var units = [['año', 'años', 31557600], ['día', 'días', 86400], ['hora', 'horas', 3600], ['minuto', 'minutos', 60], ['segundo', 'segundos', 1]];
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (secs >= u[2]) {
        var v = secs / u[2];
        if (u[2] === 31557600) {
          if (v >= 1e12) return 'billones de años o más';
          if (v >= 1e9) return Math.round(v / 1e9).toLocaleString('es-CO') + ' mil millones de años';
          if (v >= 1e6) return Math.round(v / 1e6).toLocaleString('es-CO') + ' millones de años';
          if (v >= 1000) return Math.round(v).toLocaleString('es-CO') + ' años';
        }
        v = Math.round(v);
        return v.toLocaleString('es-CO') + ' ' + (v === 1 ? u[0] : u[1]);
      }
    }
    return 'instantáneo';
  }
  function strength(bits) {
    if (bits < 28) return { label: 'Muy débil', color: '#fb7185', pct: 10 };
    if (bits < 36) return { label: 'Débil', color: '#fb923c', pct: 28 };
    if (bits < 60) return { label: 'Aceptable', color: '#fbbf24', pct: 50 };
    if (bits < 80) return { label: 'Fuerte', color: '#a3e635', pct: 75 };
    return { label: 'Muy fuerte', color: '#6ee7b7', pct: 100 };
  }
  function paint(bar, label, ent, crack, bits) {
    var s = strength(bits);
    bar.style.width = s.pct + '%'; bar.style.background = s.color;
    label.textContent = s.label; label.style.color = s.color;
    ent.textContent = Math.round(bits) + ' bits';
    crack.textContent = crackTimeText(bits);
  }

  // ---------- UI ----------
  function generate() {
    try {
      var c = current(), pw = c.gen();
      $('output').value = pw;
      paint($('meterBar'), $('strengthLabel'), $('entropy'), $('crackTime'), c.bits);
      setStatus('');
    } catch (e) {
      $('output').value = '';
      setStatus(e.message, 'error');
    }
  }
  function bulk() {
    try {
      var n = clampInput($('bulkCount'), 1, 100), c = current(), list = [];
      for (var i = 0; i < n; i++) list.push(c.gen());
      lastList = list;
      var ol = $('bulkList'); ol.innerHTML = '';
      list.forEach(function (p) { var li = document.createElement('li'); li.textContent = p; ol.appendChild(li); });
      ol.hidden = false; $('bulkCopy').disabled = false; $('bulkDownload').disabled = false;
      setStatus('Se generaron ' + n + ' elementos.', 'ok');
    } catch (e) { setStatus(e.message, 'error'); }
  }
  function copy(text, okMsg) {
    if (!text) return;
    var done = function () { setStatus(okMsg, 'ok'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { setStatus('No se pudo copiar automáticamente.', 'warn'); }
      ta.remove();
    }
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.mode === m)); });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== m; });
    $('genArea').hidden = m === 'check';
    $('checkArea').hidden = m !== 'check';
    $('bulkList').hidden = true; $('bulkCopy').disabled = true; $('bulkDownload').disabled = true; lastList = [];
    if (m === 'check') { $('checkInput').focus(); } else generate();
  }

  function linkRange(rangeId, numId, min, max) {
    var r = $(rangeId), n = $(numId);
    r.addEventListener('input', function () { n.value = r.value; generate(); });
    n.addEventListener('input', function () { var v = parseInt(n.value, 10); if (!isNaN(v) && v >= min && v <= max) { r.value = v; generate(); } });
    n.addEventListener('change', function () { r.value = clampInput(n, min, max); generate(); });
  }

  // ---------- Analizador ----------
  var COMMON = ['123456', '12345678', '123456789', 'password', 'contraseña', 'contrasena', 'qwerty', 'abc123', '111111', '000000',
    'iloveyou', 'teamo', 'admin', 'letmein', 'welcome', 'bienvenido', 'colombia', 'futbol', 'america', 'dragon', 'monkey', 'master', 'hola', 'clave'];
  function analyze(pw) {
    var tips = [];
    if (!pw) return { bits: 0, tips: tips };
    var pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    var bits = pw.length * log2(Math.max(pool, 2));
    var lower = pw.toLowerCase();
    if (COMMON.some(function (c) { return lower.indexOf(c) >= 0; })) { bits = Math.min(bits, 20); tips.push('Contiene una contraseña o palabra muy común.'); }
    if (/(.)\1{2,}/.test(pw)) { bits -= 8; tips.push('Tiene caracteres repetidos seguidos.'); }
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf|zxcv)/i.test(pw)) { bits -= 10; tips.push('Contiene secuencias de teclado o consecutivas.'); }
    if (/(19|20)\d\d/.test(pw)) { bits -= 6; tips.push('Parece incluir un año; evita fechas personales.'); }
    if (pw.length < 12) tips.push('Usa al menos 12 caracteres (mejor 16 o más).');
    if (pool < 60 && pw.length < 20) tips.push('Combina mayúsculas, minúsculas, números y símbolos, o usa una frase larga.');
    if (!tips.length) tips.push('¡Bien! No se detectaron patrones débiles evidentes.');
    return { bits: Math.max(0, bits), tips: tips };
  }
  function runCheck() {
    var pw = $('checkInput').value, r = analyze(pw), ul = $('checkTips');
    ul.innerHTML = '';
    if (!pw) { $('checkBar').style.width = '0'; $('checkLabel').textContent = '—'; $('checkLabel').style.color = ''; $('checkEntropy').textContent = '—'; $('checkCrack').textContent = '—'; return; }
    paint($('checkBar'), $('checkLabel'), $('checkEntropy'), $('checkCrack'), r.bits);
    r.tips.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
  }

  // ---------- Eventos ----------
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { setMode(t.dataset.mode); }); });
  $('genBtn').addEventListener('click', generate);
  $('copyBtn').addEventListener('click', function () { copy($('output').value, 'Copiado al portapapeles.'); });
  $('bulkBtn').addEventListener('click', bulk);
  $('bulkCopy').addEventListener('click', function () { copy(lastList.join('\n'), 'Lista copiada al portapapeles.'); });
  $('bulkDownload').addEventListener('click', function () {
    if (!lastList.length) return;
    var blob = new Blob([lastList.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'contrasenas.txt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });
  linkRange('pwLen', 'pwLenNum', 4, 128);
  linkRange('ppWords', 'ppWordsNum', 3, 12);
  linkRange('pinLen', 'pinLenNum', 4, 12);
  ['pwUpper', 'pwLower', 'pwDigits', 'pwSymbols', 'pwAmbiguous', 'pwEach', 'ppCap', 'ppNum', 'pinNoTrivial'].forEach(function (id) { $(id).addEventListener('change', generate); });
  $('pwExclude').addEventListener('input', generate);
  $('ppSep').addEventListener('change', generate);
  $('checkInput').addEventListener('input', runCheck);
  $('toggleVis').addEventListener('click', function () {
    var i = $('checkInput'), show = i.type === 'password';
    i.type = show ? 'text' : 'password'; this.textContent = show ? '🙈 Ocultar' : '👁️ Mostrar';
  });

  if (!window.crypto || !crypto.getRandomValues) { setStatus('Tu navegador no ofrece aleatoriedad criptográfica (crypto.getRandomValues).', 'error'); return; }
  generate();
})();
