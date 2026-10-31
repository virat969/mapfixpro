/* MapFixPro — shared site behaviour: mobile menu and config-driven text. */
(function () {
  'use strict';
  var cfg = window.MAPFIXPRO_CONFIG || {};

  /* ----- Mobile menu ----- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  function setOpen(open) {
    if (!toggle || !nav) return;
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setOpen(false);
    });
    var mq = window.matchMedia('(min-width: 900px)');
    var onChange = function (e) { if (e.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ----- Footer year ----- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ----- Config-driven text ----- */
  var email = String(cfg.CONTACT_EMAIL || '').trim();
  Array.prototype.forEach.call(document.querySelectorAll('[data-contact-email]'), function (el) {
    if (!email) return;
    el.textContent = email;
    if (el.tagName === 'A') el.setAttribute('href', 'mailto:' + email);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-needs-email]'), function (el) {
    el.hidden = !email;
  });

  var legal = String(cfg.LEGAL_NAME || '').trim();
  Array.prototype.forEach.call(document.querySelectorAll('[data-legal-name]'), function (el) {
    if (legal) el.textContent = legal;
  });

  var addr = String(cfg.BUSINESS_ADDRESS || '').trim();
  Array.prototype.forEach.call(document.querySelectorAll('[data-business-address]'), function (el) {
    if (addr) el.textContent = addr;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-needs-address]'), function (el) {
    el.hidden = !addr;
  });

  var state = String(cfg.GOVERNING_STATE || '').trim();
  Array.prototype.forEach.call(document.querySelectorAll('[data-governing-state]'), function (el) {
    if (state) el.textContent = state;
  });
})();
