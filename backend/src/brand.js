/**
 * Branding — the ONLY place the organisation's name lives on the server.
 *
 * Everything that prints a name — the Word reports' letterhead, header and
 * file names, every email, the server log — reads it from here. To rename or
 * re-brand, change these values (or set the matching environment variables
 * on the server) and restart; no other file needs touching.
 *
 * The frontend has its own copy of the display names in
 * frontend/src/brand.js; keep the two in step.
 */
const env = (name, fallback) => (process.env[name] && process.env[name].trim()) || fallback;

module.exports = {
  // What the product is called: emails, report metadata, the server log.
  appName: env("BRAND_APP_NAME", "EDMO Collab Dashboard"),
  // The short name: report page headers and downloaded file names.
  shortName: env("BRAND_SHORT_NAME", "EDMO"),
  // The organisation on the report letterhead (printed in capitals) and in
  // email footers. Set the full name here once it's known.
  orgName: env("BRAND_ORG_NAME", "EDMO"),
  // The line printed under it on the letterhead, e.g. the parent ministry.
  // Leave empty and the line is simply omitted.
  orgLine: env("BRAND_ORG_LINE", ""),
};
