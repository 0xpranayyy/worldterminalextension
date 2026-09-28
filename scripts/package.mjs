// Builds the Chrome Web Store zip. Refuses without an invite code unless --dev is passed,
// so a developer build (Pro unlocked for everyone) can't be uploaded by accident.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { CONFIG, normalizeCode } from "../src/config.js";

const dev = process.argv.includes("--dev");
const code = normalizeCode(CONFIG.REFERRAL_CODE);
if (!code && !dev) {
  console.error("REFERRAL_CODE in src/config.js is empty or invalid (8 characters, e.g. AB12CD34).");
  console.error("Without it Pro is unlocked for everyone. Set it, or run `npm run package:dev` for a test build.");
  process.exit(1);
}
const out = dev ? "world-terminal-dev.zip" : "world-terminal.zip";
rmSync(out, { force: true });
execSync(`zip -rq ${out} manifest.json src icons -x '*.DS_Store'`, { stdio: "inherit" });
console.log(`${out} built${code ? ` with invite code ${code}` : " (developer build: Pro unlocked, not for the store)"}.`);
