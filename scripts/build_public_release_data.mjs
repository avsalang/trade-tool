import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const privateDirectory = path.join(
  projectDirectory,
  "data",
  "private-publication-source",
);
const publicDirectory = path.join(projectDirectory, "public", "data");
const TOP_ROUTE_LIMIT = 100;
const STAGE_LEADER_LIMIT = 3;

function finiteValue(value) {
  return Number.isFinite(value) ? value : null;
}

function topEntries(totals, countries, limit = STAGE_LEADER_LIMIT) {
  return [...totals.entries()]
    .filter(([index, value]) => value > 0 && !countries[index]?.special)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([index]) => index);
}

function buildSnapshot(productIndex, yearIndex, records, worldIndex, economies) {
  const worldByImporter = new Map();
  const bilateral = [];

  records.forEach((record) => {
    const [, importerIndex, exporterIndex, values] = record;
    const value = finiteValue(values[yearIndex]);
    if (value === null) return;
    if (exporterIndex === worldIndex) worldByImporter.set(importerIndex, value);
    else if (value > 0) bilateral.push({ importerIndex, exporterIndex, value });
  });

  const validBilateral = bilateral.filter((row) =>
    worldByImporter.has(row.importerIndex),
  );
  const totalImported = [...worldByImporter.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const totalExported = validBilateral.reduce(
    (sum, row) => sum + row.value,
    0,
  );
  const supplierTotals = new Map();
  const partnersByImporter = new Map();

  validBilateral.forEach((row) => {
    supplierTotals.set(
      row.exporterIndex,
      (supplierTotals.get(row.exporterIndex) || 0) + row.value,
    );
    const rows = partnersByImporter.get(row.importerIndex) || [];
    rows.push(row);
    partnersByImporter.set(row.importerIndex, rows);
  });

  const importerTotals = [...worldByImporter.entries()].filter(
    ([, value]) => value > 0,
  );
  const importers = importerTotals
    .map(([economyIndex, value]) => [
      economyIndex,
      value,
      totalImported ? value / totalImported : 0,
    ])
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10);
  const suppliers = [...supplierTotals.entries()]
    .map(([economyIndex, value]) => [
      economyIndex,
      value,
      totalExported ? value / totalExported : 0,
    ])
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10);
  const overallHhi = [...supplierTotals.values()].reduce((sum, value) => {
    const share = totalExported ? value / totalExported : 0;
    return sum + share ** 2 * 10_000;
  }, 0);
  const importerHhi = importerTotals
    .map(([importerIndex, importerValue]) => {
      const partnerRows = partnersByImporter.get(importerIndex) || [];
      const hhi = partnerRows.reduce(
        (sum, row) => sum + (row.value / importerValue) ** 2 * 10_000,
        0,
      );
      const leading = [...partnerRows].sort(
        (left, right) => right.value - left.value,
      )[0];
      return [importerIndex, hhi, leading?.exporterIndex ?? null];
    })
    .sort((left, right) => right[1] - left[1]);

  const topRoutes = [...validBilateral]
    .sort((left, right) => right.value - left.value)
    .slice(0, TOP_ROUTE_LIMIT);

  return {
    summary: {
      totalImported,
      totalExported,
      reporters: worldByImporter.size,
      overallHhi,
      importerTotals,
      importers,
      suppliers,
      importerHhi,
    },
    topRoutes,
  };
}

