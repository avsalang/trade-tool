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
const TRADE_SANKEY_LIMITS = [25, 50, 100];
const TRADE_SANKEY_NODE_LIMIT = 8;
const TRADE_SANKEY_LINK_LIMIT = 32;

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

function buildTradeSankeyResiduals(validBilateral, topRoutes) {
  const residuals = {};
  TRADE_SANKEY_LIMITS.forEach((limit) => {
    const candidateRoutes = topRoutes.slice(0, limit);
    const candidateSupplierTotals = new Map();
    const candidateImporterTotals = new Map();
    candidateRoutes.forEach((route) => {
      candidateSupplierTotals.set(
        route.exporterIndex,
        (candidateSupplierTotals.get(route.exporterIndex) || 0) + route.value,
      );
      candidateImporterTotals.set(
        route.importerIndex,
        (candidateImporterTotals.get(route.importerIndex) || 0) + route.value,
      );
    });
    const leading = (totals) =>
      [...totals.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, TRADE_SANKEY_NODE_LIMIT)
        .map(([economyIndex]) => economyIndex);
    const leadingSuppliers = new Set(leading(candidateSupplierTotals));
    const leadingImporters = new Set(leading(candidateImporterTotals));
    const namedRoutes = candidateRoutes
      .filter(
        (route) =>
          leadingSuppliers.has(route.exporterIndex) &&
          leadingImporters.has(route.importerIndex),
      )
      .slice(0, TRADE_SANKEY_LINK_LIMIT);
    const namedKeys = new Set(
      namedRoutes.map((route) => `${route.exporterIndex}|${route.importerIndex}`),
    );
    const supplierResiduals = new Map();
    let otherSupplierResidual = 0;
    validBilateral.forEach((route) => {
      if (namedKeys.has(`${route.exporterIndex}|${route.importerIndex}`)) return;
      if (leadingSuppliers.has(route.exporterIndex)) {
        supplierResiduals.set(
          route.exporterIndex,
          (supplierResiduals.get(route.exporterIndex) || 0) + route.value,
        );
      } else {
        otherSupplierResidual += route.value;
      }
    });
    const rows = [...supplierResiduals.entries()].filter(([, value]) => value > 0);
    if (otherSupplierResidual > 0) rows.push([-1, otherSupplierResidual]);
    residuals[limit] = rows;
  });
  return residuals;
}

function buildSnapshot(
  productIndex,
  yearIndex,
  records,
  worldIndex,
  economies,
  reportingSide = "importer-reported",
) {
  const worldByReporter = new Map();
  const bilateral = [];

  records.forEach((record) => {
    const [, reporterIndex, partnerIndex, values] = record;
    const value = finiteValue(values[yearIndex]);
    if (value === null) return;
    if (partnerIndex === worldIndex) worldByReporter.set(reporterIndex, value);
    else if (value > 0) {
      bilateral.push({
        reporterIndex,
        partnerIndex,
        importerIndex:
          reportingSide === "exporter-reported" ? partnerIndex : reporterIndex,
        exporterIndex:
          reportingSide === "exporter-reported" ? reporterIndex : partnerIndex,
        value,
      });
    }
  });

  const validBilateral = bilateral.filter((row) =>
    worldByReporter.has(row.reporterIndex),
  );
  const totalReported = [...worldByReporter.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const totalBilateral = validBilateral.reduce(
    (sum, row) => sum + row.value,
    0,
  );
  const partnerTotals = new Map();
  const partnersByReporter = new Map();
  const originTotals = new Map();

  validBilateral.forEach((row) => {
    partnerTotals.set(
      row.partnerIndex,
      (partnerTotals.get(row.partnerIndex) || 0) + row.value,
    );
    originTotals.set(
      row.exporterIndex,
      (originTotals.get(row.exporterIndex) || 0) + row.value,
    );
    const rows = partnersByReporter.get(row.reporterIndex) || [];
    rows.push(row);
    partnersByReporter.set(row.reporterIndex, rows);
  });

  const reporterTotals = [...worldByReporter.entries()].filter(
    ([, value]) => value > 0,
  );
  const reporters = reporterTotals
    .map(([economyIndex, value]) => [
      economyIndex,
      value,
      totalReported ? value / totalReported : 0,
    ])
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10);
  const partners = [...partnerTotals.entries()]
    .map(([economyIndex, value]) => [
      economyIndex,
      value,
      totalBilateral ? value / totalBilateral : 0,
    ])
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10);
  const overallHhi = [...partnerTotals.values()].reduce((sum, value) => {
    const share = totalBilateral ? value / totalBilateral : 0;
    return sum + share ** 2 * 10_000;
  }, 0);
  const reporterHhi = reporterTotals
    .map(([reporterIndex, reporterValue]) => {
      const partnerRows = partnersByReporter.get(reporterIndex) || [];
      const hhi = partnerRows.reduce(
        (sum, row) => sum + (row.value / reporterValue) ** 2 * 10_000,
        0,
      );
      const leading = [...partnerRows].sort(
        (left, right) => right.value - left.value,
      )[0];
      return [
        reporterIndex,
        hhi,
        leading?.partnerIndex ?? null,
        leading?.value || 0,
      ];
    })
    .sort((left, right) => right[1] - left[1]);

  const topRoutes = [...validBilateral]
    .sort((left, right) => right.value - left.value)
    .slice(0, TOP_ROUTE_LIMIT);
  const mapSupplierIndexes = new Set(
    topRoutes.map((route) => route.exporterIndex),
  );
  const mapSupplierTotals = [...originTotals.entries()].filter(
    ([economyIndex]) => mapSupplierIndexes.has(economyIndex),
  );
  const sankeyResiduals = buildTradeSankeyResiduals(
    validBilateral,
    topRoutes,
  );

  return {
    summary: {
      reportingSide,
      totalReported,
      totalBilateral,
      reporterCount: worldByReporter.size,
      overallHhi,
      reporterTotals,
      partnerTotals: [...partnerTotals.entries()],
      reporterRanking: reporters,
      partnerRanking: partners,
      reporterHhi,
      mapSupplierTotals,
      sankeyResiduals,
    },
    topRoutes,
  };
}

