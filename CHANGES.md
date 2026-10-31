# Changes made

## Fixed
- Removed the "order backend is not connected yet…" notice (request + contact pages). Forms now submit to a real backend.

## Added
- `netlify/functions/submit.mjs`: server-side validation, spam checks, rate limit, saves to Netlify Blobs, emails the owner via Gmail SMTP (photos attached, Reply-To = customer). Dependency-free SMTP client in `netlify/lib/mail.mjs`.
- `netlify/functions/admin.mjs` + `public/admin.html`, `public/js/admin.js`: token-protected, mobile-friendly review page (date, details, photos, email status).
- Optional Cloudflare Turnstile spam check; honeypot, timing, same-site and rate-limit checks.
- Browser-side photo resizing so 4 × 4 MB photos fit Netlify's ~6 MB request limit.
- `netlify.toml`, `package.json`, `.env.example`, `.gitignore`, new README, `dev/` test suite (≈125 checks).
- Request page: "Final price is confirmed before work begins" notice; success message repeats it and states no payment was taken; `<noscript>` notices.

## Changed
- `public/js/forms.js`: posts multipart to `/api/submit`; success only on `{ok:true, reference}`; shows the server's reference number; shows server field errors; keeps answers on failure. Existing validation, prefill links, photo list UI unchanged.
- Service/package are sent as keys; the server maps them to labels and prices ($5 / $10 unchanged).
- `public/js/config.js`: `ORDER_ENDPOINT` defaults to `/api/submit`; added `TURNSTILE_SITE_KEY`, `UPLOAD_BUDGET_MB`; removed `PAYLOAD_FORMAT`.
- `public/_headers`: CSP tightened to this site (removed Google Apps Script/Formspree hosts; allows Turnstile + `blob:` images); `admin.html` noindex/no-store.
- `public/privacy.html`: names Netlify, Gmail, Turnstile; photo storage and IP-hash wording; date updated.
- Site files moved into `public/` so function source/config are not published.

## Kept unchanged
Design, colours, layout, branding, all pages, pricing, Terms of Service, Privacy Policy (extended only), footer disclaimers.

## Moved
- Old Google Apps Script backend and CSV template → `docs/legacy-google-apps-script/` (unused). Old README → `docs/ORIGINAL-README.md`.