function buildTrendSummaries(productRecords, years, worldIndex) {
  const worldRecords = productRecords.filter((record) => record[2] === worldIndex);
  const bilateralRecords = productRecords.filter(
    (record) => record[2] !== worldIndex,
  );
  const summaries = {};

  for (let startIndex = 0; startIndex < years.length - 1; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < years.length; endIndex += 1) {
      const yearIndexes = [];
      for (let index = startIndex; index <= endIndex; index += 1) {
        yearIndexes.push(index);
      }
      const selectedYears = yearIndexes.map((index) => years[index]);
      const comparableRecords = worldRecords.filter((record) =>
        yearIndexes.every((index) => finiteValue(record[3][index]) !== null),
      );
      const comparableImporters = new Set(
        comparableRecords.map((record) => record[1]),
      );
      const supplierSharesByYear = new Map();
      const series = selectedYears.map((year, offset) => {
        const yearIndex = yearIndexes[offset];
        const value = comparableRecords.reduce(
          (sum, record) => sum + (record[3][yearIndex] || 0),
          0,
        );
        const supplierTotals = new Map();
        bilateralRecords.forEach((record) => {
          const [, importerIndex, supplierIndex, values] = record;
          if (!comparableImporters.has(importerIndex)) return;
          const supplierValue = finiteValue(values[yearIndex]);
          if (supplierValue === null || supplierValue <= 0) return;
          supplierTotals.set(
            supplierIndex,
            (supplierTotals.get(supplierIndex) || 0) + supplierValue,
          );
        });
        const supplierTotal = [...supplierTotals.values()].reduce(
          (sum, supplierValue) => sum + supplierValue,
          0,
        );
        const shares = new Map(
          [...supplierTotals.entries()].map(([supplierIndex, supplierValue]) => [
            supplierIndex,
            supplierTotal ? supplierValue / supplierTotal : 0,
          ]),
        );
        supplierSharesByYear.set(year, shares);
        const hhi = [...shares.values()].reduce(
          (sum, share) => sum + share ** 2 * 10_000,
          0,
        );
        return { year, value, growth: null, hhi };
      });

      series.forEach((point, index) => {
        if (!index) return;
        const priorValue = series[index - 1].value;
        point.growth = priorValue ? point.value / priorValue - 1 : null;
      });

      const startShares = supplierSharesByYear.get(selectedYears[0]) || new Map();
      const endShares =
        supplierSharesByYear.get(selectedYears.at(-1)) || new Map();
      const leadingSupplierIndexes = [
        ...new Set([...startShares.keys(), ...endShares.keys()]),
      ]
        .sort(
          (left, right) =>
            Math.max(endShares.get(right) || 0, startShares.get(right) || 0) -
            Math.max(endShares.get(left) || 0, startShares.get(left) || 0),
        )
        .slice(0, 5);
      const supplierShareChanges = leadingSupplierIndexes.map(
        (supplierIndex) => ({
          key: supplierIndex,
          startShare: startShares.get(supplierIndex) || 0,
          endShare: endShares.get(supplierIndex) || 0,
        }),
      );
      if (leadingSupplierIndexes.length) {
        supplierShareChanges.push({
          key: "other",
          startShare: Math.max(
            0,
            1 -
              leadingSupplierIndexes.reduce(
                (sum, supplierIndex) =>
                  sum + (startShares.get(supplierIndex) || 0),
                0,
              ),
          ),
          endShare: Math.max(
            0,
            1 -
              leadingSupplierIndexes.reduce(
                (sum, supplierIndex) =>
                  sum + (endShares.get(supplierIndex) || 0),
                0,
              ),
          ),
        });
      }

      const startValue = series[0].value;
      const endValue = series.at(-1).value;
      const intervals = selectedYears.at(-1) - selectedYears[0];
      const reporterCount = (yearIndex) =>
        worldRecords.filter(
          (record) => finiteValue(record[3][yearIndex]) !== null,
        ).length;

      summaries[`${selectedYears[0]}-${selectedYears.at(-1)}`] = {
        series,
        comparableCount: comparableRecords.length,
        startReporterCount: reporterCount(startIndex),
        endReporterCount: reporterCount(endIndex),
        endGrowth: series.at(-1).growth,
        cagr:
          startValue > 0 && intervals > 0
            ? (endValue / startValue) ** (1 / intervals) - 1
            : null,
        hhiChange: series.at(-1).hhi - series[0].hhi,
        supplierShareChanges,
      };
    }
  }

  return summaries;
}

