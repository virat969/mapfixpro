/* MapFixPro — order form + contact form.
   RULE: a success message is shown ONLY after the server has confirmed it accepted the request
   (HTTP 200 with {"ok": true, "reference": "..."}). Anything else (network error, bad response,
   timeout, validation problem, spam rejection) shows an honest error and keeps the form filled in. */
(function () {
  'use strict';

  var cfg = window.MAPFIXPRO_CONFIG || {};
  var V = window.MFPValidate;
  var MAX_PHOTOS = Number(cfg.MAX_PHOTOS) || 4;
  var MAX_MB = Number(cfg.MAX_PHOTO_MB) || 4;
  var BUDGET_BYTES = Math.floor((Number(cfg.UPLOAD_BUDGET_MB) || 3.5) * 1024 * 1024);
  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var ENDPOINT = String(cfg.ORDER_ENDPOINT || '/api/submit').trim();
  var TS_KEY = String(cfg.TURNSTILE_SITE_KEY || '').trim();
  var PAGE_LOADED_AT = Date.now();

  function $(id) { return document.getElementById(id); }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ---------- error display helpers ---------- */
  function setError(form, field, message) {
    var err = $(field + '-error');
    if (err) { err.textContent = message; err.hidden = false; }
    Array.prototype.forEach.call(form.querySelectorAll('[data-field="' + field + '"]'), function (el) {
      el.setAttribute('aria-invalid', 'true');
    });
  }
  function clearError(form, field) {
    var err = $(field + '-error');
    if (err) { err.textContent = ''; err.hidden = true; }
    Array.prototype.forEach.call(form.querySelectorAll('[data-field="' + field + '"]'), function (el) {
      el.removeAttribute('aria-invalid');
    });
  }
  function clearAllErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll('.error'), function (el) { el.hidden = true; el.textContent = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
  }

  function showSummary(form, errors) {
    var box = $('form-summary');
    if (!box) return;
    box.innerHTML = '';
    var p = document.createElement('div');
    p.textContent = errors.length === 1
      ? 'Please fix 1 field below, then send again.'
      : 'Please fix ' + errors.length + ' fields below, then send again.';
    box.appendChild(p);
    box.hidden = false;
  }
  function hideSummary() { var box = $('form-summary'); if (box) box.hidden = true; }

  function showStatus(kind, message) {
    var box = $('form-status');
    if (!box) return;
    box.className = 'alert alert-' + (kind === 'error' ? 'error' : 'info');
    box.textContent = message;
    box.hidden = false;
    if (kind === 'error' && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideStatus() { var box = $('form-status'); if (box) { box.hidden = true; box.textContent = ''; } }

  /* ---------- optional Turnstile spam check ---------- */
  var tsToken = '';
  var tsWidget = null;
  function initTurnstile() {
    var box = $('turnstile-box');
    if (!TS_KEY || !box) return;
    box.hidden = false;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      if (!window.turnstile) return;
      tsWidget = window.turnstile.render(box, {
        sitekey: TS_KEY,
        callback: function (t) { tsToken = t; var e = $('turnstile-error'); if (e) { e.hidden = true; } },
        'expired-callback': function () { tsToken = ''; },
        'error-callback': function () { tsToken = ''; }
      });
    };
    s.onerror = function () { showStatus('error', 'The spam check could not load. Please check your connection and reload the page.'); };
    document.head.appendChild(s);
  }
  function resetTurnstile() {
    tsToken = '';
    if (tsWidget !== null && window.turnstile) { try { window.turnstile.reset(tsWidget); } catch (e) { /* ignore */ } }
  }

  /* ---------- photo optimisation (keeps the request under the hosting limit) ---------- */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file).catch(function () { return loadViaImage(file); });
    }
    return loadViaImage(file);
  }
  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
      img.src = url;
    });
  }
  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
  }

  /* Re-encodes one image as JPEG, stepping down size/quality until it is at most targetBytes. */
  async function shrinkImage(file, targetBytes) {
    var bmp = await loadBitmap(file);
    var w0 = bmp.width || bmp.naturalWidth;
    var h0 = bmp.height || bmp.naturalHeight;
    var dims = [2400, 2000, 1600, 1280, 1024, 800];
    var qualities = [0.86, 0.78, 0.7, 0.6];
    var best = null;
    for (var d = 0; d < dims.length; d++) {
      var scale = Math.min(1, dims[d] / Math.max(w0, h0));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; /* PNG/WebP transparency becomes white instead of black */
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (var q = 0; q < qualities.length; q++) {
        var blob = await canvasToBlob(canvas, qualities[q]);
        if (!blob) throw new Error('encode-failed');
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= targetBytes) {
          if (bmp.close) bmp.close();
          return blob;
        }
      }
      /* Not small enough at this dimension even at the lowest quality: try smaller dimensions. */
    }
    if (bmp.close) bmp.close();
    if (best && best.size <= targetBytes) return best;
    throw new Error('too-big-after-resize');
  }

  /* Returns the files to upload. Photos are left untouched when they already fit the budget. */
  async function preparePhotos(files) {
    var total = files.reduce(function (n, f) { return n + f.size; }, 0);
    if (total <= BUDGET_BYTES) return files.slice();

    /* Share the budget: small photos keep their size, the bigger ones split what is left. */
    var big = files.map(function (f, i) { return { f: f, i: i }; });
    var remaining = BUDGET_BYTES;
    var changed = true;
    var share = remaining / big.length;
    while (changed && big.length) {
      changed = false;
      share = remaining / big.length;
      for (var k = big.length - 1; k >= 0; k--) {
        if (big[k].f.size <= share) { remaining -= big[k].f.size; big.splice(k, 1); changed = true; }
      }
    }
    var out = files.slice();
    for (var b = 0; b < big.length; b++) {
      var item = big[b];
      var blob = await shrinkImage(item.f, Math.floor(share * 0.97));
      var base = item.f.name.replace(/\.[^.]+$/, '') || 'photo';
      out[item.i] = new File([blob], base + '.jpg', { type: 'image/jpeg' });
    }
    return out;
  }

  /* ---------- network ---------- */
  function ServerError(message, status, fields) {
    var e = new Error(message || 'server-error');
    e.name = 'ServerError';
    e.status = status;
    e.fields = fields || null;
    return e;
  }

  async function send(payload, files, signalHolder) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, Number(cfg.REQUEST_TIMEOUT_MS) || 60000);
    try {
      var fd = new FormData();
      Object.keys(payload).forEach(function (k) { fd.append(k, payload[k]); });
      files.forEach(function (f) { fd.append('photos', f, f.name); });
      if (TS_KEY) fd.append('cf-turnstile-response', tsToken);

      /* Do NOT set Content-Type: the browser adds the multipart boundary itself. */
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        body: fd,
        headers: { 'Accept': 'application/json' },
        signal: controller ? controller.signal : undefined,
        credentials: 'same-origin'
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }

      if (res.ok && data && data.ok === true && typeof data.reference === 'string' && data.reference) return data;
      throw ServerError(data && data.message, res.status, data && data.fields);
    } finally {
      clearTimeout(timer);
    }
  }

  function contactHint() {
    var mail = String(cfg.CONTACT_EMAIL || '').trim();
    return mail ? ' If this keeps happening, email us at ' + mail + '.' : '';
  }

  function friendlyFailure(err) {
    if (err && err.name === 'AbortError') {
      return 'The request timed out, so we cannot confirm it was saved. Your request was NOT confirmed. Please check your connection and try again.' + contactHint();
    }
    if (err && err.name === 'ServerError' && err.message && err.message !== 'server-error') {
      return err.message + (err.status >= 500 ? contactHint() : '');
    }
    if (err && err.message === 'photo-processing') {
      return 'One of your photos could not be prepared. Please remove it or choose a different JPG, PNG or WebP image, then try again. Your request was NOT sent.';
    }
    return 'Sorry, your request was NOT sent because we could not reach our server. Please check your connection and try again. Your answers are still in the form.' + contactHint();
  }

  /* ---------- shared submit wiring ---------- */
  function wire(opts) {
    var form = $(opts.formId);
    if (!form) return;
    var submitBtn = form.querySelector('button[type="submit"]');
    var submitLabel = submitBtn ? submitBtn.textContent : '';
    var busy = false;

    /* live validation; fieldCheck returns null for fields it does not manage */
    form.addEventListener('focusout', function (e) {
      var t = e.target;
      var field = t && t.getAttribute && t.getAttribute('data-field');
      if (!field || !opts.fieldCheck) return;
      var msg = opts.fieldCheck(field, opts.collect(form));
      if (msg === null) return;
      if (msg) setError(form, field, msg); else clearError(form, field);
    });
    form.addEventListener('input', function (e) {
      var t = e.target;
      var field = t && t.getAttribute && t.getAttribute('data-field');
      if (!field || !opts.fieldCheck) return;
      if (t.getAttribute('aria-invalid') === 'true' && opts.fieldCheck(field, opts.collect(form)) === '') clearError(form, field);
    });
    form.addEventListener('change', function (e) {
      var t = e.target;
      var field = t && t.getAttribute && t.getAttribute('data-field');
      if (!field || !opts.fieldCheck) return;
      if (opts.fieldCheck(field, opts.collect(form)) === '') clearError(form, field);
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busy) return;
      hideStatus();
      hideSummary();

      var values = opts.collect(form);
      var errors = opts.validate(values);
      clearAllErrors(form);
      if (opts.extraErrors) errors = errors.concat(opts.extraErrors());
      if (TS_KEY && !tsToken) errors.push({ field: 'turnstile', message: 'Please complete the spam check.', focus: 'turnstile-box' });
      if (errors.length) {
        errors.forEach(function (er) { setError(form, er.field, er.message); });
        showSummary(form, errors);
        var first = $(errors[0].focus || errors[0].field);
        if (first && first.focus) first.focus();
        return;
      }

      if (values.website) { showStatus('error', 'Your request was NOT sent because it looked like automated spam.'); return; } /* honeypot tripped */

      busy = true;
      form.setAttribute('aria-busy', 'true');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

      try {
        var files = opts.getFiles ? opts.getFiles() : [];
        if (files.length) {
          if (submitBtn) submitBtn.textContent = 'Preparing photos…';
          try { files = await preparePhotos(files); }
          catch (pe) { if (window.console) console.error('MapFixPro photo processing failed:', pe); throw new Error('photo-processing'); }
          if (submitBtn) submitBtn.textContent = 'Sending…';
        }
        var payload = opts.buildPayload(values);
        var result = await send(payload, files);
        opts.onSuccess(form, payload, result);
      } catch (err) {
        if (err && err.name === 'ServerError' && err.fields) {
          var shown = [];
          Object.keys(err.fields).forEach(function (f) {
            if ($(f + '-error')) { setError(form, f, err.fields[f]); shown.push({ field: f }); }
          });
          if (shown.length) showSummary(form, shown);
        }
        showStatus('error', friendlyFailure(err));
        resetTurnstile();
        if (window.console) console.error('MapFixPro submit failed:', err);
      } finally {
        busy = false;
        form.removeAttribute('aria-busy');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
      }
    });
  }

  function value(form, name) {
    var el = form.elements[name];
    return el ? el.value : '';
  }

  /* =========================================================
     ORDER FORM
     ========================================================= */
  var orderForm = $('order-form');
  if (orderForm) {
    var selectedFiles = [];
    var fileInput = $('photos');
    var fileList = $('photo-list');

    var PACKAGES = { starter: true, standard: true };
    initTurnstile();

    /* prefill from links like request.html?service=hours&package=standard */
    try {
      var qs = new URLSearchParams(window.location.search);
      var svc = qs.get('service');
      var pkg = qs.get('package');
      if (svc && orderForm.elements.service) {
        var opt = orderForm.elements.service.querySelector('option[data-key="' + svc.replace(/[^a-z-]/gi, '') + '"]');
        if (opt) orderForm.elements.service.value = opt.value;
      }
      if (pkg && PACKAGES[pkg]) {
        var radio = orderForm.querySelector('input[name="package"][value="' + pkg + '"]');
        if (radio) radio.checked = true;
      }
    } catch (e) { /* prefill is optional */ }

    var desc = $('description');
    var counter = $('description-count');
    function updateCounter() { if (desc && counter) counter.textContent = desc.value.length + ' / 2000'; }
    if (desc) { desc.addEventListener('input', updateCounter); updateCounter(); }

    function renderFiles() {
      if (!fileList) return;
      fileList.innerHTML = '';
      selectedFiles.forEach(function (f, idx) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = f.name;
        var size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatSize(f.size);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'file-remove';
        btn.textContent = 'Remove';
        btn.setAttribute('aria-label', 'Remove ' + f.name);
        btn.addEventListener('click', function () {
          selectedFiles.splice(idx, 1);
          renderFiles();
          clearError(orderForm, 'photos');
        });
        var meta = document.createElement('span');
        meta.style.display = 'flex'; meta.style.gap = '0.75rem'; meta.style.alignItems = 'center'; meta.style.minWidth = '0';
        meta.appendChild(name); meta.appendChild(size);
        li.appendChild(meta); li.appendChild(btn);
        fileList.appendChild(li);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var problems = [];
        Array.prototype.forEach.call(fileInput.files, function (f) {
          if (ALLOWED_TYPES.indexOf(f.type) === -1) { problems.push('"' + f.name + '" is not a JPG, PNG or WebP image.'); return; }
          if (f.size > MAX_MB * 1024 * 1024) { problems.push('"' + f.name + '" is larger than ' + MAX_MB + ' MB.'); return; }
          if (selectedFiles.length >= MAX_PHOTOS) { problems.push('You can attach up to ' + MAX_PHOTOS + ' photos.'); return; }
          var dup = selectedFiles.some(function (x) { return x.name === f.name && x.size === f.size; });
          if (!dup) selectedFiles.push(f);
        });
        fileInput.value = ''; /* lets the same file be chosen again later */
        renderFiles();
        if (problems.length) setError(orderForm, 'photos', problems.join(' ')); else clearError(orderForm, 'photos');
      });
    }

    function orderCheck(field, v) {
      switch (field) {
        case 'customerName': return V.fullName(v.customerName);
        case 'businessName': return V.businessName(v.businessName);
        case 'email': return V.email(v.email);
        case 'mapsLink': return V.mapsLink(v.mapsLink);
        case 'service': return V.required(v.service, 'Please choose the service you need.');
        case 'package': return V.required(v.package, 'Please choose a request option.');
        case 'description': return V.text(v.description, 20, 2000, 'what you would like changed');
        case 'consent': return v.consent ? '' : 'Please confirm this box so we can proceed.';
        default: return null;
      }
    }

    wire({
      formId: 'order-form',
      fieldCheck: orderCheck,
      collect: function (form) {
        var checked = form.querySelector('input[name="package"]:checked');
        var svcEl = form.elements.service;
        return {
          customerName: value(form, 'customerName'),
          businessName: value(form, 'businessName'),
          email: value(form, 'email'),
          mapsLink: value(form, 'mapsLink'),
          service: svcEl ? svcEl.value : '',
          package: checked ? checked.value : '',
          description: value(form, 'description'),
          consent: !!(form.elements.consent && form.elements.consent.checked),
          website: value(form, 'website')
        };
      },
      validate: function (v) {
        var errors = [];
        var order = [
          ['customerName', 'customerName'], ['businessName', 'businessName'], ['email', 'email'],
          ['mapsLink', 'mapsLink'], ['service', 'service'], ['package', 'package-starter'],
          ['description', 'description'], ['consent', 'consent']
        ];
        order.forEach(function (pair) {
          var msg = orderCheck(pair[0], v);
          if (msg) errors.push({ field: pair[0], message: msg, focus: pair[1] });
        });
        return errors;
      },
      extraErrors: function () {
        var list = [];
        if (selectedFiles.length > MAX_PHOTOS) list.push({ field: 'photos', message: 'You can attach up to ' + MAX_PHOTOS + ' photos.', focus: 'photos' });
        return list;
      },
      getFiles: function () { return selectedFiles.slice(); },
      buildPayload: function (v) {
        return {
          type: 'order',
          startedAt: String(PAGE_LOADED_AT),
          customerName: V.clean(v.customerName),
          businessName: V.clean(v.businessName),
          email: V.clean(v.email).toLowerCase(),
          mapsLink: V.normalizeUrl(v.mapsLink),
          service: v.service,   /* keys; the server maps them to the official labels and prices */
          package: v.package,
          description: V.clean(v.description),
          consent: 'yes',
          website: ''
        };
      },
      onSuccess: function (form, payload, result) {
        var panel = $('success-panel');
        var ref = $('success-ref');
        var mail = $('success-email');
        if (ref) ref.textContent = result.reference;
        if (mail) mail.textContent = payload.email;
        form.hidden = true;
        hideSummary();
        hideStatus();
        if (panel) { panel.hidden = false; panel.focus(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    });

    var again = $('submit-another');
    if (again) {
      again.addEventListener('click', function () {
        orderForm.reset();
        selectedFiles = [];
        renderFiles();
        updateCounter();
        clearAllErrors(orderForm);
        resetTurnstile();
        PAGE_LOADED_AT = Date.now();
        $('success-panel').hidden = true;
        orderForm.hidden = false;
        var first = $('customerName');
        if (first) first.focus();
      });
    }
  }

  /* =========================================================
     CONTACT FORM
     ========================================================= */
  var contactForm = $('contact-form');
  if (contactForm) {
    initTurnstile();

    function contactCheck(field, v) {
      switch (field) {
        case 'contactName': return V.fullName(v.name);
        case 'contactEmail': return V.email(v.email);
        case 'contactSubject': return V.required(v.subject, 'Please choose a topic.');
        case 'contactMessage': return V.text(v.message, 10, 2000, 'your message');
        default: return null;
      }
    }

    wire({
      formId: 'contact-form',
      fieldCheck: contactCheck,
      collect: function (form) {
        return {
          name: value(form, 'contactName'),
          email: value(form, 'contactEmail'),
          subject: value(form, 'contactSubject'),
          message: value(form, 'contactMessage'),
          website: value(form, 'website')
        };
      },
      validate: function (v) {
        var errors = [];
        [['contactName', 'contactName'], ['contactEmail', 'contactEmail'], ['contactSubject', 'contactSubject'], ['contactMessage', 'contactMessage']]
          .forEach(function (pair) {
            var msg = contactCheck(pair[0], v);
            if (msg) errors.push({ field: pair[0], message: msg, focus: pair[1] });
          });
        return errors;
      },
      getFiles: function () { return []; },
      buildPayload: function (v) {
        return {
          type: 'contact',
          startedAt: String(PAGE_LOADED_AT),
          name: V.clean(v.name),
          email: V.clean(v.email).toLowerCase(),
          subject: v.subject,   /* key; the server maps it to the topic label */
          message: V.clean(v.message),
          website: ''
        };
      },
      onSuccess: function (form, payload, result) {
        var panel = $('success-panel');
        var ref = $('success-ref');
        if (ref) ref.textContent = result.reference;
        form.hidden = true;
        hideSummary();
        hideStatus();
        if (panel) { panel.hidden = false; panel.focus(); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    });
  }
})();
