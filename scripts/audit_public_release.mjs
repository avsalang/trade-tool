import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const publicDataDirectory = path.join(projectDirectory, "public", "data");
const allowedFiles = new Set([
  "trade-flows-comtrade.json",
  "comtrade-ev-bilateral.json",
]);
const forbiddenText = [
  /[A-Z]:\\/i,
  /subscription-key/i,
  /COMTRADE_API_KEY/i,
  /sourceDirectory/i,
  /private-publication-source/i,
];

const files = (await readdir(publicDataDirectory)).filter(
  (name) => !name.startsWith("."),
);
const unexpected = files.filter((name) => !allowedFiles.has(name));
if (unexpected.length) {
  throw new Error(`Unexpected public data files: ${unexpected.join(", ")}`);
}
for (const required of allowedFiles) {
  if (!files.includes(required)) throw new Error(`Missing public data file: ${required}`);
}

for (const fileName of files) {
  const filePath = path.join(publicDataDirectory, fileName);
  const text = await readFile(filePath, "utf8");
  forbiddenText.forEach((pattern) => {
    if (pattern.test(text)) {
      throw new Error(`${fileName} contains forbidden release text: ${pattern}`);
    }
  });
}

const tradePath = path.join(publicDataDirectory, "trade-flows-comtrade.json");
const trade = JSON.parse(await readFile(tradePath, "utf8"));
if (trade.meta?.publication?.underlyingObservationRowsIncluded !== false) {
  throw new Error("Trade data is not marked as a reduced publication extract.");
}
const tradeLimit =
  trade.products.length *
  trade.years.length *
  trade.meta.publication.topBilateralRoutesPerProductYear;
const activeTradeValues = trade.records.reduce(
  (sum, record) =>
    sum + record[3].filter((value) => Number.isFinite(value)).length,
  0,
);
if (activeTradeValues > tradeLimit) {
  throw new Error(
    `Trade extract exposes ${activeTradeValues} active routes; limit is ${tradeLimit}.`,
  );
}

const stagePath = path.join(publicDataDirectory, "comtrade-ev-bilateral.json");
const stage = JSON.parse(await readFile(stagePath, "utf8"));
for (const [year, data] of Object.entries(stage.datasets)) {
  if (data.metadata?.publication?.underlyingBilateralLinksIncluded !== false) {
    throw new Error(`${year} EV data is not marked as an aggregated extract.`);
  }
  if (data.links.length > 2_000) {
    throw new Error(`${year} EV extract contains too many links: ${data.links.length}.`);
  }
}

const tradeBytes = (await stat(tradePath)).size;
const stageBytes = (await stat(stagePath)).size;
if (tradeBytes > 8_000_000) throw new Error("Public trade data exceeds 8 MB.");
if (stageBytes > 2_000_000) throw new Error("Public EV data exceeds 2 MB.");

console.log("Public release audit passed.");
console.log(`Trade routes exposed: ${activeTradeValues.toLocaleString()} active values`);
console.log(`Trade data size: ${(tradeBytes / 1_000_000).toFixed(2)} MB`);
console.log(`EV Sankey data size: ${(stageBytes / 1_000_000).toFixed(2)} MB`);
