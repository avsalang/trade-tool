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

const SANKEY_LIMITS = [25, 50, 100];
const SANKEY_NODE_LIMIT = 8;
const SANKEY_LINK_LIMIT = 32;
let sankeySnapshotsChecked = 0;
let maximumConservationDifference = 0;
trade.snapshotSummaries.forEach((productSummaries, productIndex) => {
  productSummaries.forEach((summary, yearIndex) => {
    const routes = trade.records
      .filter(
        (record) =>
          record[0] === productIndex && Number.isFinite(record[3][yearIndex]),
      )
      .map((record) => ({
        importerIndex: record[1],
        exporterIndex: record[2],
        value: record[3][yearIndex],
      }))
      .sort((left, right) => right.value - left.value);
    const topRouteSupplierIndexes = new Set(
      routes.map((route) => route.exporterIndex),
    );
    if ((summary.mapSupplierTotals || []).length > 100) {
      throw new Error(
        `Map supplier totals exceed the public route limit for product ${productIndex}, year ${yearIndex}.`,
      );
    }
    const storedMapSupplierIndexes = new Set(
      (summary.mapSupplierTotals || []).map(([economyIndex]) => economyIndex),
    );
    const storedImporterIndexes = new Set(
      (summary.importerTotals || []).map(([economyIndex]) => economyIndex),
    );
    topRouteSupplierIndexes.forEach((economyIndex) => {
      if (!storedMapSupplierIndexes.has(economyIndex)) {
        throw new Error(
          `Missing full supplier total for product ${productIndex}, year ${yearIndex}, economy ${economyIndex}.`,
        );
      }
    });
    routes.forEach((route) => {
      if (!storedImporterIndexes.has(route.importerIndex)) {
        throw new Error(
          `Missing full importer total for product ${productIndex}, year ${yearIndex}, economy ${route.importerIndex}.`,
        );
      }
    });
    (summary.mapSupplierTotals || []).forEach(([economyIndex, value]) => {
      if (!topRouteSupplierIndexes.has(economyIndex) || !Number.isFinite(value)) {
        throw new Error(
          `Invalid map supplier total for product ${productIndex}, year ${yearIndex}.`,
        );
      }
    });

    SANKEY_LIMITS.forEach((limit) => {
      const candidates = routes.slice(0, limit);
      const supplierTotals = new Map();
      const importerTotals = new Map();
      candidates.forEach((route) => {
        supplierTotals.set(
          route.exporterIndex,
          (supplierTotals.get(route.exporterIndex) || 0) + route.value,
        );
        importerTotals.set(
          route.importerIndex,
          (importerTotals.get(route.importerIndex) || 0) + route.value,
        );
      });
      const leading = (totals) =>
        new Set(
          [...totals.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, SANKEY_NODE_LIMIT)
            .map(([economyIndex]) => economyIndex),
        );
      const leadingSuppliers = leading(supplierTotals);
      const leadingImporters = leading(importerTotals);
      const namedValue = candidates
        .filter(
          (route) =>
            leadingSuppliers.has(route.exporterIndex) &&
            leadingImporters.has(route.importerIndex),
        )
        .slice(0, SANKEY_LINK_LIMIT)
        .reduce((sum, route) => sum + route.value, 0);
      const residualRows = summary.sankeyResiduals?.[limit];
      if (!Array.isArray(residualRows) || residualRows.length > 9) {
        throw new Error(
          `Invalid Sankey residual rows for product ${productIndex}, year ${yearIndex}, top ${limit}.`,
        );
      }
      residualRows.forEach(([economyIndex, value]) => {
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          (economyIndex !== -1 && !leadingSuppliers.has(economyIndex))
        ) {
          throw new Error(
            `Invalid Sankey residual entry for product ${productIndex}, year ${yearIndex}, top ${limit}.`,
          );
        }
      });
      const residualValue = residualRows.reduce(
        (sum, [, value]) => sum + value,
        0,
      );
      const difference = Math.abs(
        namedValue + residualValue - summary.totalExported,
      );
      maximumConservationDifference = Math.max(
        maximumConservationDifference,
        difference,
      );
      if (difference > Math.max(1e-6, summary.totalExported * 1e-12)) {
        throw new Error(
          `Sankey totals do not conserve trade value for product ${productIndex}, year ${yearIndex}, top ${limit}: difference ${difference}.`,
        );
      }
      sankeySnapshotsChecked += 1;
    });
  });
});

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
console.log(
  `Sankey aggregates checked: ${sankeySnapshotsChecked.toLocaleString()} views; maximum difference ${maximumConservationDifference}`,
);
console.log(`EV Sankey data size: ${(stageBytes / 1_000_000).toFixed(2)} MB`);
