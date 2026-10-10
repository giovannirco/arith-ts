// The release version, read from package.json, which is where it is written:
// the chart, the image tag and the release tag all carry the same one. It is
// reported as arith_build_info{version=...} and service.version.

import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

export const VERSION = pkg.version;
