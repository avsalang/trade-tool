import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

const vinextCli = path.join(
  process.cwd(),
  "node_modules",
  "vinext",
  "dist",
  "cli.js",
);
const build = spawnSync(process.execPath, [vinextCli, "build"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (build.status !== 0) {
  if (build.error) console.error(build.error);
  process.exit(build.status || 1);
}

await stat(path.join(process.cwd(), "dist", "server", "index.js"));
console.log("Local production build ready");