function buildTrendSummaries(productRecords, years, worldIndex, reportingSide) {
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
      const comparableReporters = new Set(
        comparableRecords.map((record) => record[1]),
      );
      const partnerSharesByYear = new Map();
      const series = selectedYears.map((year, offset) => {
        const yearIndex = yearIndexes[offset];
        const value = comparableRecords.reduce(
          (sum, record) => sum + (record[3][yearIndex] || 0),
          0,
        );
        const partnerTotals = new Map();
        bilateralRecords.forEach((record) => {
          const [, reporterIndex, partnerIndex, values] = record;
          if (!comparableReporters.has(reporterIndex)) return;
          const partnerValue = finiteValue(values[yearIndex]);
          if (partnerValue === null || partnerValue <= 0) return;
          partnerTotals.set(
            partnerIndex,
            (partnerTotals.get(partnerIndex) || 0) + partnerValue,
          );
        });
        const partnerTotal = [...partnerTotals.values()].reduce(
          (sum, partnerValue) => sum + partnerValue,
          0,
        );
        const shares = new Map(
          [...partnerTotals.entries()].map(([partnerIndex, partnerValue]) => [
            partnerIndex,
            partnerTotal ? partnerValue / partnerTotal : 0,
          ]),
        );
        partnerSharesByYear.set(year, shares);
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

      const startShares = partnerSharesByYear.get(selectedYears[0]) || new Map();
      const endShares =
        partnerSharesByYear.get(selectedYears.at(-1)) || new Map();
      const leadingPartnerIndexes = [
        ...new Set([...startShares.keys(), ...endShares.keys()]),
      ]
        .sort(
          (left, right) =>
            Math.max(endShares.get(right) || 0, startShares.get(right) || 0) -
            Math.max(endShares.get(left) || 0, startShares.get(left) || 0),
        )
        .slice(0, 5);
      const partnerShareChanges = leadingPartnerIndexes.map(
        (partnerIndex) => ({
          key: partnerIndex,
          startShare: startShares.get(partnerIndex) || 0,
          endShare: endShares.get(partnerIndex) || 0,
        }),
      );
      if (leadingPartnerIndexes.length) {
        partnerShareChanges.push({
          key: "other",
          startShare: Math.max(
            0,
            1 -
              leadingPartnerIndexes.reduce(
                (sum, partnerIndex) =>
                  sum + (startShares.get(partnerIndex) || 0),
                0,
              ),
          ),
          endShare: Math.max(
            0,
            1 -
              leadingPartnerIndexes.reduce(
                (sum, partnerIndex) =>
                  sum + (endShares.get(partnerIndex) || 0),
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
        reportingSide,
        comparableCount: comparableRecords.length,
        startReporterCount: reporterCount(startIndex),
        endReporterCount: reporterCount(endIndex),
        endGrowth: series.at(-1).growth,
        cagr:
          startValue > 0 && intervals > 0
            ? (endValue / startValue) ** (1 / intervals) - 1
            : null,
        hhiChange: series.at(-1).hhi - series[0].hhi,
        partnerShareChanges,
      };
    }
  }

  return summaries;
}

function buildPublicTradeView(source, reportingSide) {
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
        reportingSide,
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
      reportingSide,
    );
  });

  const records = [...publicRecordMap.values()].sort(
    (left, right) =>
      left[0] - right[0] || left[1] - right[1] || left[2] - right[2],
  );
  return {
    reportingSide,
    sourceMode: source.meta.sourceMode,
    records,
    snapshotSummaries,
    trendSummaries,
  };
}

function buildPublicTradeDataset(importSource, exportSource) {
  const importView = buildPublicTradeView(importSource, "importer-reported");
  const exportView = buildPublicTradeView(exportSource, "exporter-reported");
  return {
    meta: {
      title: importSource.meta.title,
      source: "UN Comtrade",
      sourceMode: "Reporter-reported annual imports or exports, kept as separate views",
      unit: importSource.meta.unit,
      startYear: importSource.meta.startYear,
      endYear: importSource.meta.endYear,
      productCount: importSource.products.length,
      publication: {
        type: "aggregated dashboard extract",
        topBilateralRoutesPerProductYear: TOP_ROUTE_LIMIT,
        exactIndicatorsRetained: true,
        underlyingObservationRowsIncluded: false,
        note:
          "Exact dashboard indicators are precomputed. Only leading bilateral routes are included for the interactive map and route views.",
      },
    },
    years: importSource.years,
    products: importSource.products,
    economies: importSource.economies,
    reportingViews: {
      imports: importView,
      exports: exportView,
    },
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
const tradeExportSource = await loadJson(
  path.join(privateDirectory, "trade-flows-comtrade-exports.full.json"),
);
const stageSource = await loadJson(
  path.join(privateDirectory, "comtrade-ev-bilateral.full.json"),
);
const publicTrade = buildPublicTradeDataset(tradeSource, tradeExportSource);
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
  `Public trade extract: ${Object.values(publicTrade.reportingViews)
    .reduce((sum, view) => sum + view.records.length, 0)
    .toLocaleString()} route records across import and export views`,
);
for (const [year, data] of Object.entries(publicStage.datasets)) {
  console.log(
    `Public EV Sankey ${year}: ${data.links.length.toLocaleString()} stage links`,
  );
}
