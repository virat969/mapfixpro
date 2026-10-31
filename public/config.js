/* ==========================================================
   MapFixPro — site configuration
   Edit this file after you deploy. It contains NO secrets:
   everything here is visible to anyone who opens the site.
   Never put passwords, app passwords or API secret keys in this file.
   Email credentials live ONLY in Netlify environment variables (see README.md).
   ========================================================== */
window.MAPFIXPRO_CONFIG = {
  /* Where order and contact submissions are sent. This is the Netlify Function
     included in the project (netlify/functions/submit.mjs). Do not change it unless you
     moved the backend. */
  ORDER_ENDPOINT: "/api/submit",

  /* Shown on Contact / Privacy / Terms pages and in error messages when filled in. */
  CONTACT_EMAIL: "",
  LEGAL_NAME: "MapFixPro",
  BUSINESS_ADDRESS: "",
  GOVERNING_STATE: "",

  /* Optional spam check (Cloudflare Turnstile). Paste the PUBLIC "site key" here and set the
     matching secret in Netlify as TURNSTILE_SECRET_KEY. Leave empty to keep it switched off. */
  TURNSTILE_SITE_KEY: "",

  /* Photo limits. Each photo may be up to MAX_PHOTO_MB when selected. Before sending, large
     photos are resized in the browser so that all photos together fit in UPLOAD_BUDGET_MB
     (Netlify Functions accept about 6 MB per request). */
  MAX_PHOTOS: 4,
  MAX_PHOTO_MB: 4,
  UPLOAD_BUDGET_MB: 3.5,

  /* How long to wait for the server before showing an error. */
  REQUEST_TIMEOUT_MS: 60000
};
