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
  const text = await readFile(path.join(publicDataDirectory, fileName), "utf8");
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
if (!trade.reportingViews?.imports || !trade.reportingViews?.exports) {
  throw new Error("Both reported-import and reported-export views are required.");
}

let activeTradeValues = 0;
let summariesChecked = 0;
for (const [mode, view] of Object.entries(trade.reportingViews)) {
  if (!Array.isArray(view.records) || !Array.isArray(view.snapshotSummaries)) {
    throw new Error(`${mode} view is incomplete.`);
  }
  view.records.forEach((record) => {
    if (!Array.isArray(record) || record.length !== 4 || record[3].length !== trade.years.length) {
      throw new Error(`${mode} view contains an invalid route record.`);
    }
    activeTradeValues += record[3].filter(Number.isFinite).length;
  });
  view.snapshotSummaries.forEach((productSummaries) => {
    if (productSummaries.length !== trade.years.length) {
      throw new Error(`${mode} view contains an incomplete product time series.`);
    }
    productSummaries.forEach((summary) => {
      if (!summary) return;
      if (
        !Number.isFinite(summary.totalReported) ||
        !Number.isFinite(summary.totalBilateral) ||
        !Array.isArray(summary.reporterTotals) ||
        !Array.isArray(summary.partnerTotals) ||
        !Array.isArray(summary.reporterHhi)
      ) {
        throw new Error(`${mode} view contains an invalid snapshot summary.`);
      }
      summariesChecked += 1;
    });
  });
}

const stagePath = path.join(publicDataDirectory, "comtrade-ev-bilateral.json");
const stage = JSON.parse(await readFile(stagePath, "utf8"));
let activeStageValues = 0;
for (const [year, data] of Object.entries(stage.datasets)) {
  if (data.metadata?.publication?.underlyingBilateralLinksIncluded !== false) {
    throw new Error(`${year} EV data is not marked as an aggregated extract.`);
  }
  if (data.links.length > 2_000) {
    throw new Error(`${year} EV extract contains too many links: ${data.links.length}.`);
  }
  activeStageValues += data.links.length + (data.scopeLinks?.length || 0);
}

const publicRecordCount = activeTradeValues + activeStageValues;
if (publicRecordCount > 100_000) {
  throw new Error(
    `Public extracts expose ${publicRecordCount.toLocaleString()} records; limit is 100,000.`,
  );
}

const tradeBytes = (await stat(tradePath)).size;
const stageBytes = (await stat(stagePath)).size;
if (tradeBytes > 20_000_000) throw new Error("Public trade data exceeds 20 MB.");
if (stageBytes > 2_000_000) throw new Error("Public EV data exceeds 2 MB.");

console.log("Public release audit passed.");
console.log(`Trade routes exposed: ${activeTradeValues.toLocaleString()} active values`);
console.log(`All public records: ${publicRecordCount.toLocaleString()} of 100,000`);
console.log(`Trade summaries checked: ${summariesChecked.toLocaleString()}`);
console.log(`Trade data size: ${(tradeBytes / 1_000_000).toFixed(2)} MB`);
console.log(`EV Sankey data size: ${(stageBytes / 1_000_000).toFixed(2)} MB`);
