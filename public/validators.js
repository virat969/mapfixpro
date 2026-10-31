/* MapFixPro — input validators.
   Every function returns an error message string, or "" when the value is valid. */
(function (global) {
  'use strict';

  var EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  function clean(v) { return (v == null ? '' : String(v)).trim(); }

  function fullName(v) {
    v = clean(v);
    if (!v) return 'Please enter your full name.';
    if (v.length < 2) return 'Your name looks too short.';
    if (v.length > 100) return 'Please keep your name under 100 characters.';
    return '';
  }

  function businessName(v) {
    v = clean(v);
    if (!v) return 'Please enter your business name.';
    if (v.length < 2) return 'The business name looks too short.';
    if (v.length > 150) return 'Please keep the business name under 150 characters.';
    return '';
  }

  function email(v) {
    v = clean(v);
    if (!v) return 'Please enter your email address.';
    if (v.length > 254 || !EMAIL_RE.test(v)) return 'Please enter a valid email address, like name@example.com.';
    var tld = v.split('.').pop();
    if (!/^[A-Za-z]{2,}$/.test(tld)) return 'Please enter a valid email address, like name@example.com.';
    if (/\.\./.test(v)) return 'Please enter a valid email address, like name@example.com.';
    return '';
  }

  /* Adds https:// when someone pastes "maps.app.goo.gl/abc" without a scheme. */
  function normalizeUrl(v) {
    v = clean(v);
    if (!v) return '';
    if (/^http:\/\//i.test(v)) return 'https://' + v.slice(7);
    if (!/^https:\/\//i.test(v) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return 'https://' + v;
    return v;
  }

  var MAPS_HELP = 'Please paste a Google Maps link, for example one starting with https://maps.app.goo.gl/ or https://www.google.com/maps/.';

  function mapsLink(v) {
    var raw = clean(v);
    if (!raw) return 'Please paste the Google Maps link to your business.';
    if (/\s/.test(raw)) return 'The link should not contain spaces. ' + MAPS_HELP;
    var url;
    try { url = new URL(normalizeUrl(raw)); } catch (e) { return MAPS_HELP; }
    if (url.protocol !== 'https:') return MAPS_HELP;

    var host = url.hostname.toLowerCase();
    var path = url.pathname || '/';

    if (host === 'maps.app.goo.gl') return path.length > 1 ? '' : MAPS_HELP;
    if (host === 'goo.gl') return path.indexOf('/maps') === 0 ? '' : MAPS_HELP;
    if (host === 'g.page') return path.length > 1 ? '' : MAPS_HELP;
    if (/^maps\.google\.[a-z.]{2,6}$/.test(host)) return '';
    if (/^(www\.)?google\.[a-z.]{2,6}$/.test(host)) return path.indexOf('/maps') === 0 ? '' : MAPS_HELP;
    return MAPS_HELP;
  }

  function text(v, min, max, label) {
    v = clean(v);
    if (!v) return 'Please fill in ' + label + '.';
    if (v.length < min) return 'Please add a little more detail (at least ' + min + ' characters).';
    if (v.length > max) return 'Please keep this under ' + max + ' characters.';
    return '';
  }

  function required(v, message) { return clean(v) ? '' : message; }

  global.MFPValidate = {
    clean: clean,
    fullName: fullName,
    businessName: businessName,
    email: email,
    mapsLink: mapsLink,
    normalizeUrl: normalizeUrl,
    text: text,
    required: required
  };
})(typeof window !== 'undefined' ? window : globalThis);
