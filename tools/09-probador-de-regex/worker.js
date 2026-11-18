// Ejecuta la búsqueda en un hilo aparte para que un patrón lento no congele la página.
// Devuelve el nombre de cada grupo de captura en orden (null si no tiene nombre).
function groupNames(src) {
  var names = [], inClass = false;
  for (var i = 0; i < src.length; i++) {
    var c = src[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c !== '(') continue;
    if (src[i + 1] !== '?') { names.push(null); continue; }
    var m = /^\(\?<([^>=!][^>]*)>/.exec(src.slice(i));
    if (m) names.push(m[1]);
  }
  return names;
}
self.onmessage = function (e) {
  var d = e.data, MAX = d.max || 5000;
  try {
    var re = new RegExp(d.pattern, d.flags);
    var global = re.global || re.sticky;
    var out = [], truncated = false, m;
    function push(m) {
      var groups = [];
      for (var i = 1; i < m.length; i++) groups.push(m[i] === undefined ? null : m[i]);
      var named = null;
      if (m.groups) { named = {}; Object.keys(m.groups).forEach(function (k) { named[k] = m.groups[k] === undefined ? null : m.groups[k]; }); }
      out.push({ index: m.index, value: m[0], groups: groups, named: named });
    }
    if (re.global) {
      var it = d.text.matchAll(re);
      for (m of it) { if (out.length >= MAX) { truncated = true; break; } push(m); }
    } else if (re.sticky) {
      // Sin "g", la bandera "y" solo prueba en la posición 0.
      m = re.exec(d.text); if (m) push(m);
    } else {
      m = re.exec(d.text); if (m) push(m);
    }
    var replaced = null;
    if (typeof d.replacement === 'string') replaced = d.text.replace(new RegExp(d.pattern, d.flags), d.replacement);
    self.postMessage({ id: d.id, ok: true, names: groupNames(d.pattern), matches: out, truncated: truncated, replaced: replaced, global: global });
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String(err && err.message || err) });
  }
};
