/**
 * Branding — the ONLY place the product's name lives in the browser app.
 * Change it here (or set VITE_BRAND_* in frontend/.env and rebuild).
 * The server has its own copy in backend/src/brand.js; keep the two in step.
 */
const env = (value, fallback) => (typeof value === "string" && value.trim()) || fallback;

export const BRAND = {
  // Window title, sign-in screens, desktop pop-ups.
  appName: env(import.meta.env.VITE_BRAND_APP_NAME, "EDMO Collab Dashboard"),
  // Short name: the dashboard heading, the default accent colour's name.
  shortName: env(import.meta.env.VITE_BRAND_SHORT_NAME, "EDMO"),
  // Heading on the dashboard.
  dashboardTitle: env(import.meta.env.VITE_BRAND_DASHBOARD_TITLE, "EDMO Collab Dashboard"),
  // Everything this app keeps in the browser uses its own "edmo." / "edmo_"
  // keys (sign-in, theme, layout) — different from PMDAMC's on purpose, so
  // the two apps never share a sign-in when run on the same computer.
};
