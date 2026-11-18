(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TIMEOUT_MS = 2000;
  var VALID_FLAGS = 'dgimsuvy';

  var PRESETS = [
    { name: 'Correo', p: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', f: 'gi' },
    { name: 'URL', p: 'https?:\\/\\/[^\\s/$.?#][^\\s]*', f: 'gi' },
    { name: 'Celular Colombia', p: '(?:\\+?57\\s?)?3\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{4}', f: 'g' },
    { name: 'Fecha AAAA-MM-DD', p: '(?<anio>\\d{4})-(?<mes>0[1-9]|1[0-2])-(?<dia>0[1-9]|[12]\\d|3[01])', f: 'g' },
    { name: 'Fecha DD/MM/AAAA', p: '\\b(0[1-9]|[12]\\d|3[01])\\/(0[1-9]|1[0-2])\\/(\\d{4})\\b', f: 'g' },
    { name: 'IPv4', p: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', f: 'g' },
    { name: 'Color HEX', p: '#(?:[0-9a-f]{3}){1,2}\\b', f: 'gi' },
    { name: 'Números', p: '-?\\d+(?:[.,]\\d+)?', f: 'g' },
    { name: 'Palabras repetidas', p: '\\b(\\p{L}+)\\s+\\1\\b', f: 'giu' },
    { name: 'Etiquetas HTML', p: '<\\/?([a-z][a-z0-9]*)\\b[^>]*>', f: 'gi' },
    { name: 'Espacios al final', p: '[ \\t]+$', f: 'gm' }
  ];

  var SAMPLE = [
    'Hola, soy Andrea. Escríbeme a andrea.perez+web@ejemplo.com o a soporte@mi-empresa.co.',
    'Mi celular es +57 310 555 1234 y el de la oficina 320-555-9876.',
    'La reunión es el 2026-11-18 a las 9:00; la entrega, el 05/12/2026.',
    'Visita https://andreyrivera13.github.io/herramientas/ para ver más.',
    'El servidor está en 192.168.1.20 y el color principal es #6ee7b7.',
    'Total: 125.000 COP, descuento -15,5 %.',
    'Esto es es un error de de tipeo.',
    '<p class="nota">Texto <strong>importante</strong></p>'
  ].join('\n');

  var worker = null, reqId = 0, timer = null, debounce = null, last = null;

  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function setStatus(msg, kind) { var el = $('status'); el.textContent = msg || ''; el.className = 'status' + (kind ? ' status--' + kind : ''); }
  function showError(msg) {
    $('errBox').hidden = !msg; $('errMsg').textContent = msg || '';
    $('rxBox').classList.toggle('invalid', !!msg);
  }
  function getWorker() {
    if (!worker) { worker = new Worker('worker.js'); worker.onmessage = onResult; }
    return worker;
  }
  function killWorker() { if (worker) { worker.terminate(); worker = null; } }

  function normFlags(f) {
    var out = '';
    for (var i = 0; i < f.length; i++) { var c = f[i]; if (VALID_FLAGS.indexOf(c) >= 0 && out.indexOf(c) < 0) out += c; }
    return out;
  }
  function syncChecks() {
    var f = $('flags').value;
    document.querySelectorAll('#flagChecks input').forEach(function (cb) { cb.checked = f.indexOf(cb.dataset.flag) >= 0; });
  }

  function translateError(msg) {
    var m = msg.replace(/^Invalid regular expression: /, '');
    var map = [
      [/Unterminated group/i, 'Hay un paréntesis "(" sin cerrar.'],
      [/Unmatched '\)'/i, 'Hay un paréntesis ")" de más.'],
      [/Unterminated character class/i, 'Hay un corchete "[" sin cerrar.'],
      [/Nothing to repeat/i, 'Un cuantificador (*, +, ?, {n}) no tiene nada que repetir.'],
      [/Invalid flags/i, 'Banderas no válidas.'],
      [/Lone quantifier brackets/i, 'Llave "{" o "}" suelta; escápala como \\{ si es literal.'],
      [/\\ at end of pattern/i, 'El patrón termina con una barra invertida "\\" sin escapar.'],
      [/Invalid group/i, 'Grupo no válido: revisa la sintaxis de (?…).'],
      [/Duplicate capture group name/i, 'Hay dos grupos con el mismo nombre.'],
      [/Invalid named capture referenced/i, 'Se referencia un grupo con nombre que no existe.'],
      [/Invalid escape|Invalid Unicode escape|Invalid property name/i, 'Secuencia de escape no válida (con la bandera u las reglas son más estrictas).'],
      [/numbers out of order/i, 'Cuantificador {min,max} con números en orden incorrecto.'],
      [/Range out of order/i, 'Rango de caracteres invertido (p. ej. [z-a]).']
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(m)) return map[i][1] + ' (' + m + ')';
    return 'Expresión no válida: ' + m;
  }

  function run() {
    var pattern = $('pattern').value, flags = $('flags').value, text = $('text').value;
    updateHash();
    var nf = normFlags(flags);
    if (nf !== flags) { $('flags').value = nf; flags = nf; syncChecks(); }
    if (flags.indexOf('u') >= 0 && flags.indexOf('v') >= 0) { showError('Las banderas u y v no se pueden usar juntas.'); return renderEmpty(); }
    if (!pattern) { showError(''); $('rxInfo').textContent = ''; return renderEmpty('Escribe una expresión regular.'); }
    var re;
    try { re = new RegExp(pattern, flags); } catch (e) { showError(translateError(e.message)); $('rxInfo').textContent = ''; return renderEmpty(); }
    showError('');
    var groupCount = new RegExp('(?:' + pattern + ')|', flags.replace(/[gy]/g, '')).exec('').length - 1;
    $('rxInfo').textContent = groupCount + (groupCount === 1 ? ' grupo' : ' grupos') + ' · ' + String(re);

    var id = ++reqId;
    clearTimeout(timer);
    setStatus('Buscando…');
    timer = setTimeout(function () {
      if (id !== reqId) return;
      killWorker();
      renderEmpty();
      setStatus('La búsqueda tardó más de ' + (TIMEOUT_MS / 1000) + ' s y se detuvo. Es probable que el patrón tenga retroceso catastrófico (p. ej. (a+)+): hazlo más específico.', 'error');
    }, TIMEOUT_MS);
    getWorker().postMessage({ id: id, pattern: pattern, flags: flags, text: text, replacement: $('replacement').value });
  }

  function onResult(e) {
    var r = e.data;
    if (r.id !== reqId) return;
    clearTimeout(timer);
    if (!r.ok) { showError(translateError(r.error)); return renderEmpty(); }
    last = { matches: r.matches, text: $('text').value };
    render(r);
  }

  function renderEmpty(msg) {
    last = null;
    $('count').textContent = '—';
    $('highlight').innerHTML = esc($('text').value);
    $('matches').innerHTML = '<p class="meta">' + esc(msg || 'Aún no hay coincidencias.') + '</p>';
    $('replaced').value = '';
    $('copyMatches').disabled = $('copyJson').disabled = true;
    setStatus('');
  }

  function render(r) {
    var text = $('text').value, ms = r.matches, html = '', pos = 0, HL_MAX = 3000;
    for (var i = 0; i < ms.length && i < HL_MAX; i++) {
      var m = ms[i];
      if (m.index < pos) continue;
      html += esc(text.slice(pos, m.index));
      if (m.value === '') html += '<mark class="empty" title="Coincidencia vacía en ' + m.index + '"></mark>';
      else html += '<mark class="' + (i % 2 ? 'alt' : '') + '" title="#' + (i + 1) + ' · posición ' + m.index + '">' + esc(m.value) + '</mark>';
      pos = m.index + m.value.length;
    }
    html += esc(text.slice(pos));
    $('highlight').innerHTML = html;

    var n = ms.length;
    $('count').textContent = n === 0 ? 'Sin coincidencias' : n + (r.truncated ? '+' : '') + (n === 1 ? ' coincidencia' : ' coincidencias');
    if (n === 0) setStatus('No hay coincidencias.', 'warn');
    else setStatus(r.truncated ? 'Se muestran las primeras ' + n + ' coincidencias.' : (r.global ? '' : 'Sin la bandera g solo se busca la primera coincidencia.'), r.truncated ? 'warn' : (r.global ? 'ok' : ''));

    var list = ms.slice(0, 500).map(function (m, i) {
      var rows = m.groups.map(function (g, gi) {
        var name = (r.names && r.names[gi]) || '';
        return '<tr><td>$' + (gi + 1) + (name ? ' &lt;' + esc(name) + '&gt;' : '') + '</td>' +
          (g === null ? '<td class="undef">sin coincidencia</td>' : '<td>' + esc(JSON.stringify(g)) + '</td>') + '</tr>';
      }).join('');
      return '<div class="match"><div class="mh"><span>#' + (i + 1) + '</span><span>posición ' + m.index + '–' + (m.index + m.value.length) + ' · ' + m.value.length + ' car.</span></div>' +
        '<div class="mv">' + esc(JSON.stringify(m.value)) + '</div>' + (rows ? '<table>' + rows + '</table>' : '') + '</div>';
    }).join('');
    if (ms.length > 500) list += '<p class="meta">… y ' + (ms.length - 500) + ' más.</p>';
    $('matches').innerHTML = list || '<p class="meta">Aún no hay coincidencias.</p>';
    $('copyMatches').disabled = $('copyJson').disabled = n === 0;
    $('replaced').value = r.replaced == null ? '' : r.replaced;
  }

  function schedule() { clearTimeout(debounce); debounce = setTimeout(run, 120); }

  function copy(text, okMsg) {
    var done = function () { setStatus(okMsg, 'ok'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (_) { setStatus('No se pudo copiar.', 'error'); }
      ta.remove();
    }
  }

  // ---------- Enlace compartible ----------
  function updateHash() {
    var p = new URLSearchParams();
    if ($('pattern').value) p.set('p', $('pattern').value);
    if ($('flags').value) p.set('f', $('flags').value);
    if ($('replacement').value) p.set('r', $('replacement').value);
    var t = $('text').value;
    if (t && t.length <= 2000) p.set('t', t);
    var h = p.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }
  function loadHash() {
    if (!location.hash || location.hash.length < 2) return false;
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.has('p')) return false;
    $('pattern').value = p.get('p') || '';
    $('flags').value = p.has('f') ? p.get('f') : 'g';
    $('replacement').value = p.get('r') || '';
    if (p.has('t')) $('text').value = p.get('t');
    return true;
  }

  // ---------- Eventos ----------
  $('pattern').addEventListener('input', schedule);
  $('text').addEventListener('input', schedule);
  $('replacement').addEventListener('input', schedule);
  $('flags').addEventListener('input', function () { syncChecks(); schedule(); });
  document.querySelectorAll('#flagChecks input').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var f = $('flags').value.replace(cb.dataset.flag, '');
      if (cb.checked) f += cb.dataset.flag;
      $('flags').value = VALID_FLAGS.split('').filter(function (c) { return f.indexOf(c) >= 0; }).join('');
      schedule();
    });
  });
  $('presets').innerHTML = PRESETS.map(function (p, i) { return '<button type="button" class="subtle small" data-i="' + i + '">' + esc(p.name) + '</button>'; }).join('');
  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var p = PRESETS[+b.dataset.i];
    $('pattern').value = p.p; $('flags').value = p.f; syncChecks();
    if (!$('text').value) $('text').value = SAMPLE;
    run();
  });
  $('sampleBtn').addEventListener('click', function () { $('text').value = SAMPLE; run(); });
  $('clearBtn').addEventListener('click', function () { $('text').value = ''; run(); $('text').focus(); });
  $('copyMatches').addEventListener('click', function () {
    if (last) copy(last.matches.map(function (m) { return m.value; }).join('\n'), 'Coincidencias copiadas.');
  });
  $('copyJson').addEventListener('click', function () {
    if (last) copy(JSON.stringify(last.matches, null, 2), 'Coincidencias copiadas como JSON.');
  });
  $('copyReplaced').addEventListener('click', function () { copy($('replaced').value, 'Resultado copiado.'); });
  $('copyLink').addEventListener('click', function () { updateHash(); copy(location.href, 'Enlace copiado.'); });
  $('copyCode').addEventListener('click', function () {
    var lit = '/' + $('pattern').value.replace(/(^|[^\\])\//g, '$1\\/') + '/' + $('flags').value;
    copy('const re = ' + lit + ';', 'Código copiado.');
  });

  if (!loadHash()) { $('pattern').value = PRESETS[0].p; $('flags').value = PRESETS[0].f; $('text').value = SAMPLE; }
  syncChecks();
  run();
})();
