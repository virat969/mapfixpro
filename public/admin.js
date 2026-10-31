/* MapFixPro — private review page. Talks only to /api/admin/* with the owner's token.
   All customer text is inserted with textContent (never innerHTML). */
(function () {
  'use strict';
  var PAGE = 25;
  var token = '';
  var offset = 0;
  var photoUrls = [];

  function $(id) { return document.getElementById(id); }
  function store(get, v) {
    try { if (get) return sessionStorage.getItem('mfp_admin') || ''; if (v) sessionStorage.setItem('mfp_admin', v); else sessionStorage.removeItem('mfp_admin'); } catch (e) { /* storage may be blocked */ }
    return '';
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function api(path) {
    return fetch(path, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }, cache: 'no-store' });
  }
  function show(id, on) { var n = $(id); if (n) n.hidden = !on; }
  function say(id, msg) { var n = $(id); if (!n) return; n.textContent = msg; n.hidden = !msg; }

  function row(dl, label, node) {
    dl.appendChild(el('dt', null, label));
    var dd = el('dd');
    dd.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    dl.appendChild(dd);
  }
  function link(href, text) {
    var a = el('a', null, text);
    a.href = href;
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    return a;
  }

  function renderItem(it) {
    var card = el('article', 'adm-card');
    var top = el('div', 'adm-top');
    top.appendChild(el('span', 'adm-ref', it.reference));
    top.appendChild(el('span', 'adm-when', new Date(it.receivedAt).toLocaleString()));
    card.appendChild(top);

    var badges = el('div');
    badges.style.marginTop = '.5rem';
    badges.appendChild(el('span', 'adm-badge adm-type', it.type === 'order' ? 'Service request' : 'Contact message'));
    badges.appendChild(document.createTextNode(' '));
    var n = it.notify || {};
    var b = el('span', 'adm-badge ' + (n.emailed ? 'adm-ok' : 'adm-bad'), n.emailed ? 'Email sent' : 'Email NOT sent');
    if (n.detail) b.title = n.detail;
    badges.appendChild(b);
    card.appendChild(badges);
    if (!n.emailed && n.detail) card.appendChild(el('p', 'hint', n.detail));

    var dl = el('dl', 'adm-grid');
    if (it.type === 'order') {
      row(dl, 'Name', it.customerName);
      row(dl, 'Business', it.businessName);
      row(dl, 'Email', link('mailto:' + it.email, it.email));
      row(dl, 'Maps link', /^https:\/\//.test(it.mapsLink) ? link(it.mapsLink, it.mapsLink) : it.mapsLink);
      row(dl, 'Service', it.service);
      row(dl, 'Package', it.package);
      var d = el('span', 'adm-desc', it.description);
      row(dl, 'Changes', d);
    } else {
      row(dl, 'Name', it.name);
      row(dl, 'Email', link('mailto:' + it.email, it.email));
      row(dl, 'Topic', it.subject);
      row(dl, 'Message', el('span', 'adm-desc', it.message));
    }
    card.appendChild(dl);

    if (it.photos && it.photos.length) {
      var wrap = el('div', 'adm-photos');
      it.photos.forEach(function (p) {
        var a = el('a');
        a.title = p.filename;
        a.href = '#';
        var img = el('img');
        img.alt = 'Photo ' + p.n + ': ' + p.filename;
        a.appendChild(img);
        wrap.appendChild(a);
        api('/api/admin/photo/' + encodeURIComponent(it.reference) + '/' + p.n)
          .then(function (r) { if (!r.ok) throw new Error('x'); return r.blob(); })
          .then(function (blob) {
            var u = URL.createObjectURL(blob);
            photoUrls.push(u);
            img.src = u;
            a.href = u; a.target = '_blank'; a.rel = 'noopener';
          })
          .catch(function () { a.textContent = 'Photo unavailable'; });
      });
      card.appendChild(wrap);
    }
    return card;
  }

  async function load(reset) {
    say('list-error', '');
    if (reset) { offset = 0; $('orders').textContent = ''; photoUrls.forEach(URL.revokeObjectURL); photoUrls = []; }
    var res;
    try { res = await api('/api/admin/orders?limit=' + PAGE + '&offset=' + offset); }
    catch (e) { say('list-error', 'Could not reach the server. Check your connection.'); return false; }
    var data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !data || !data.ok) {
      say(res.status === 401 || res.status === 429 || res.status === 503 ? 'login-error' : 'list-error', (data && data.message) || 'Could not load requests.');
      return false;
    }
    data.items.forEach(function (it) { $('orders').appendChild(renderItem(it)); });
    offset += data.items.length;
    $('count-label').textContent = data.total + ' request' + (data.total === 1 ? '' : 's') + ' in total';
    $('more-btn').hidden = offset >= data.total;
    if (!data.total) say('list-error', 'No requests yet.');
    return true;
  }

  async function enter() {
    var ok = await load(true);
    if (ok) { show('login-card', false); show('list-area', true); store(false, token); }
    else { show('login-card', true); show('list-area', false); store(false, ''); }
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    token = $('token').value.trim();
    say('login-error', '');
    if (!token) { say('login-error', 'Please enter your access token.'); return; }
    enter();
  });
  $('refresh-btn').addEventListener('click', function () { load(true); });
  $('more-btn').addEventListener('click', function () { load(false); });
  $('logout-btn').addEventListener('click', function () {
    token = ''; store(false, ''); $('token').value = '';
    $('orders').textContent = ''; show('list-area', false); show('login-card', true);
  });

  var saved = store(true);
  if (saved) { token = saved; enter(); }
})();