function buildPublicTradeDataset(source) {
  const worldIndex = source.economies.findIndex(
    (economy) => economy.name === "World",
  );
  if (worldIndex < 0) throw new Error("The trade dataset has no World economy.");

  const recordsByProduct = source.products.map(() => []);
  source.records.forEach((record) => recordsByProduct[record[0]].push(record));
  const snapshotSummaries = source.products.map(() => []);
  const trendSummaries = source.products.map(() => ({}));
  const publicRecordMap = new Map();

  recordsByProduct.forEach((productRecords, productIndex) => {
    source.years.forEach((year, yearIndex) => {
      const { summary, topRoutes } = buildSnapshot(
        productIndex,
        yearIndex,
        productRecords,
        worldIndex,
        source.economies,
      );
      snapshotSummaries[productIndex][yearIndex] = summary;
      topRoutes.forEach((route) => {
        const key = `${productIndex}|${route.importerIndex}|${route.exporterIndex}`;
        let record = publicRecordMap.get(key);
        if (!record) {
          record = [
            productIndex,
            route.importerIndex,
            route.exporterIndex,
            source.years.map(() => null),
          ];
          publicRecordMap.set(key, record);
        }
        record[3][yearIndex] = route.value;
      });
    });
    trendSummaries[productIndex] = buildTrendSummaries(
      productRecords,
      source.years,
      worldIndex,
    );
  });

  const records = [...publicRecordMap.values()].sort(
    (left, right) =>
      left[0] - right[0] || left[1] - right[1] || left[2] - right[2],
  );
  return {
    meta: {
      title: source.meta.title,
      source: "UN Comtrade",
      sourceMode: source.meta.sourceMode,
      unit: source.meta.unit,
      startYear: source.meta.startYear,
      endYear: source.meta.endYear,
      productCount: source.products.length,
      publication: {
        type: "aggregated dashboard extract",
        topBilateralRoutesPerProductYear: TOP_ROUTE_LIMIT,
        exactIndicatorsRetained: true,
        underlyingObservationRowsIncluded: false,
        note:
          "Exact dashboard indicators are precomputed. Only leading bilateral routes are included for the interactive map and route views.",
      },
    },
    years: source.years,
    products: source.products,
    economies: source.economies,
    records,
    snapshotSummaries,
    trendSummaries,
  };
}

function reducedStageLinks(data, otherIndex) {
  const output = [];
  const groups = new Map();
  data.links.forEach((link) => {
    if (!Number.isFinite(link[5]) || link[5] <= 0) return;
    const key = `${link[0]}|${link[1]}|${link[2]}`;
    const rows = groups.get(key) || [];
    rows.push(link);
    groups.set(key, rows);
  });

  groups.forEach((rows) => {
    const [reportingSide, stage, materialIndex] = rows[0];
    const exporterTotals = new Map();
    rows.forEach((link) => {
      exporterTotals.set(link[3], (exporterTotals.get(link[3]) || 0) + link[5]);
    });
    const leadingExporters = topEntries(exporterTotals, data.countries);
    const leadingSet = new Set(leadingExporters);
    let otherExporterValue = 0;

    rows.forEach((link) => {
      if (!leadingSet.has(link[3])) otherExporterValue += link[5];
    });
    if (otherExporterValue > 0) {
      output.push([
        reportingSide,
        stage,
        materialIndex,
        otherIndex,
        otherIndex,
        otherExporterValue,
      ]);
    }

    leadingExporters.forEach((exporterIndex) => {
      const destinationTotals = new Map();
      rows.forEach((link) => {
        if (link[3] !== exporterIndex) return;
        destinationTotals.set(
          link[4],
          (destinationTotals.get(link[4]) || 0) + link[5],
        );
      });
      const leadingDestinations = topEntries(
        destinationTotals,
        data.countries,
      );
      const destinationSet = new Set(leadingDestinations);
      let residual = 0;
      destinationTotals.forEach((value, importerIndex) => {
        if (destinationSet.has(importerIndex)) {
          output.push([
            reportingSide,
            stage,
            materialIndex,
            exporterIndex,
            importerIndex,
            value,
          ]);
        } else residual += value;
      });
      if (residual > 0) {
        output.push([
          reportingSide,
          stage,
          materialIndex,
          exporterIndex,
          otherIndex,
          residual,
        ]);
      }
    });
  });
  return output;
}

