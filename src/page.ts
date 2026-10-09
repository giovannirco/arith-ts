// The page at /, read once from web/. Three files, no build step: edit
// web/index.html, web/style.css or web/app.js and restart.

import { readFileSync } from "node:fs";

const WEB = new URL("../web/", import.meta.url);

export const INDEX = readFileSync(new URL("index.html", WEB), "utf8");
export const STYLE = readFileSync(new URL("style.css", WEB), "utf8");
export const SCRIPT = readFileSync(new URL("app.js", WEB), "utf8");

// The page only loads its own stylesheet and script and only talks to this
// origin. The header says so, which turns an injected script into a blocked
// one.
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
