// Writes latest.json (the update manifest the app checks) for the installer
// just built. Run after a signed build:  node scripts/latest-json.mjs
// Upload latest.json, the installer and its .sig to the GitHub release.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const name = `${conf.productName}_${version}_x64-setup.exe`;
const dir = join(root, "src-tauri/target/release/bundle/nsis");

let signature;
try {
  signature = readFileSync(join(dir, `${name}.sig`), "utf8").trim();
} catch {
  console.error(`No ${name}.sig: build with TAURI_SIGNING_PRIVATE_KEY set (see NOTES.md).`);
  process.exit(1);
}

// release notes: this version's section of the changelog
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const start = changelog.indexOf(`## ${version}`);
const rest = start >= 0 ? changelog.slice(start).split("\n").slice(1).join("\n") : "";
// join wrapped continuation lines so the update dialog reflows them
const notes = rest
  .replace(/\r/g, "")
  .split(/\n## /)[0]
  .replace(/\n[ \t]+(?=\S)/g, " ")
  .trim();

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/Inman2004/paperimo/releases/download/desktop-v${version}/${name}`,
    },
  },
};
writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`latest.json for ${version} → ${join(dir, "latest.json")}`);