function reducedScopeLinks(data, otherIndex) {
  const output = [];
  const groups = new Map();
  (data.scopeLinks || []).forEach((link) => {
    if (!Number.isFinite(link[3]) || link[3] <= 0) return;
    const key = `${link[0]}|${link[1]}`;
    const totals = groups.get(key) || new Map();
    totals.set(link[2], (totals.get(link[2]) || 0) + link[3]);
    groups.set(key, totals);
  });
  groups.forEach((totals, key) => {
    const [reportingSide, groupIndex] = key.split("|").map(Number);
    const leaders = topEntries(totals, data.countries);
    const leaderSet = new Set(leaders);
    let residual = 0;
    totals.forEach((value, exporterIndex) => {
      if (leaderSet.has(exporterIndex)) {
        output.push([reportingSide, groupIndex, exporterIndex, value]);
      } else residual += value;
    });
    if (residual > 0) {
      output.push([reportingSide, groupIndex, otherIndex, residual]);
    }
  });
  return output;
}

function buildPublicStageDataset(source) {
  const datasets = {};
  Object.entries(source.datasets).forEach(([year, data]) => {
    const countries = [...data.countries];
    const otherIndex = countries.length;
    countries.push({
      key: "publication-other-economies",
      code: null,
      iso3: null,
      m49: null,
      name: "Other economies",
      region: "Aggregated",
      special: true,
      mapped: false,
    });
    const publicationData = { ...data, countries };
    const links = reducedStageLinks(publicationData, otherIndex);
    const scopeLinks = reducedScopeLinks(publicationData, otherIndex);
    datasets[year] = {
      metadata: {
        title: data.metadata.title,
        year: data.year,
        source: "UN Comtrade",
        sourceMode: data.metadata.sourceMode,
        classification: data.metadata.classification,
        unit: data.metadata.unit,
        publication: {
          type: "aggregated Sankey extract",
          leadingExportersPerStage: STAGE_LEADER_LIMIT,
          leadingDestinationsPerExporter: STAGE_LEADER_LIMIT,
          residualEconomiesAggregated: true,
          underlyingBilateralLinksIncluded: false,
        },
      },
      year: data.year,
      reportingSides: data.reportingSides,
      materials: data.materials,
      countries,
      products: data.products,
      links,
      scopeGroups: data.scopeGroups,
      scopeLinks,
    };
  });
  return {
    metadata: {
      title: source.metadata.title,
      source: "UN Comtrade",
      years: source.years,
      publication: {
        type: "aggregated Sankey extract",
        underlyingBilateralLinksIncluded: false,
      },
    },
    years: source.years,
    datasets,
  };
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

await mkdir(publicDirectory, { recursive: true });
const tradeSource = await loadJson(
  path.join(privateDirectory, "trade-flows-comtrade.full.json"),
);
const stageSource = await loadJson(
  path.join(privateDirectory, "comtrade-ev-bilateral.full.json"),
);
const publicTrade = buildPublicTradeDataset(tradeSource);
const publicStage = buildPublicStageDataset(stageSource);

await writeFile(
  path.join(publicDirectory, "trade-flows-comtrade.json"),
  JSON.stringify(publicTrade),
);
await writeFile(
  path.join(publicDirectory, "comtrade-ev-bilateral.json"),
  JSON.stringify(publicStage),
);

console.log(
  `Public trade extract: ${publicTrade.records.length.toLocaleString()} route records`,
);
for (const [year, data] of Object.entries(publicStage.datasets)) {
  console.log(
    `Public EV Sankey ${year}: ${data.links.length.toLocaleString()} stage links`,
  );
}
