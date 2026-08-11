import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  FilterX,
  Info,
  Maximize2,
  RotateCcw,
  X,
} from "lucide-react";
import { financeExplorerMapStyle } from "./financeExplorerMapStyle";

const BASE_URL = import.meta.env.BASE_URL || "/";
const DEFAULT_PRODUCT = "870380";
const DEFAULT_FLOW_LIMIT = 50;
const DEFAULT_TREND_INTERVALS = 5;
const PRODUCT_SELECTOR_GROUPS = [
  "Minerals and upstream materials",
  "Processed minerals and chemicals",
  "Battery materials",
  "Batteries and components",
  "Electric and hybrid vehicles",
  "General vehicle types",
  "Other transport equipment",
];

function assetUrl(path) {
  return `${BASE_URL}${path.replace(/^\/+/, "")}`;
}

function formatUsdThousand(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(digits)}B`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(digits)}M`;
  }
  return `$${Math.round(value).toLocaleString("en-US")}K`;
}

function formatDetailedUsd(value) {
  if (!Number.isFinite(value)) return "—";
  return `${formatUsdThousand(value, 2)} · ${Math.round(value).toLocaleString("en-US")} US$ thousand`;
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  const amount = (value * 100).toFixed(digits);
  return `${value > 0 ? "+" : ""}${amount}%`;
}

function formatSignedInteger(value) {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`;
}

function formatHhi(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function hhiBand(value) {
  if (!Number.isFinite(value)) {
    return { label: "Not available", tone: "unavailable" };
  }
  if (value < 1000) return { label: "Low concentration", tone: "low" };
  if (value <= 1800) return { label: "Moderate concentration", tone: "medium" };
  return { label: "High concentration", tone: "high" };
}

function isSpecialEconomy(economy) {
  return Boolean(economy?.special || economy?.standard === false);
}

function defaultTrendRange(years, product) {
  const finalYear = Math.max(...years);
  const earliestYear = Math.max(
    Math.min(...years),
    product?.availableFrom || product?.activeFrom || Math.min(...years),
  );
  return {
    start: product?.availableFrom || product?.activeFrom
      ? earliestYear
      : Math.max(earliestYear, finalYear - DEFAULT_TREND_INTERVALS),
    end: finalYear,
  };
}

function longestConsecutiveRange(years) {
  if (!years.length) return null;
  let best = [years[0], years[0]];
  let current = [years[0], years[0]];
  years.slice(1).forEach((year) => {
    if (year === current[1] + 1) current[1] = year;
    else current = [year, year];
    if (current[1] - current[0] > best[1] - best[0]) best = [...current];
  });
  return best;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function canCreateWebGLContext() {
  const canvas = document.createElement("canvas");
  return Boolean(
    canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl"),
  );
}

function hideBoundaryLayers(map) {
  map.getStyle().layers?.forEach((layer) => {
    const id = layer.id.toLowerCase();
    const sourceLayer = (layer["source-layer"] || "").toLowerCase();
    if (
      id.includes("boundary") ||
      id.includes("admin") ||
      id.includes("border") ||
      sourceLayer.includes("boundary")
    ) {
      if (map.getLayer(layer.id)) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    }
  });
}

function greatCircleCoordinates(origin, destination, steps = 28) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const toDegrees = (radians) => (radians * 180) / Math.PI;
  const [originLon, originLat] = origin.map(toRadians);
  const [destinationLon, destinationLat] = destination.map(toRadians);

  const angularDistance = Math.acos(
    Math.min(
      1,
      Math.max(
        -1,
        Math.sin(originLat) * Math.sin(destinationLat) +
          Math.cos(originLat) *
            Math.cos(destinationLat) *
            Math.cos(destinationLon - originLon),
      ),
    ),
  );

  if (!angularDistance) return [origin, destination];

  const coordinates = [];
  let previousLongitude = origin[0];

  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const a =
      Math.sin((1 - fraction) * angularDistance) /
      Math.sin(angularDistance);
    const b =
      Math.sin(fraction * angularDistance) / Math.sin(angularDistance);
    const x =
      a * Math.cos(originLat) * Math.cos(originLon) +
      b * Math.cos(destinationLat) * Math.cos(destinationLon);
    const y =
      a * Math.cos(originLat) * Math.sin(originLon) +
      b * Math.cos(destinationLat) * Math.sin(destinationLon);
    const z = a * Math.sin(originLat) + b * Math.sin(destinationLat);
    const latitude = toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let longitude = toDegrees(Math.atan2(y, x));

    while (longitude - previousLongitude > 180) longitude -= 360;
    while (longitude - previousLongitude < -180) longitude += 360;
    previousLongitude = longitude;
    coordinates.push([longitude, latitude]);
  }

  return coordinates;
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function buildMapPayload(
  flows,
  economies,
  selectedEconomyIndex = null,
  fullNodeTotals = null,
) {
  if (!flows.length) {
    return {
      lines: emptyFeatureCollection(),
      nodes: emptyFeatureCollection(),
      coordinates: [],
    };
  }

  const maximum = Math.max(...flows.map((flow) => flow.value), 1);
  const nodes = new Map();

  const lineFeatures = flows
    .map((flow) => {
      const supplier = economies[flow.supplierIndex];
      const importer = economies[flow.importerIndex];
      if (
        supplier?.lat === null ||
        supplier?.lon === null ||
        importer?.lat === null ||
        importer?.lon === null
      ) {
        return null;
      }

      const supplierCoordinate = [supplier.lon, supplier.lat];
      const importerCoordinate = [importer.lon, importer.lat];
      const supplierNode = nodes.get(flow.supplierIndex) || {
        economyIndex: flow.supplierIndex,
        supplierValue: 0,
        importerValue: 0,
      };
      supplierNode.supplierValue += flow.value;
      nodes.set(flow.supplierIndex, supplierNode);

      const importerNode = nodes.get(flow.importerIndex) || {
        economyIndex: flow.importerIndex,
        supplierValue: 0,
        importerValue: 0,
      };
      importerNode.importerValue += flow.value;
      nodes.set(flow.importerIndex, importerNode);

      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: greatCircleCoordinates(
            supplierCoordinate,
            importerCoordinate,
          ),
        },
        properties: {
          id: flow.id,
          supplierIndex: flow.supplierIndex,
          importerIndex: flow.importerIndex,
          direction:
            selectedEconomyIndex === null
              ? "trade"
              : flow.importerIndex === selectedEconomyIndex
                ? "import"
                : flow.supplierIndex === selectedEconomyIndex
                  ? "export"
                  : "trade",
          supplier: supplier.name,
          importer: importer.name,
          value: flow.value,
          share: flow.share,
          widthScore: Math.sqrt(flow.value / maximum),
        },
      };
    })
    .filter(Boolean);

  const nodeFeatures = [...nodes.values()].map((node) => {
    const economy = economies[node.economyIndex];
    const fullTotals = fullNodeTotals?.get(node.economyIndex);
    const supplierValue = fullTotals?.supplierValue ?? node.supplierValue;
    const importerValue = fullTotals?.importerValue ?? node.importerValue;
    const role =
      supplierValue > 0 && importerValue > 0
        ? "both"
        : supplierValue > 0
          ? "supplier"
          : "importer";
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [economy.lon, economy.lat],
      },
      properties: {
        id: `economy-${node.economyIndex}`,
        economyIndex: node.economyIndex,
        name: economy.name,
        role,
        value: supplierValue + importerValue,
        supplierValue,
        importerValue,
        valueBasis: fullTotals ? "full" : "displayed",
      },
    };
  });

  return {
    lines: { type: "FeatureCollection", features: lineFeatures },
    nodes: { type: "FeatureCollection", features: nodeFeatures },
    coordinates: lineFeatures.length
      ? lineFeatures.flatMap((feature) => feature.geometry.coordinates)
      : nodeFeatures.map((feature) => feature.geometry.coordinates),
  };
}

function syncTradeLayers(map, payload) {
  hideBoundaryLayers(map);

  const lineSource = map.getSource("trade-lines");
  if (lineSource) {
    lineSource.setData(payload.lines);
  } else {
    map.addSource("trade-lines", {
      type: "geojson",
      lineMetrics: true,
      data: payload.lines,
    });
  }

  const nodeSource = map.getSource("trade-nodes");
  if (nodeSource) {
    nodeSource.setData(payload.nodes);
  } else {
    map.addSource("trade-nodes", {
      type: "geojson",
      data: payload.nodes,
    });
  }

  if (!map.getLayer("trade-flow-lines")) {
    map.addLayer({
      id: "trade-flow-lines",
      type: "line",
      source: "trade-lines",
      paint: {
        "line-color": [
          "match",
          ["get", "direction"],
          "import",
          "#2563eb",
          "export",
          "#d97706",
          "#64748b",
        ],
        "line-opacity": 0.42,
        "line-width": [
          "interpolate",
          ["linear"],
          ["get", "widthScore"],
          0,
          0.8,
          1,
          6,
        ],
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    });
  }

  if (!map.getLayer("trade-flow-selected")) {
    map.addLayer({
      id: "trade-flow-selected",
      type: "line",
      source: "trade-lines",
      filter: ["==", ["get", "id"], ""],
      paint: {
        "line-color": "#0f172a",
        "line-opacity": 0.95,
        "line-width": [
          "interpolate",
          ["linear"],
          ["get", "widthScore"],
          0,
          3,
          1,
          9,
        ],
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
    });
  }

  if (!map.getLayer("trade-flow-nodes")) {
    map.addLayer({
      id: "trade-flow-nodes",
      type: "circle",
      source: "trade-nodes",
      paint: {
        "circle-color": [
          "match",
          ["get", "role"],
          "supplier",
          "#d97706",
          "importer",
          "#2563eb",
          "#7c3aed",
        ],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["sqrt", ["get", "value"]],
          0,
          3,
          4500,
          13,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("trade-node-selected")) {
    map.addLayer({
      id: "trade-node-selected",
      type: "circle",
      source: "trade-nodes",
      filter: ["==", ["get", "economyIndex"], -1],
      paint: {
        "circle-color": "rgba(255,255,255,0.16)",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["sqrt", ["get", "value"]],
          0,
          7,
          4500,
          17,
        ],
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 3,
        "circle-opacity": 0.92,
      },
    });
  }
}

function Segment({ active, children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`segment ${active ? "segment--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ProductSelect({ groups, selectedCode, onChange }) {
  return (
    <label className="select-wrap select-wrap--product product-select">
      <span>Product code</span>
      <select
        value={selectedCode}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Product code"
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.products.map((product) => (
              <option key={product.code} value={product.code}>
                {`HS ${product.code} · ${product.selectorLabel || product.label}`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown size={15} />
    </label>
  );
}

function KpiCard({ label, value, subtext, children }) {
  return (
    <article className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subtext}</small>
      {children}
    </article>
  );
}

function Panel({ title, subtitle, children, className = "" }) {
  return (
    <section className={`analysis-panel ${className}`}>
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      <div className="analysis-panel__body">{children}</div>
    </section>
  );
}

function TrendValueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="trend-tooltip">
      <strong>{point.year}</strong>
      <span>{formatUsdThousand(point.value, 2)}</span>
      <small>
        {point.growth === null
          ? "First year shown"
          : `${formatSignedPercent(point.growth)} year on year`}
      </small>
    </div>
  );
}

function HhiTrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const band = hhiBand(point.hhi);
  return (
    <div className="trend-tooltip">
      <strong>{point.year}</strong>
      <span>{formatHhi(point.hhi)} HHI</span>
      <small>{band.label}</small>
    </div>
  );
}

function SupplierShareChange({ rows, startYear, endYear }) {
  if (!rows.length) {
    return <div className="empty-state">Supplier shares are unavailable for this selection.</div>;
  }
  return (
    <div className="supplier-shift">
      <div className="supplier-shift__legend" aria-hidden="true">
        <span><i className="supplier-shift__start-dot" />{startYear}</span>
        <span><i className="supplier-shift__end-dot" />{endYear}</span>
      </div>
      <div className="supplier-shift__rows">
        {rows.map((row) => {
          const startPosition = Math.min(100, Math.max(0, row.startShare * 100));
          const endPosition = Math.min(100, Math.max(0, row.endShare * 100));
          return (
            <div className="supplier-shift__row" key={row.key}>
              <strong title={row.name}>{row.name}</strong>
              <div className="supplier-shift__track">
                <i
                  className="supplier-shift__connector"
                  style={{
                    left: `${Math.min(startPosition, endPosition)}%`,
                    width: `${Math.abs(endPosition - startPosition)}%`,
                  }}
                />
                <i
                  className="supplier-shift__marker supplier-shift__marker--start"
                  style={{ left: `${startPosition}%` }}
                  title={`${startYear}: ${formatPercent(row.startShare)}`}
                />
                <i
                  className="supplier-shift__marker supplier-shift__marker--end"
                  style={{ left: `${endPosition}%` }}
                  title={`${endYear}: ${formatPercent(row.endShare)}`}
                />
              </div>
              <span>
                {formatPercent(row.startShare)} → {formatPercent(row.endShare)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendSection({
  analysis,
  endYear,
  onSelectYear,
  reporterName,
  reportingMode,
  selectedYear,
  startYear,
}) {
  const isExports = reportingMode === "exports";
  const flowLabel = isExports ? "Export" : "Import";
  const partnerLabel = isExports ? "destination" : "supplier";
  const selectedYearInRange =
    selectedYear >= startYear && selectedYear <= endYear;
  const hhiMaximum = Math.max(
    2000,
    Math.ceil(
      Math.max(
        ...analysis.series
          .map((point) => point.hhi)
          .filter(Number.isFinite),
        0,
      ) / 1000,
    ) * 1000,
  );
  const selectChartYear = (state) => {
    const selected = Number(state?.activeLabel);
    if (Number.isFinite(selected)) onSelectYear(selected);
  };

  return (
    <section className="trend-panel" aria-labelledby="trend-panel-title">
      <header className="trend-panel__header">
        <div>
          <h2 id="trend-panel-title">{flowLabel}s over time</h2>
          <p>
            {reporterName
              ? `Annual ${reportingMode} reported by ${reporterName}`
              : `Economies reporting in every year from ${startYear} to ${endYear}`}
          </p>
        </div>
      </header>

      <div className="trend-panel__body">
        <div className="trend-coverage">
          {reporterName ? (
            <div className="trend-coverage__economy">
              <strong>
                {analysis.comparableCount
                  ? `Data available for ${startYear}–${endYear}`
                  : `Data are not available for every year from ${startYear} to ${endYear}`}
              </strong>
              <span>{reporterName}</span>
            </div>
          ) : (
            <>
              <article>
                <span>Economies reporting in {startYear}</span>
                <strong>{analysis.startReporterCount}</strong>
              </article>
              <article>
                <span>Economies reporting in {endYear}</span>
                <strong>{analysis.endReporterCount}</strong>
              </article>
              <div>
                <strong>{analysis.comparableCount} economies in all years</strong>
                <span>Used for the period comparison</span>
              </div>
            </>
          )}
        </div>

        {analysis.comparableCount ? (
          <>
            <div className="trend-summary" aria-label="Trend summary indicators">
              <article>
                <span>Latest annual change</span>
                <strong
                  className={
                    analysis.endGrowth > 0
                      ? "trend-positive"
                      : analysis.endGrowth < 0
                        ? "trend-negative"
                        : ""
                  }
                >
                  {formatSignedPercent(analysis.endGrowth)}
                </strong>
                <small>Compared with {endYear - 1}</small>
              </article>
              <article>
                <span>Compound annual growth</span>
                <strong
                  className={
                    analysis.cagr > 0
                      ? "trend-positive"
                      : analysis.cagr < 0
                        ? "trend-negative"
                        : ""
                  }
                >
                  {formatSignedPercent(analysis.cagr)}
                </strong>
                <small>{startYear}–{endYear}</small>
              </article>
              {analysis.concentrationAvailable ? (
              <article>
                <span>Change in HHI</span>
                <strong>{formatSignedInteger(analysis.hhiChange)}</strong>
                <small>
                  {formatHhi(analysis.series[0].hhi)} →{" "}
                  {formatHhi(analysis.series.at(-1).hhi)}
                </small>
              </article>
              ) : null}
            </div>

            <div className="trend-chart-card trend-chart-card--value">
              <div className="trend-chart-card__heading">
                <div>
                  <h3>{reporterName ? `${flowLabel}s reported by ${reporterName}` : `${flowLabel}s reported by comparable economies`}</h3>
                  <p>Current US$, thousands</p>
                </div>
              </div>
              <div className="trend-chart trend-chart--value">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={analysis.series}
                    margin={{ top: 12, right: 22, bottom: 4, left: 12 }}
                    onClick={selectChartYear}
                  >
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="year"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={22}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => formatUsdThousand(value, 1)}
                      width={82}
                    />
                    <Tooltip
                      content={<TrendValueTooltip />}
                      cursor={{ stroke: "#94a3b8", strokeDasharray: "4 4" }}
                    />
                    {selectedYearInRange ? (
                      <ReferenceLine
                        x={selectedYear}
                        stroke="#0f172a"
                        strokeDasharray="5 5"
                      />
                    ) : null}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{ r: 4, fill: "#ffffff", strokeWidth: 3 }}
                      activeDot={{ r: 6 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="trend-detail-grid">
              {!reporterName && analysis.concentrationAvailable ? (
              <div className="trend-chart-card">
                <div className="trend-chart-card__heading">
                  <div>
                    <h3>Change in {partnerLabel} shares</h3>
                    <p>Five largest {partnerLabel}s in {startYear} or {endYear}</p>
                  </div>
                </div>
                <SupplierShareChange
                  rows={analysis.partnerShareChanges}
                  startYear={startYear}
                  endYear={endYear}
                />
              </div>
              ) : null}

              {analysis.concentrationAvailable ? (
              <div className={`trend-chart-card ${reporterName ? "trend-chart-card--wide" : ""}`}>
                <div className="trend-chart-card__heading">
                  <div>
                    <h3>{isExports ? "Destination" : "Supplier"} concentration</h3>
                    <p>Herfindahl–Hirschman Index (HHI) by year</p>
                  </div>
                </div>
                <div className="trend-chart trend-chart--hhi">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={analysis.series}
                      margin={{ top: 10, right: 22, bottom: 4, left: 8 }}
                      onClick={selectChartYear}
                    >
                      <ReferenceArea
                        y1={0}
                        y2={1000}
                        fill="#d1fae5"
                        fillOpacity={0.72}
                      />
                      <ReferenceArea
                        y1={1000}
                        y2={1800}
                        fill="#fef3c7"
                        fillOpacity={0.78}
                      />
                      <ReferenceArea
                        y1={1800}
                        y2={hhiMaximum}
                        fill="#fee2e2"
                        fillOpacity={0.62}
                      />
                      <CartesianGrid stroke="#cbd5e1" vertical={false} />
                      <XAxis
                        dataKey="year"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={18}
                      />
                      <YAxis
                        domain={[0, hhiMaximum]}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={formatHhi}
                        width={64}
                      />
                      <ReferenceLine y={1000} stroke="#10b981" />
                      <ReferenceLine y={1800} stroke="#f59e0b" />
                      <Tooltip
                        content={<HhiTrendTooltip />}
                        cursor={{ stroke: "#64748b", strokeDasharray: "4 4" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="hhi"
                        stroke="#7c3aed"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#ffffff", strokeWidth: 3 }}
                        activeDot={{ r: 6 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="trend-hhi-legend" aria-hidden="true">
                  <span><i className="hhi-low" />Low</span>
                  <span><i className="hhi-medium" />Moderate</span>
                  <span><i className="hhi-high" />High</span>
                </div>
              </div>
              ) : (
                <div className="trend-chart-card trend-chart-card--wide trend-concentration-note">
                  <h3>Partner concentration</h3>
                  <p>Choose one HS product to compare HHI over time.</p>
                </div>
              )}
            </div>

            <p className="trend-method-note">
              Period comparisons use economies reporting in every selected year.
              Missing observations are excluded.
            </p>
          </>
        ) : (
          <div className="empty-state">
            {reporterName
              ? `${reporterName} does not report data for every year in this period.`
              : "No economy reports data for every year in this period."}
          </div>
        )}
      </div>
    </section>
  );
}

function RankingBars({ rows, color }) {
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) {
    return <div className="empty-state">No reported trade is available for this selection.</div>;
  }
  return (
    <div className="ranking-bars">
      {rows.map((row, index) => (
        <div className="ranking-row" key={row.economyIndex}>
          <span className="ranking-number">{index + 1}</span>
          <div className="ranking-label">
            <strong>{row.name}</strong>
            <small>{row.iso3 || "—"}</small>
          </div>
          <div className="ranking-track">
            <i
              style={{
                width: `${Math.max(2, (row.value / maximum) * 100)}%`,
                background: color,
              }}
            />
          </div>
          <div className="ranking-value">
            <strong>{formatUsdThousand(row.value)}</strong>
            <small>{formatPercent(row.share)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

const SANKEY_NODE_PADDING = 32;
const SANKEY_LABEL_LINE_HEIGHT = 20;
const SUPPLIER_COLORS = [
  "#0F766E",
  "#0EA5E9",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#EA580C",
  "#65A30D",
  "#0891B2",
];
const IMPORTER_COLOR = "#10B981";

function wrapSankeyLabel(value, maximumCharacters = 22) {
  const words = String(value || "").split(/\s+/);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maximumCharacters || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function TradeFlowNode(props) {
  const {
    x,
    y,
    width,
    height,
    index,
    payload,
    onSelect,
    isDimmed,
    isActive,
    ...rest
  } = props;
  const isSupplier = payload?.role === "supplier";
  const labelX = isSupplier ? x - 12 : x + width + 12;
  const anchor = isSupplier ? "end" : "start";
  const lines = wrapSankeyLabel(payload?.name ?? `Node ${index + 1}`);

  return (
    <g
      {...rest}
      data-aggregated={payload?.aggregated ? "true" : undefined}
      onClick={() => {
        if (!payload?.aggregated) onSelect?.(payload?.economyIndex);
      }}
      style={{ cursor: payload?.aggregated ? "default" : "pointer" }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={payload?.color}
        fillOpacity={isDimmed ? 0.25 : 0.92}
        stroke={isActive ? "#0F172A" : "transparent"}
        strokeWidth={isActive ? 2 : 0}
        rx={3}
      />
      <text
        x={labelX}
        y={y + height / 2}
        textAnchor={anchor}
        dominantBaseline="middle"
        fontSize={16}
        fill={isDimmed ? "#94A3B8" : "#334155"}
        stroke="#FFFFFF"
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {lines.map((line, lineIndex) => (
          <tspan
            key={`${payload?.name}-${lineIndex}`}
            x={labelX}
            dy={
              lineIndex === 0
                ? -((lines.length - 1) * SANKEY_LABEL_LINE_HEIGHT) / 2
                : SANKEY_LABEL_LINE_HEIGHT
            }
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function TradeFlowLink(props) {
  const {
    sourceX,
    targetX,
    sourceY,
    targetY,
    sourceControlX,
    targetControlX,
    linkWidth,
    payload,
    className,
    onClick,
    onMouseEnter,
    onMouseLeave,
  } = props;
  const width = Math.max(linkWidth ?? 0, 1);
  const y0Top = sourceY - width / 2;
  const y0Bottom = sourceY + width / 2;
  const y1Top = targetY - width / 2;
  const y1Bottom = targetY + width / 2;
  const path = [
    `M${sourceX},${y0Top}`,
    `C${sourceControlX},${y0Top} ${targetControlX},${y1Top} ${targetX},${y1Top}`,
    `L${targetX},${y1Bottom}`,
    `C${targetControlX},${y1Bottom} ${sourceControlX},${y0Bottom} ${sourceX},${y0Bottom}`,
    "Z",
  ].join(" ");

  return (
    <path
      className={className}
      data-aggregated={payload?.aggregated ? "true" : undefined}
      d={path}
      fill={payload?.color ?? SUPPLIER_COLORS[0]}
      fillOpacity={0.58}
      stroke="none"
      style={{ cursor: "pointer" }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

function getSankeyHover(entry, type) {
  if (type === "link") {
    const link = entry?.payload || entry || {};
    const sourceName =
      link.sourceName ||
      entry?.sourceName ||
      entry?.source?.name ||
      entry?.source?.payload?.name ||
      "Unknown supplier";
    const targetName =
      link.targetName ||
      entry?.targetName ||
      entry?.target?.name ||
      entry?.target?.payload?.name ||
      "Unknown importing market";
    const value = link.value ?? entry?.value;
    return {
      x: (entry.sourceX + entry.targetX) / 2,
      y: (entry.sourceY + entry.targetY) / 2,
      title: `${sourceName} → ${targetName}`,
      value: formatUsdThousand(value),
      subtitle: link.aggregated
        ? "Routes not shown separately"
        : "Bilateral trade value",
    };
  }
  const node = entry.payload;
  return {
    x: entry.x + entry.width / 2,
    y: entry.y + entry.height / 2,
    title: node?.name || "Trade economy",
    value: formatUsdThousand(node?.totalValue || 0),
    subtitle: node?.aggregated
      ? "Trade not shown separately"
      : node?.role === "supplier"
        ? "Exports shown from this economy"
        : "Imports shown for this economy",
  };
}

function TradeSankey({
  routes,
  economies,
  selectedEconomyIndex,
  residualRows,
  totalValue,
  onSelectEconomy,
}) {
  const [hoveredItem, setHoveredItem] = useState(null);
  const sankeyData = useMemo(() => {
    const supplierTotals = new Map();
    const importerTotals = new Map();
    routes.forEach((route) => {
      supplierTotals.set(
        route.supplierIndex,
        (supplierTotals.get(route.supplierIndex) || 0) + route.value,
      );
      importerTotals.set(
        route.importerIndex,
        (importerTotals.get(route.importerIndex) || 0) + route.value,
      );
    });

    const leadingIndexes = (totals) =>
      [...totals.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([economyIndex]) => economyIndex);
    const supplierIndexes = leadingIndexes(supplierTotals);
    const importerIndexes = leadingIndexes(importerTotals);
    const supplierSet = new Set(supplierIndexes);
    const importerSet = new Set(importerIndexes);
    const visibleRoutes = routes
      .filter(
        (route) =>
          supplierSet.has(route.supplierIndex) &&
          importerSet.has(route.importerIndex),
      )
      .slice(0, 32);

    const visibleSupplierTotals = new Map();
    const visibleImporterTotals = new Map();
    visibleRoutes.forEach((route) => {
      visibleSupplierTotals.set(
        route.supplierIndex,
        (visibleSupplierTotals.get(route.supplierIndex) || 0) + route.value,
      );
      visibleImporterTotals.set(
        route.importerIndex,
        (visibleImporterTotals.get(route.importerIndex) || 0) + route.value,
      );
    });

    const residualBySupplier = new Map(
      (residualRows || []).filter(([economyIndex]) => economyIndex >= 0),
    );
    const suppliedResidual = (residualRows || []).find(
      ([economyIndex]) => economyIndex === -1,
    )?.[1];
    const visibleValue = visibleRoutes.reduce((sum, route) => sum + route.value, 0);
    const otherSupplierResidual = Number.isFinite(suppliedResidual)
      ? suppliedResidual
      : Number.isFinite(totalValue)
        ? Math.max(0, totalValue - visibleValue)
        : 0;
    const connectedSuppliers = supplierIndexes.filter(
      (economyIndex) =>
        visibleSupplierTotals.has(economyIndex) ||
        (residualBySupplier.get(economyIndex) || 0) > 0,
    );
    const connectedImporters = importerIndexes.filter((economyIndex) =>
      visibleImporterTotals.has(economyIndex),
    );
    const nodes = [
      ...connectedSuppliers.map((economyIndex, index) => ({
        name: economies[economyIndex]?.name || "Unknown",
        role: "supplier",
        economyIndex,
        totalValue:
          (visibleSupplierTotals.get(economyIndex) || 0) +
          (residualBySupplier.get(economyIndex) || 0),
        color: SUPPLIER_COLORS[index % SUPPLIER_COLORS.length],
      })),
      ...connectedImporters.map((economyIndex) => ({
        name: economies[economyIndex]?.name || "Unknown",
        role: "importer",
        economyIndex,
        totalValue: visibleImporterTotals.get(economyIndex),
        color: IMPORTER_COLOR,
      })),
    ];
    const nodeIndex = new Map(
      nodes.map((node, index) => [
        `${node.role}-${node.economyIndex}`,
        index,
      ]),
    );
    const links = visibleRoutes.map((route) => ({
      source: nodeIndex.get(`supplier-${route.supplierIndex}`),
      target: nodeIndex.get(`importer-${route.importerIndex}`),
      value: route.value,
      sourceName: route.supplierName,
      targetName: route.importerName,
      color:
        nodes[nodeIndex.get(`supplier-${route.supplierIndex}`)]?.color ||
        SUPPLIER_COLORS[0],
    }));

    const namedResidualTotal = [...residualBySupplier.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const residualValue = namedResidualTotal + otherSupplierResidual;
    if (residualValue > 0) {
      const otherImporterIndex = nodes.length;
      nodes.push({
        name: "Other economies",
        role: "importer",
        economyIndex: null,
        totalValue: residualValue,
        color: "#CBD5E1",
        aggregated: true,
      });
      connectedSuppliers.forEach((economyIndex) => {
        const value = residualBySupplier.get(economyIndex) || 0;
        if (value <= 0) return;
        const source = nodeIndex.get(`supplier-${economyIndex}`);
        links.push({
          source,
          target: otherImporterIndex,
          value,
          sourceName: economies[economyIndex]?.name || "Unknown",
          targetName: "Other importing economies",
          color: nodes[source]?.color || SUPPLIER_COLORS[0],
          aggregated: true,
        });
      });
      if (otherSupplierResidual > 0) {
        const otherSupplierIndex = nodes.length;
        nodes.push({
          name: "Other economies",
          role: "supplier",
          economyIndex: null,
          totalValue: otherSupplierResidual,
          color: "#94A3B8",
          aggregated: true,
        });
        links.push({
          source: otherSupplierIndex,
          target: otherImporterIndex,
          value: otherSupplierResidual,
          sourceName: "Other supplier economies",
          targetName: "Other importing economies",
          color: "#CBD5E1",
          aggregated: true,
        });
      }
    }

    return {
      nodes,
      links,
      maximumColumnNodes: Math.max(
        connectedSuppliers.length + (otherSupplierResidual > 0 ? 1 : 0),
        connectedImporters.length + (residualValue > 0 ? 1 : 0),
      ),
    };
  }, [economies, residualRows, routes, totalValue]);

  if (!sankeyData.links.length) {
    return <div className="empty-state">No bilateral trade is available for this selection.</div>;
  }

  const sankeyHeight = Math.max(
    520,
    sankeyData.maximumColumnNodes * (SANKEY_NODE_PADDING + 24) + 72,
  );
  const nodeRenderer = (props) => (
    <TradeFlowNode
      {...props}
      onSelect={onSelectEconomy}
      isActive={
        props.payload?.economyIndex !== null &&
        selectedEconomyIndex === props.payload?.economyIndex
      }
      isDimmed={
        selectedEconomyIndex !== null &&
        selectedEconomyIndex !== props.payload?.economyIndex
      }
    />
  );

  return (
    <div className="sankey-scroll">
      <div
        className="transport-sankey-canvas"
        style={{ height: sankeyHeight }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={sankeyData}
            nodePadding={SANKEY_NODE_PADDING}
            nodeWidth={14}
            sort={false}
            margin={{ top: 24, right: 320, left: 300, bottom: 24 }}
            node={nodeRenderer}
            link={<TradeFlowLink />}
            onMouseEnter={(entry, type) =>
              setHoveredItem(getSankeyHover(entry, type))
            }
            onMouseLeave={() => setHoveredItem(null)}
          />
        </ResponsiveContainer>
        {hoveredItem ? (
          <div
            className="trade-sankey-tooltip"
            style={{
              left: Math.min(hoveredItem.x + 12, 930),
              top: hoveredItem.y,
            }}
          >
            <strong>{hoveredItem.title}</strong>
            <span>{hoveredItem.value}</span>
            <small>{hoveredItem.subtitle}</small>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HhiChart({ rows, reporterLabel = "importer" }) {
  if (!rows.length) {
    return <div className="empty-state">HHI is unavailable for this selection.</div>;
  }
  return (
    <>
      <div className="hhi-thresholds" aria-hidden="true">
        <span><i className="hhi-low" />Low · below 1,000</span>
        <span><i className="hhi-medium" />Moderate · 1,000–1,800</span>
        <span><i className="hhi-high" />High · above 1,800</span>
      </div>
      <div className="hhi-list">
        {rows.map((row) => {
          const band = hhiBand(row.hhi);
          return (
            <div className="hhi-row" key={row.importerIndex}>
              <div className="hhi-country">
                <strong>{row.name}</strong>
                <small>Top partner: {row.topSupplierName}{Number.isFinite(row.value) ? ` · ${formatUsdThousand(row.value)}` : ""}</small>
              </div>
              <div className="hhi-scale">
                <i
                  className={`hhi-dot hhi-dot--${band.tone}`}
                  style={{
                    left: `${Math.min(100, Math.max(0, row.hhi / 100))}%`,
                  }}
                />
              </div>
              <strong className="hhi-value">{formatHhi(row.hhi)}</strong>
            </div>
          );
        })}
      </div>
    </>
  );
}

function RouteTable({ rows, onSelect }) {
  if (!rows.length) {
    return <div className="empty-state">No bilateral trade is available for this selection.</div>;
  }
  return (
    <div className="route-table-wrap">
      <table className="route-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Supplier</th>
            <th />
            <th>Importing economy</th>
            <th>Trade value</th>
            <th>Share of total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} onClick={() => onSelect(row.id)}>
              <td>{index + 1}</td>
              <td><strong>{row.supplierName}</strong></td>
              <td className="route-arrow">→</td>
              <td>{row.importerName}</td>
              <td>{formatUsdThousand(row.value)}</td>
              <td>{formatPercent(row.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RouteDetail({ route, productLabel, reportingMode, year, onClose }) {
  if (!route) return null;
  return (
    <aside className="detail-panel" aria-label="Selected trade route">
      <div className="detail-header">
        <div>
          <h2>{route.supplierName} → {route.importerName}</h2>
          <p>{productLabel} · {year}</p>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close route details"
        >
          <X size={18} />
        </button>
      </div>
      <div className="detail-scroll">
        <div className="route-value-block">
          <span>
            {reportingMode === "exports" ? "Export" : "Import"} value reported by {reportingMode === "exports" ? route.supplierName : route.importerName}
          </span>
          <strong>{formatDetailedUsd(route.value)}</strong>
        </div>
        <section className="detail-section">
          <h3>Shares</h3>
          <dl>
            <div>
              <dt>Share of bilateral trade</dt>
              <dd>{formatPercent(route.share)}</dd>
            </div>
            <div>
              <dt>Share of reporting economy total</dt>
              <dd>{formatPercent(route.reporterShare)}</dd>
            </div>
            <div>
              <dt>Total reported {reportingMode}</dt>
              <dd>{formatUsdThousand(route.reporterWorld)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </aside>
  );
}

function addEntries(target, entries = []) {
  entries.forEach(([key, value]) => {
    if (Number.isFinite(value)) target.set(key, (target.get(key) || 0) + value);
  });
}

function rankedEconomies(totals, economies, denominator) {
  return [...totals.entries()]
    .filter(
      ([economyIndex, value]) => value > 0 && !isSpecialEconomy(economies[economyIndex]),
    )
    .map(([economyIndex, value]) => ({
      economyIndex,
      name: economies[economyIndex]?.name || "Unknown",
      iso3: economies[economyIndex]?.iso3,
      value,
      share: denominator ? value / denominator : 0,
    }))
    .sort((left, right) => right.value - left.value);
}

function buildSnapshotAnalysis(
  dataset,
  reportingMode,
  productIndexes,
  yearIndex,
  reporterEconomyIndex = null,
) {
  const view = dataset.reportingViews[reportingMode];
  const selectedSet = new Set(productIndexes);
  const summaries = productIndexes
    .map((productIndex) => view.snapshotSummaries?.[productIndex]?.[yearIndex])
    .filter(Boolean);
  const reporterTotals = new Map();
  const partnerTotals = new Map();
  const reporterHhiParts = new Map();
  const reporterIndexes = new Set();
  const leadingRouteTotals = new Map();
  let totalReported = 0;
  let totalBilateral = 0;
  const concentrationAvailable = productIndexes.length === 1;

  summaries.forEach((summary) => {
    const productReporterTotals = new Map(summary.reporterTotals || []);
    const selectedReporterTotals = (summary.reporterTotals || []).filter(
      ([reporterIndex]) =>
        !isSpecialEconomy(dataset.economies[reporterIndex]) &&
        (reporterEconomyIndex === null || reporterIndex === reporterEconomyIndex),
    );
    totalReported += selectedReporterTotals.reduce(
      (sum, [, value]) => sum + value,
      0,
    );
    if (reporterEconomyIndex === null) {
      addEntries(
        partnerTotals,
        (summary.partnerTotals || []).filter(
          ([partnerIndex]) => !isSpecialEconomy(dataset.economies[partnerIndex]),
        ),
      );
    }
    addEntries(reporterTotals, selectedReporterTotals);
    (summary.reporterHhi || []).forEach(
      ([reporterIndex, hhi, topPartnerIndex, topPartnerValue = 0]) => {
      if (
        reporterEconomyIndex !== null &&
        reporterIndex !== reporterEconomyIndex
      ) return;
      const weight = productReporterTotals.get(reporterIndex) || 0;
      if (!weight) return;
      const item = reporterHhiParts.get(reporterIndex) || {
        value: 0,
        weightedHhi: 0,
        topPartnerIndex: null,
        topPartnerWeight: -1,
      };
      item.value += weight;
      item.weightedHhi += hhi * weight;
      if (weight > item.topPartnerWeight) {
        item.topPartnerWeight = weight;
        item.topPartnerIndex = topPartnerIndex;
      }
      reporterHhiParts.set(reporterIndex, item);
      if (topPartnerIndex !== null && topPartnerValue > 0) {
        const supplierIndex =
          reportingMode === "exports" ? reporterIndex : topPartnerIndex;
        const importerIndex =
          reportingMode === "exports" ? topPartnerIndex : reporterIndex;
        const key = `${supplierIndex}|${importerIndex}`;
        leadingRouteTotals.set(
          key,
          (leadingRouteTotals.get(key) || 0) + topPartnerValue,
        );
      }
    });
    selectedReporterTotals.forEach(([reporterIndex]) =>
      reporterIndexes.add(reporterIndex),
    );
  });

  if (reporterEconomyIndex === null) {
    totalBilateral = [...partnerTotals.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
  }

  const routeTotals = new Map();
  view.records.forEach(([productIndex, importerIndex, exporterIndex, values]) => {
    if (!selectedSet.has(productIndex)) return;
    const recordReporterIndex =
      reportingMode === "exports" ? exporterIndex : importerIndex;
    if (
      reporterEconomyIndex !== null &&
      recordReporterIndex !== reporterEconomyIndex
    ) return;
    const value = values[yearIndex];
    if (!Number.isFinite(value) || value <= 0) return;
    if (
      isSpecialEconomy(dataset.economies[exporterIndex]) ||
      isSpecialEconomy(dataset.economies[importerIndex])
    ) return;
    const key = `${exporterIndex}|${importerIndex}`;
    const row = routeTotals.get(key) || {
      supplierIndex: exporterIndex,
      importerIndex,
      value: 0,
    };
    row.value += value;
    routeTotals.set(key, row);
  });
  if (reporterEconomyIndex !== null) {
    leadingRouteTotals.forEach((value, key) => {
      const [supplierIndex, importerIndex] = key.split("|").map(Number);
      const published = routeTotals.get(key);
      if (!published || published.value < value) {
        routeTotals.set(key, { supplierIndex, importerIndex, value });
      }
    });
    totalBilateral = [...routeTotals.values()].reduce(
      (sum, row) => sum + row.value,
      0,
    );
    routeTotals.forEach((row) => {
      const partnerIndex =
        reportingMode === "exports" ? row.importerIndex : row.supplierIndex;
      partnerTotals.set(
        partnerIndex,
        (partnerTotals.get(partnerIndex) || 0) + row.value,
      );
    });
  }

  const routes = [...routeTotals.values()]
    .map((row) => {
      const reporterIndex =
        reportingMode === "exports" ? row.supplierIndex : row.importerIndex;
      const reporterWorld = reporterTotals.get(reporterIndex) || 0;
      return {
        ...row,
        id: `${row.supplierIndex}-${row.importerIndex}`,
        supplierName: dataset.economies[row.supplierIndex]?.name || "Unknown",
        importerName: dataset.economies[row.importerIndex]?.name || "Unknown",
        share: (reporterEconomyIndex === null ? totalBilateral : totalReported)
          ? row.value /
            (reporterEconomyIndex === null ? totalBilateral : totalReported)
          : 0,
        reporterWorld,
        reporterShare: reporterWorld ? row.value / reporterWorld : 0,
      };
    })
    .sort((left, right) => right.value - left.value);

  const reporterHhi = (concentrationAvailable
    ? [...reporterHhiParts.entries()]
    : [])
    .map(([reporterIndex, item]) => ({
      importerIndex: reporterIndex,
      name: dataset.economies[reporterIndex]?.name || "Unknown",
      hhi: item.value ? item.weightedHhi / item.value : 0,
      value: item.value,
      topSupplierName:
        item.topPartnerIndex === null
          ? "No partners"
          : dataset.economies[item.topPartnerIndex]?.name || "Unknown",
    }))
    .sort((left, right) => right.value - left.value);
  const overallHhi =
    reporterEconomyIndex === null
      ? [...partnerTotals.values()].reduce((sum, value) => {
          const share = totalBilateral ? value / totalBilateral : 0;
          return sum + share ** 2 * 10_000;
        }, 0)
      : concentrationAvailable
        ? reporterHhi.reduce(
          (sum, row) =>
            sum + row.hhi * (reporterTotals.get(row.importerIndex) || 0),
          0,
        ) / (totalReported || 1)
        : null;
  const mapNodeTotals = new Map();
  new Set([...reporterTotals.keys(), ...partnerTotals.keys()]).forEach(
    (economyIndex) => {
      mapNodeTotals.set(economyIndex, {
        supplierValue:
          reportingMode === "exports"
            ? reporterTotals.get(economyIndex) || 0
            : partnerTotals.get(economyIndex) || 0,
        importerValue:
          reportingMode === "exports"
            ? partnerTotals.get(economyIndex) || 0
            : reporterTotals.get(economyIndex) || 0,
      });
    },
  );

  return {
    totalReported,
    totalBilateral,
    reporters: reporterIndexes.size,
    concentrationAvailable,
    overallHhi,
    reporterRanking: rankedEconomies(reporterTotals, dataset.economies, totalReported),
    partnerRanking: rankedEconomies(
      partnerTotals,
      dataset.economies,
      reporterEconomyIndex === null ? totalBilateral : totalReported,
    ),
    reporterHhi,
    routes,
    mapNodeTotals,
    sankeyResiduals: concentrationAvailable ? summaries[0]?.sankeyResiduals || {} : {},
  };
}

function intersectSets(sets) {
  if (!sets.length) return new Set();
  const result = new Set(sets[0]);
  sets.slice(1).forEach((set) => {
    [...result].forEach((value) => {
      if (!set.has(value)) result.delete(value);
    });
  });
  return result;
}

function buildTrendAnalysis(
  dataset,
  reportingMode,
  productIndexes,
  selectedYears,
  reporterEconomyIndex = null,
) {
  const view = dataset.reportingViews[reportingMode];
  const concentrationAvailable = productIndexes.length === 1;
  if (concentrationAvailable && reporterEconomyIndex === null) {
    const stored = view.trendSummaries?.[productIndexes[0]]?.[
      `${selectedYears[0]}-${selectedYears.at(-1)}`
    ];
    if (stored) {
      return {
        ...stored,
        concentrationAvailable: true,
        partnerShareChanges: (stored.partnerShareChanges || []).map((row) => ({
          ...row,
          name:
            row.key === "other"
              ? "Other partners"
              : dataset.economies[row.key]?.name || "Unknown",
        })),
      };
    }
  }
  const yearIndexes = selectedYears.map((year) => dataset.years.indexOf(year));
  const summaryAt = (productIndex, yearIndex) =>
    view.snapshotSummaries?.[productIndex]?.[yearIndex];
  const comparableSets = [];
  productIndexes.forEach((productIndex) => {
    yearIndexes.forEach((yearIndex) => {
      comparableSets.push(
        new Set((summaryAt(productIndex, yearIndex)?.reporterTotals || []).map(([key]) => key)),
      );
    });
  });
  const comparableReporters = intersectSets(comparableSets);
  if (
    reporterEconomyIndex !== null &&
    comparableReporters.has(reporterEconomyIndex)
  ) {
    [...comparableReporters].forEach((reporterIndex) => {
      if (reporterIndex !== reporterEconomyIndex) comparableReporters.delete(reporterIndex);
    });
  } else if (reporterEconomyIndex !== null) {
    comparableReporters.clear();
  }
  const sharesByYear = new Map();
  const series = selectedYears.map((year, position) => {
    const yearIndex = yearIndexes[position];
    let value = 0;
    const partnerTotals = new Map();
    let weightedReporterHhi = 0;
    let reporterHhiWeight = 0;
    productIndexes.forEach((productIndex) => {
      const summary = summaryAt(productIndex, yearIndex);
      const productReporterTotals = new Map(summary?.reporterTotals || []);
      (summary?.reporterTotals || []).forEach(([reporterIndex, reporterValue]) => {
        if (comparableReporters.has(reporterIndex)) value += reporterValue;
      });
      if (reporterEconomyIndex === null) {
        addEntries(partnerTotals, summary?.partnerTotals);
      } else {
        (summary?.reporterHhi || []).forEach(([reporterIndex, hhi]) => {
          if (!comparableReporters.has(reporterIndex)) return;
          const weight = productReporterTotals.get(reporterIndex) || 0;
          weightedReporterHhi += hhi * weight;
          reporterHhiWeight += weight;
        });
      }
    });
    const partnerTotal = [...partnerTotals.values()].reduce((sum, item) => sum + item, 0);
    const shares = new Map(
      [...partnerTotals.entries()].map(([key, item]) => [
        key,
        partnerTotal ? item / partnerTotal : 0,
      ]),
    );
    sharesByYear.set(year, shares);
    const hhi = concentrationAvailable
      ? reporterEconomyIndex === null
        ? [...shares.values()].reduce((sum, share) => sum + share ** 2 * 10_000, 0)
        : reporterHhiWeight
          ? weightedReporterHhi / reporterHhiWeight
          : null
      : null;
    return { year, value, growth: null, hhi };
  });
  series.forEach((point, index) => {
    if (!index) return;
    const prior = series[index - 1].value;
    point.growth = prior ? point.value / prior - 1 : null;
  });
  const startShares = sharesByYear.get(selectedYears[0]) || new Map();
  const endShares = sharesByYear.get(selectedYears.at(-1)) || new Map();
  const leading = [...new Set([...startShares.keys(), ...endShares.keys()])]
    .sort(
      (left, right) =>
        Math.max(endShares.get(right) || 0, startShares.get(right) || 0) -
        Math.max(endShares.get(left) || 0, startShares.get(left) || 0),
    )
    .slice(0, 5);
  const partnerShareChanges = concentrationAvailable && reporterEconomyIndex === null ? leading.map((key) => ({
    key,
    name: dataset.economies[key]?.name || "Unknown",
    startShare: startShares.get(key) || 0,
    endShare: endShares.get(key) || 0,
  })) : [];
  if (concentrationAvailable && reporterEconomyIndex === null && leading.length) {
    partnerShareChanges.push({
      key: "other",
      name: "Other partners",
      startShare: Math.max(0, 1 - leading.reduce((sum, key) => sum + (startShares.get(key) || 0), 0)),
      endShare: Math.max(0, 1 - leading.reduce((sum, key) => sum + (endShares.get(key) || 0), 0)),
    });
  }
  const endpointReporterCount = (yearIndex) =>
    [...intersectSets(
      productIndexes.map(
        (productIndex) =>
          new Set((summaryAt(productIndex, yearIndex)?.reporterTotals || []).map(([key]) => key)),
      ),
    )].filter(
      (reporterIndex) =>
        reporterEconomyIndex === null || reporterIndex === reporterEconomyIndex,
    ).length;
  const startValue = series[0]?.value || 0;
  const endValue = series.at(-1)?.value || 0;
  const intervals = selectedYears.at(-1) - selectedYears[0];
  return {
    series,
    concentrationAvailable,
    comparableCount: comparableReporters.size,
    startReporterCount: endpointReporterCount(yearIndexes[0]),
    endReporterCount: endpointReporterCount(yearIndexes.at(-1)),
    endGrowth: series.at(-1)?.growth ?? null,
    cagr: startValue > 0 && intervals > 0 ? (endValue / startValue) ** (1 / intervals) - 1 : null,
    hhiChange: concentrationAvailable
      ? (series.at(-1)?.hhi || 0) - (series[0]?.hhi || 0)
      : null,
    partnerShareChanges,
  };
}

export default function TradeExplorerApp() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const mapPayloadRef = useRef(buildMapPayload([], []));
  const reportingModeRef = useRef("imports");
  const selectedEconomyIndexRef = useRef(null);
  const [dataset, setDataset] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [productCodes, setProductCodes] = useState([DEFAULT_PRODUCT]);
  const [reportingMode, setReportingMode] = useState("imports");
  const [year, setYear] = useState(2024);
  const [flowLimit, setFlowLimit] = useState(DEFAULT_FLOW_LIMIT);
  const [trendStartYear, setTrendStartYear] = useState(2019);
  const [trendEndYear, setTrendEndYear] = useState(2024);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedEconomyIndex, setSelectedEconomyIndex] = useState(null);
  const [connectionMode, setConnectionMode] = useState("all");
  const [showHhiInfo, setShowHhiInfo] = useState(false);
  const [analysisView, setAnalysisView] = useState("snapshot");
  const [selectedTrendYear, setSelectedTrendYear] = useState(null);
  const [countryEconomyIndex, setCountryEconomyIndex] = useState(null);
  const [flowView, setFlowView] = useState("map");
  const [sankeyEconomyIndex, setSankeyEconomyIndex] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    setSankeyEconomyIndex(null);
  }, [countryEconomyIndex, productCodes, reportingMode, year]);

  useEffect(() => {
    fetch(assetUrl("data/trade-flows-comtrade.json"))
      .then((response) => {
        if (!response.ok) throw new Error("The trade dataset could not be loaded.");
        return response.json();
      })
      .then((payload) => {
        setDataset(payload);
        const defaultProduct = payload.products.find(
          (product) => product.code === DEFAULT_PRODUCT,
        );
        setProductCodes([defaultProduct?.code || payload.products[0]?.code]);
        setYear(Math.max(...payload.years));
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  const selectedProducts = useMemo(() => {
    if (!dataset) return [];
    return dataset.products.filter((product) => product.code === productCodes[0]);
  }, [dataset, productCodes]);
  const effectiveProducts = selectedProducts;
  const selectedProductIndexes = useMemo(
    () => effectiveProducts.map((product) => dataset.products.indexOf(product)),
    [dataset, effectiveProducts],
  );
  const selectedProductLabel = useMemo(() => {
    if (!selectedProducts.length) return "Product not selected";
    const product = selectedProducts[0];
    return `HS ${product.code} · ${product.selectorLabel || product.label}`;
  }, [selectedProducts]);
  const selectedProduct = selectedProducts[0] || null;
  const productCode = selectedProduct?.code || "";

  const selectProductCode = useCallback((code) => {
    setProductCodes([code]);
    setSelectedRouteId(null);
    setSelectedEconomyIndex(null);
    setConnectionMode("all");
    setSankeyEconomyIndex(null);
  }, []);

  const productGroups = useMemo(() => {
    if (!dataset) return [];
    const groups = new Map();
    dataset.products.forEach((product) => {
      const group = product.selectorGroup || "Other transport equipment";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(product);
    });
    const knownGroups = PRODUCT_SELECTOR_GROUPS.map((label) => ({
      label,
      products: groups.get(label) || [],
    })).filter((group) => group.products.length);
    const unknownGroups = [...groups.entries()]
      .filter(([label]) => !PRODUCT_SELECTOR_GROUPS.includes(label))
      .map(([label, products]) => ({ label, products }));
    return [...knownGroups, ...unknownGroups];
  }, [dataset]);

  const eligibleTrendYears = useMemo(() => {
    if (!dataset || !effectiveProducts.length) return [];
    const earliestYear = Math.max(
      Math.min(...dataset.years),
      ...effectiveProducts.map(
        (product) =>
          product.availableFrom || product.activeFrom || Math.min(...dataset.years),
      ),
    );
    return dataset.years.filter((item) => item >= earliestYear);
  }, [dataset, effectiveProducts]);

  useEffect(() => {
    if (!dataset || !effectiveProducts.length) return;
    const range = defaultTrendRange(dataset.years, {
      availableFrom: Math.max(
        ...effectiveProducts.map(
          (product) =>
            product.availableFrom || product.activeFrom || Math.min(...dataset.years),
        ),
      ),
    });
    setTrendStartYear(range.start);
    setTrendEndYear(range.end);
    setSelectedTrendYear(null);
  }, [dataset, effectiveProducts]);

  useEffect(() => {
    if (
      !dataset ||
      countryEconomyIndex === null ||
      !selectedProductIndexes.length
    ) return;
    const view = dataset.reportingViews[reportingMode];
    const availableYears = eligibleTrendYears.filter((availableYear) => {
      const yearIndex = dataset.years.indexOf(availableYear);
      return selectedProductIndexes.every((productIndex) =>
        (view.snapshotSummaries?.[productIndex]?.[yearIndex]?.reporterTotals || [])
          .some(([reporterIndex]) => reporterIndex === countryEconomyIndex),
      );
    });
    const range = longestConsecutiveRange(availableYears);
    if (range && range[1] > range[0]) {
      setTrendStartYear(range[0]);
      setTrendEndYear(range[1]);
      setSelectedTrendYear(null);
    }
  }, [
    countryEconomyIndex,
    dataset,
    eligibleTrendYears,
    reportingMode,
    selectedProductIndexes,
  ]);

  useEffect(() => {
    if (!dataset || !effectiveProducts.length) return;
    const availableFrom = Math.max(
      ...effectiveProducts.map(
        (product) =>
          product.availableFrom || product.activeFrom || Math.min(...dataset.years),
      ),
    );
    if (year < availableFrom) setYear(Math.max(...dataset.years));
  }, [dataset, effectiveProducts, year]);

  const legacyAnalysis = useMemo(() => {
    if (!dataset || !selectedProduct) return null;
    const productIndex = dataset.products.indexOf(selectedProduct);
    const yearIndex = dataset.years.indexOf(year);
    const storedSummary = null;
    const worldIndex = dataset.economies.findIndex(
      (economy) => economy.name === "World",
    );
    const worldByImporter = new Map(storedSummary?.importerTotals || []);
    const bilateral = [];

    dataset.reportingViews.imports.records.forEach((record) => {
      const [recordProduct, importerIndex, exporterIndex, values] = record;
      if (recordProduct !== productIndex) return;
      const value = values[yearIndex];
      if (value === null || value === undefined) return;
      if (exporterIndex === worldIndex) {
        worldByImporter.set(importerIndex, value);
      } else {
        bilateral.push({ importerIndex, supplierIndex: exporterIndex, value });
      }
    });

    const validBilateral = bilateral.filter(
      (row) => worldByImporter.has(row.importerIndex) && row.value > 0,
    );
    const totalImported = storedSummary
      ? storedSummary.totalImported
      : [...worldByImporter.values()].reduce((sum, value) => sum + value, 0);
    const totalExported = storedSummary
      ? storedSummary.totalExported
      : validBilateral.reduce((sum, row) => sum + row.value, 0);
    const supplierTotals = new Map();
    const importerPartnerTotals = new Map();

    validBilateral.forEach((row) => {
      supplierTotals.set(
        row.supplierIndex,
        (supplierTotals.get(row.supplierIndex) || 0) + row.value,
      );
      importerPartnerTotals.set(
        row.importerIndex,
        (importerPartnerTotals.get(row.importerIndex) || 0) + row.value,
      );
    });

    const importers = storedSummary
      ? storedSummary.importers.map(([economyIndex, value, share]) => ({
          economyIndex,
          name: dataset.economies[economyIndex].name,
          iso3: dataset.economies[economyIndex].iso3,
          value,
          share,
        }))
      : [...worldByImporter.entries()]
          .filter(([, value]) => value > 0)
          .map(([economyIndex, value]) => ({
            economyIndex,
            name: dataset.economies[economyIndex].name,
            iso3: dataset.economies[economyIndex].iso3,
            value,
            share: totalImported ? value / totalImported : 0,
          }))
          .sort((left, right) => right.value - left.value);

    const suppliers = storedSummary
      ? storedSummary.suppliers.map(([economyIndex, value, share]) => ({
          economyIndex,
          name: dataset.economies[economyIndex].name,
          iso3: dataset.economies[economyIndex].iso3,
          value,
          share,
        }))
      : [...supplierTotals.entries()]
          .map(([economyIndex, value]) => ({
            economyIndex,
            name: dataset.economies[economyIndex].name,
            iso3: dataset.economies[economyIndex].iso3,
            value,
            share: totalExported ? value / totalExported : 0,
          }))
          .sort((left, right) => right.value - left.value);

    const overallHhi = storedSummary
      ? storedSummary.overallHhi
      : suppliers.reduce(
          (sum, supplier) => sum + supplier.share ** 2 * 10_000,
          0,
        );

    const importerHhi = storedSummary
      ? storedSummary.importerHhi.map(
          ([importerIndex, hhi, topSupplierIndex]) => ({
            importerIndex,
            name: dataset.economies[importerIndex].name,
            hhi,
            topSupplierName:
              topSupplierIndex === null
                ? "No suppliers"
                : dataset.economies[topSupplierIndex].name,
          }),
        )
      : importers
          .map((importer) => {
            const partnerRows = validBilateral.filter(
              (row) => row.importerIndex === importer.economyIndex,
            );
            const hhi = partnerRows.reduce(
              (sum, row) =>
                sum + (row.value / importer.value) ** 2 * 10_000,
              0,
            );
            const leading = partnerRows.sort(
              (left, right) => right.value - left.value,
            )[0];
            return {
              importerIndex: importer.economyIndex,
              name: importer.name,
              hhi,
              topSupplierName: leading
                ? dataset.economies[leading.supplierIndex].name
                : "No suppliers",
            };
          })
          .sort((left, right) => right.hhi - left.hhi);

    const routes = validBilateral
      .map((row) => {
        const importerWorld = worldByImporter.get(row.importerIndex) || 0;
        return {
          ...row,
          id: `${row.supplierIndex}-${row.importerIndex}`,
          supplierName: dataset.economies[row.supplierIndex].name,
          importerName: dataset.economies[row.importerIndex].name,
          share: totalExported ? row.value / totalExported : 0,
          importerWorld,
          importerShare: importerWorld ? row.value / importerWorld : 0,
        };
      })
      .sort((left, right) => right.value - left.value);

    const fullSupplierTotals = storedSummary
      ? new Map(storedSummary.mapSupplierTotals || [])
      : supplierTotals;
    const mapNodeTotals = new Map();
    new Set([...worldByImporter.keys(), ...fullSupplierTotals.keys()]).forEach(
      (economyIndex) => {
        mapNodeTotals.set(economyIndex, {
          supplierValue: fullSupplierTotals.get(economyIndex) || 0,
          importerValue: worldByImporter.get(economyIndex) || 0,
        });
      },
    );

    return {
      totalImported,
      totalExported,
      reporters: storedSummary?.reporters ?? worldByImporter.size,
      overallHhi,
      importers,
      suppliers,
      importerHhi,
      routes,
      mapNodeTotals,
      sankeyResiduals: storedSummary?.sankeyResiduals || {},
    };
  }, [dataset, selectedProduct, year]);

  const legacyTrendAnalysis = useMemo(() => {
    if (!dataset || !selectedProduct || !eligibleTrendYears.length) return null;
    const productIndex = dataset.products.indexOf(selectedProduct);
    const worldIndex = dataset.economies.findIndex(
      (economy) => economy.name === "World",
    );
    const years = eligibleTrendYears.filter(
      (item) => item >= trendStartYear && item <= trendEndYear,
    );
    if (years.length < 2) return null;

    const storedTrend = null;
    if (storedTrend) {
      return {
        ...storedTrend,
        supplierShareChanges: storedTrend.supplierShareChanges.map((row) => ({
          ...row,
          name:
            row.key === "other"
              ? "Other suppliers"
              : dataset.economies[row.key].name,
        })),
      };
    }

    const productRecords = dataset.reportingViews.imports.records.filter(
      (record) => record[0] === productIndex,
    );
    const worldRecords = productRecords.filter(
      (record) => record[2] === worldIndex,
    );
    const bilateralRecords = productRecords.filter(
      (record) => record[2] !== worldIndex,
    );
    const yearIndexes = years.map((item) => dataset.years.indexOf(item));
    const comparableRecords = worldRecords.filter((record) =>
      yearIndexes.every((yearIndex) => {
        const value = record[3][yearIndex];
        return value !== null && value !== undefined;
      }),
    );
    const comparableImporters = new Set(
      comparableRecords.map((record) => record[1]),
    );
    const supplierSharesByYear = new Map();

    const series = years.map((item, index) => {
      const yearIndex = yearIndexes[index];
      const value = comparableRecords.reduce(
        (sum, record) => sum + (record[3][yearIndex] || 0),
        0,
      );
      const supplierTotals = new Map();
      bilateralRecords.forEach((record) => {
        const [, importerIndex, supplierIndex, values] = record;
        if (!comparableImporters.has(importerIndex)) return;
        const supplierValue = values[yearIndex];
        if (!Number.isFinite(supplierValue) || supplierValue <= 0) return;
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
      supplierSharesByYear.set(item, shares);
      const hhi = [...shares.values()].reduce(
        (sum, share) => sum + share ** 2 * 10_000,
        0,
      );
      return { year: item, value, growth: null, hhi };
    });

    series.forEach((point, index) => {
      if (!index) return;
      const priorValue = series[index - 1].value;
      point.growth = priorValue ? point.value / priorValue - 1 : null;
    });

    const startShares = supplierSharesByYear.get(years[0]) || new Map();
    const endShares = supplierSharesByYear.get(years.at(-1)) || new Map();
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
        name: dataset.economies[supplierIndex].name,
        startShare: startShares.get(supplierIndex) || 0,
        endShare: endShares.get(supplierIndex) || 0,
      }),
    );
    if (leadingSupplierIndexes.length) {
      supplierShareChanges.push({
        key: "other",
        name: "Other suppliers",
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
    const intervals = years.at(-1) - years[0];
    const reporterCount = (yearItem) => {
      const yearIndex = dataset.years.indexOf(yearItem);
      return worldRecords.filter((record) => {
        const value = record[3][yearIndex];
        return value !== null && value !== undefined;
      }).length;
    };

    return {
      series,
      comparableCount: comparableRecords.length,
      startReporterCount: reporterCount(years[0]),
      endReporterCount: reporterCount(years.at(-1)),
      endGrowth: series.at(-1).growth,
      cagr:
        startValue > 0 && intervals > 0
          ? (endValue / startValue) ** (1 / intervals) - 1
          : null,
      hhiChange: series.at(-1).hhi - series[0].hhi,
      supplierShareChanges,
    };
  }, [
    dataset,
    eligibleTrendYears,
    selectedProduct,
    trendEndYear,
    trendStartYear,
  ]);

  const analysis = useMemo(() => {
    if (!dataset || !selectedProductIndexes.length) return null;
    const yearIndex = dataset.years.indexOf(year);
    if (yearIndex < 0) return null;
    return buildSnapshotAnalysis(
      dataset,
      reportingMode,
      selectedProductIndexes,
      yearIndex,
      countryEconomyIndex,
    );
  }, [countryEconomyIndex, dataset, reportingMode, selectedProductIndexes, year]);

  const trendAnalysis = useMemo(() => {
    if (!dataset || !selectedProductIndexes.length) return null;
    const years = eligibleTrendYears.filter(
      (item) => item >= trendStartYear && item <= trendEndYear,
    );
    if (years.length < 2) return null;
    return buildTrendAnalysis(
      dataset,
      reportingMode,
      selectedProductIndexes,
      years,
      countryEconomyIndex,
    );
  }, [
    dataset,
    eligibleTrendYears,
    reportingMode,
    countryEconomyIndex,
    selectedProductIndexes,
    trendEndYear,
    trendStartYear,
  ]);

  const selectedConnections = useMemo(() => {
    if (!analysis || selectedEconomyIndex === null) {
      return { all: analysis?.routes || [], imports: [], exports: [] };
    }
    const imports = analysis.routes.filter(
      (route) => route.importerIndex === selectedEconomyIndex,
    );
    const exports = analysis.routes.filter(
      (route) => route.supplierIndex === selectedEconomyIndex,
    );
    return {
      all: [...imports, ...exports].sort(
        (left, right) => right.value - left.value,
      ),
      imports,
      exports,
    };
  }, [analysis, selectedEconomyIndex]);
  const mapFlows = useMemo(() => {
    if (!analysis) return [];
    const routes =
      selectedEconomyIndex === null
        ? analysis.routes
        : selectedConnections[connectionMode];
    return routes.slice(0, flowLimit);
  }, [
    analysis,
    connectionMode,
    flowLimit,
    selectedConnections,
    selectedEconomyIndex,
  ]);
  const sankeyFlows = useMemo(
    () => (analysis?.routes || []).slice(0, 100),
    [analysis],
  );
  const mapPayload = useMemo(
    () =>
      buildMapPayload(
        mapFlows,
        dataset?.economies || [],
        selectedEconomyIndex,
        analysis?.mapNodeTotals,
      ),
    [analysis?.mapNodeTotals, dataset, mapFlows, selectedEconomyIndex],
  );

  const selectedRoute = useMemo(
    () =>
      analysis?.routes.find((route) => route.id === selectedRouteId) || null,
    [analysis, selectedRouteId],
  );
  const selectedEconomy =
    selectedEconomyIndex === null
      ? null
      : dataset?.economies[selectedEconomyIndex] || null;
  const countryEconomy =
    countryEconomyIndex === null
      ? null
      : dataset?.economies[countryEconomyIndex] || null;
  const countryOptions = useMemo(
    () =>
      (dataset?.economies || [])
        .map((economy, economyIndex) => ({ ...economy, economyIndex }))
        .filter(
          (economy) =>
            economy.name !== "World" && economy.iso3 && !isSpecialEconomy(economy),
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [dataset],
  );
  useEffect(() => {
    mapPayloadRef.current = mapPayload;
  }, [mapPayload]);

  useEffect(() => {
    selectedEconomyIndexRef.current = selectedEconomyIndex;
  }, [selectedEconomyIndex]);

  useEffect(() => {
    reportingModeRef.current = reportingMode;
  }, [reportingMode]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return undefined;
    if (!canCreateWebGLContext()) {
      setMapError("WebGL is not available in this browser.");
      return undefined;
    }

    let map;
    try {
      map = new maplibregl.Map({
        container: mapContainer.current,
        style: JSON.parse(JSON.stringify(financeExplorerMapStyle)),
        center: [45, 22],
        zoom: 1.05,
        minZoom: 0.55,
        maxZoom: 8,
        attributionControl: true,
        renderWorldCopies: false,
      });
    } catch {
      setMapError("The map could not be initialized.");
      return undefined;
    }

    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      maxWidth: "300px",
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );

    const syncLayers = () => {
      try {
        syncTradeLayers(map, mapPayloadRef.current);
      } catch {
        // Map style events can fire before all sources are ready.
      }
    };

    map.on("load", () => {
      syncLayers();
      setMapReady(true);
      setMapError("");

      map.on("mousemove", "trade-flow-lines", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        map.getCanvas().style.cursor = "pointer";
        const props = feature.properties;
        popupRef.current
          ?.setLngLat(event.lngLat)
          .setHTML(
            `<div class="map-popup">
              <div class="map-popup__dot" style="background:#2563eb"></div>
              <div>
                <strong>${escapeHtml(props.supplier)} → ${escapeHtml(props.importer)}</strong>
                <span>Reported by the ${reportingModeRef.current === "exports" ? "exporting" : "importing"} economy</span>
                <p>${escapeHtml(formatUsdThousand(Number(props.value), 2))}</p>
              </div>
            </div>`,
          )
          .addTo(map);
      });

      map.on("mouseleave", "trade-flow-lines", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });

      map.on("click", "trade-flow-lines", (event) => {
        const nodeAtPoint = map.queryRenderedFeatures(event.point, {
          layers: ["trade-flow-nodes"],
        });
        if (nodeAtPoint.length) return;
        const id = event.features?.[0]?.properties?.id;
        if (id) setSelectedRouteId(id);
      });

      map.on("mousemove", "trade-flow-nodes", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const nodeSelectionLocked = selectedEconomyIndexRef.current !== null;
        map.getCanvas().style.cursor = nodeSelectionLocked ? "" : "pointer";
        const props = feature.properties;
        popupRef.current
          ?.setLngLat(feature.geometry.coordinates)
          .setHTML(
            `<div class="map-popup">
              <div class="map-popup__dot" style="background:#0f172a"></div>
              <div>
                <strong>${escapeHtml(props.name)}</strong>
                <span>${nodeSelectionLocked ? "Reset the map to select another economy" : "Click to focus on this economy's trade routes"}</span>
                <p>${escapeHtml(formatUsdThousand(Number(props.value), 2))}</p>
                <small>Total trade · Exports: ${escapeHtml(formatUsdThousand(Number(props.supplierValue), 2))}<br />Imports: ${escapeHtml(formatUsdThousand(Number(props.importerValue), 2))}</small>
              </div>
            </div>`,
          )
          .addTo(map);
      });

      map.on("mouseleave", "trade-flow-nodes", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });

      map.on("click", "trade-flow-nodes", (event) => {
        if (selectedEconomyIndexRef.current !== null) return;
        const economyIndex = Number(
          event.features?.[0]?.properties?.economyIndex,
        );
        if (!Number.isFinite(economyIndex)) return;
        popupRef.current?.remove();
        selectedEconomyIndexRef.current = economyIndex;
        setSelectedRouteId(null);
        setSelectedEconomyIndex(economyIndex);
        setConnectionMode("all");
      });
    });
    map.on("styledata", syncLayers);
    map.on("error", (event) => {
      const message = event?.error?.message?.toLowerCase() || "";
      if (message.includes("webgl")) {
        setMapError("WebGL is not available in this browser.");
      }
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [dataset]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    syncTradeLayers(mapRef.current, mapPayload);
    if (
      selectedRouteId &&
      !analysis?.routes.some((route) => route.id === selectedRouteId)
    ) {
      setSelectedRouteId(null);
    }
  }, [analysis, mapPayload, mapReady, selectedRouteId]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.setFilter("trade-flow-selected", [
      "==",
      ["get", "id"],
      selectedRouteId || "",
    ]);
  }, [mapReady, selectedRouteId]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.setFilter("trade-node-selected", [
      "==",
      ["get", "economyIndex"],
      selectedEconomyIndex ?? -1,
    ]);
  }, [mapReady, mapPayload, selectedEconomyIndex]);

  const fitView = useCallback(() => {
    if (!mapRef.current || !mapPayload.coordinates.length) return;
    const bounds = mapPayload.coordinates.reduce(
      (next, coordinate) => next.extend(coordinate),
      new maplibregl.LngLatBounds(
        mapPayload.coordinates[0],
        mapPayload.coordinates[0],
      ),
    );
    mapRef.current.fitBounds(bounds, {
      padding: window.innerWidth > 760 ? 48 : 24,
      maxZoom: 4.5,
      duration: 600,
    });
  }, [mapPayload.coordinates]);

  useEffect(() => {
    if (!mapReady || !mapPayload.coordinates.length) return undefined;
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
  }, [fitView, mapPayload.coordinates.length, mapReady]);

  const resetMapView = useCallback(() => {
    const hadEconomyFocus = selectedEconomyIndexRef.current !== null;
    selectedEconomyIndexRef.current = null;
    setSelectedEconomyIndex(null);
    setSelectedRouteId(null);
    setConnectionMode("all");
    if (!hadEconomyFocus) requestAnimationFrame(fitView);
  }, [fitView]);

  const selectSnapshotYear = (nextYear) => {
    setYear(nextYear);
    setSelectedRouteId(null);
    setSelectedEconomyIndex(null);
    setConnectionMode("all");
  };

  const switchAnalysisView = (nextView) => {
    setAnalysisView(nextView);
    if (nextView === "trends") setShowHhiInfo(false);
    requestAnimationFrame(() => {
      document.querySelector(".platform-module")?.scrollTo({
        top: 0,
        behavior: "auto",
      });
      if (nextView === "snapshot") mapRef.current?.resize();
    });
  };

  const resetFilters = () => {
    const defaultProduct =
      dataset?.products.find((product) => product.code === DEFAULT_PRODUCT) ||
      dataset?.products[0];
    const trendRange = defaultTrendRange(
      dataset?.years || [2024],
      defaultProduct,
    );
    setProductCodes([defaultProduct?.code || DEFAULT_PRODUCT]);
    setReportingMode("imports");
    setYear(Math.max(...(dataset?.years || [2024])));
    setFlowLimit(DEFAULT_FLOW_LIMIT);
    setTrendStartYear(trendRange.start);
    setTrendEndYear(trendRange.end);
    setSelectedTrendYear(null);
    setSelectedRouteId(null);
    setSelectedEconomyIndex(null);
    setConnectionMode("all");
    setCountryEconomyIndex(null);
    setFlowView("map");
    setSankeyEconomyIndex(null);
  };

  if (loadError) {
    return <div className="application-loading">{loadError}</div>;
  }
  if (!dataset || !analysis || !selectedProduct) {
    return <div className="application-loading">Loading trade data…</div>;
  }

  const hhi = hhiBand(analysis.overallHhi);
  const defaultRange = defaultTrendRange(dataset.years, {
    availableFrom: Math.max(
      ...effectiveProducts.map(
        (product) =>
          product.availableFrom || product.activeFrom || Math.min(...dataset.years),
      ),
    ),
  });
  const hasFilters =
    productCodes.length !== 1 ||
    productCodes[0] !== DEFAULT_PRODUCT ||
    reportingMode !== "imports" ||
    countryEconomyIndex !== null ||
    flowView !== "map" ||
    (analysisView === "trends"
      ? trendStartYear !== defaultRange.start ||
        trendEndYear !== defaultRange.end ||
        selectedTrendYear !== null
      : year !== Math.max(...dataset.years) ||
        flowLimit !== DEFAULT_FLOW_LIMIT ||
        selectedEconomyIndex !== null);

  return (
    <div className="app-shell">
      <header className="top-header">
        <div className="top-header-content">
          <div className="top-header-logo">
            <img
              src={assetUrl("ato-observatory-logo.svg")}
              alt="Asian Transport Observatory"
            />
          </div>
        </div>
      </header>

      <main className="workspace">
        <section
          className={`filter-bar filter-bar--${analysisView}${filtersOpen ? " filter-bar--open" : ""}`}
          aria-label="Trade dashboard filters"
        >
          <button
            type="button"
            className="mobile-filter-summary"
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
          >
            <span>
              <strong>Filters</strong>
              <small>
                {selectedProductLabel} · {reportingMode === "exports" ? "Exports" : "Imports"} · {analysisView === "snapshot" ? year : `${trendStartYear}–${trendEndYear}`} · {countryEconomy?.name || "All economies"}
              </small>
            </span>
            <ChevronDown size={16} />
          </button>
          <div className="filter-section filter-section--scope">
            <span className="filter-section__label">Scope</span>
          <ProductSelect
            groups={productGroups}
            selectedCode={productCode}
            onChange={selectProductCode}
          />

          <label className="select-wrap select-wrap--country">
            <span>Economy</span>
            <select
              value={countryEconomyIndex ?? ""}
              onChange={(event) => {
                const nextValue = event.target.value;
                setCountryEconomyIndex(nextValue === "" ? null : Number(nextValue));
                setSelectedRouteId(null);
                setSelectedEconomyIndex(null);
                setConnectionMode("all");
              }}
              aria-label="Economy"
            >
              <option value="">All economies</option>
              {countryOptions.map((economy) => (
                <option key={economy.economyIndex} value={economy.economyIndex}>
                  {economy.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>

          <div className="reporting-mode-filter" aria-label="Reporting basis">
              <span>Reporting basis</span>
              <div>
                <Segment
                  active={reportingMode === "imports"}
                  onClick={() => {
                    setReportingMode("imports");
                    setSelectedRouteId(null);
                    setSelectedEconomyIndex(null);
                  }}
                >
                  Imports
                </Segment>
                <Segment
                  active={reportingMode === "exports"}
                  onClick={() => {
                    setReportingMode("exports");
                    setSelectedRouteId(null);
                    setSelectedEconomyIndex(null);
                  }}
                >
                  Exports
                </Segment>
              </div>
          </div>
          </div>

          <div className="filter-section filter-section--display">
            <span className="filter-section__label">Time and display</span>
          <div className="analysis-mode-filter" aria-label="Analysis mode">
            <span>View</span>
            <div>
              <Segment
                active={analysisView === "snapshot"}
                onClick={() => switchAnalysisView("snapshot")}
              >
                Snapshot
              </Segment>
              <Segment
                active={analysisView === "trends"}
                onClick={() => switchAnalysisView("trends")}
              >
                Trends
              </Segment>
            </div>
          </div>
          {analysisView === "snapshot" ? (
            <>
              <label className="select-wrap select-wrap--year">
                <span>Reporting year</span>
                <select
                  value={year}
                  onChange={(event) => {
                    selectSnapshotYear(Number(event.target.value));
                  }}
                  aria-label="Snapshot year"
                >
                  {[...dataset.years].reverse().map((item) => {
                    const availableFrom = Math.max(
                      ...effectiveProducts.map(
                        (product) =>
                          product.availableFrom ||
                          product.activeFrom ||
                          Math.min(...dataset.years),
                      ),
                    );
                    const unavailable = item < availableFrom;
                    return (
                      <option key={item} value={item} disabled={unavailable}>
                        {item}{unavailable ? " · unavailable" : ""}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown size={15} />
              </label>

              <div className="flow-filter" aria-label="Flows displayed on map">
                <span>Routes shown</span>
                <div>
                  {[25, 50, 100].map((limit) => (
                    <Segment
                      key={limit}
                      active={flowLimit === limit}
                      onClick={() => setFlowLimit(limit)}
                    >
                      <span className="flow-prefix">Top </span>
                      {limit}
                    </Segment>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <label className="select-wrap select-wrap--year">
                <span>Start year</span>
                <select
                  value={trendStartYear}
                  onChange={(event) => {
                    setTrendStartYear(Number(event.target.value));
                    setSelectedTrendYear(null);
                  }}
                  aria-label="Trend start year"
                >
                  {eligibleTrendYears
                    .filter((item) => item < trendEndYear)
                    .map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                </select>
                <ChevronDown size={15} />
              </label>
              <label className="select-wrap select-wrap--year">
                <span>End year</span>
                <select
                  value={trendEndYear}
                  onChange={(event) => {
                    setTrendEndYear(Number(event.target.value));
                    setSelectedTrendYear(null);
                  }}
                  aria-label="Trend end year"
                >
                  {eligibleTrendYears
                    .filter((item) => item > trendStartYear)
                    .map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                </select>
                <ChevronDown size={15} />
              </label>
            </>
          )}

          <button
            className="reset-button"
            type="button"
            onClick={resetFilters}
            disabled={!hasFilters}
            aria-label="Reset filters"
            title="Reset filters"
          >
            <FilterX size={16} />
            <span>Reset</span>
          </button>
          </div>
        </section>

        <div className="content">
          <header className="page-header">
            <div>
              <h1>
                {countryEconomy ? `${countryEconomy.name} · ` : ""}
                {`${reportingMode === "exports" ? "Export" : "Import"} ${
                  analysisView === "snapshot" ? "trade snapshot" : "trends"
                }`}
              </h1>
              {analysisView === "snapshot" ? (
                <p>
                  {selectedProductLabel} · {year} · {reportingMode === "exports" ? "exporter" : "importer"}-reported data{countryEconomy ? ` for ${countryEconomy.name}` : ` from ${analysis.reporters} economies`}
                </p>
              ) : (
                <p>
                  {selectedProductLabel} · {trendStartYear}–{trendEndYear}{countryEconomy ? ` · ${countryEconomy.name}` : " · economies with complete annual data"}
                </p>
              )}
            </div>
          </header>

          <div
            className="analysis-view snapshot-view"
            hidden={analysisView !== "snapshot"}
          >
          <section className="kpi-grid" aria-label="Headline indicators">
            <KpiCard
              label={`Reported ${reportingMode}`}
              value={formatUsdThousand(analysis.totalReported)}
              subtext={countryEconomy ? `${countryEconomy.name} World total` : `World totals from ${analysis.reporters} economies`}
            />
            <KpiCard
              label={`${reportingMode === "exports" ? "Destination" : "Supplier"} concentration (HHI)`}
              value={formatHhi(analysis.overallHhi)}
              subtext={analysis.concentrationAvailable || !countryEconomy
                ? countryEconomy
                  ? `${hhi.label} for ${countryEconomy.name} · Herfindahl–Hirschman Index`
                  : `${hhi.label} · Herfindahl–Hirschman Index`
                : "Herfindahl–Hirschman Index requires one HS product"}
            >
              <button
                className="kpi-info-button"
                type="button"
                onClick={() => setShowHhiInfo((current) => !current)}
                aria-expanded={showHhiInfo}
              >
                <Info size={14} />
                About HHI
              </button>
            </KpiCard>
          </section>

          {showHhiInfo ? (
            <div className="hhi-info-card">
              <Info size={16} />
              <div className="hhi-info-content">
                <p>
                  The Herfindahl–Hirschman Index (HHI) shows how trade is distributed across {reportingMode === "exports" ? "destinations" : "suppliers"}.
                  It ranges from 0 to 10,000; higher values indicate greater
                  concentration. The bands used here are below 1,000 (low),
                  1,000–1,800 (moderate), and above 1,800 (high). HHI alone does
                  not measure trade risk.
                </p>
                <a
                  href="https://www.justice.gov/atr/herfindahl-hirschman-index"
                  target="_blank"
                  rel="noreferrer"
                >
                  U.S. Department of Justice HHI guidance
                </a>
              </div>
              <button
                type="button"
                onClick={() => setShowHhiInfo(false)}
                aria-label="Close HHI explanation"
              >
                <X size={15} />
              </button>
            </div>
          ) : null}

          <div className="flow-view-toolbar" aria-label="Flow presentation">
            <div className="flow-view-tabs">
              {[
                ["map", "Map"],
                ["table", "Table"],
              ].map(([viewName, label]) => (
                <Segment
                  key={viewName}
                  active={flowView === viewName}
                  onClick={() => {
                    setFlowView(viewName);
                    if (viewName === "map") {
                      requestAnimationFrame(() => mapRef.current?.resize());
                    }
                  }}
                >
                  {label}
                </Segment>
              ))}
            </div>
            <span>{Math.min(flowLimit, analysis.routes.length)} routes in the map and table</span>
          </div>

          <section className="map-card" hidden={flowView !== "map"}>
            <div ref={mapContainer} className="map-container" />
            <div className="map-toolbar">
              <button className="fit-button" type="button" onClick={fitView}>
                <Maximize2 size={15} />
                Fit routes
              </button>
              <button className="fit-button" type="button" onClick={resetMapView}>
                <RotateCcw size={15} />
                Reset map
              </button>
              <span className="map-node-instruction">
                {selectedEconomy
                  ? "Reset the map to select another economy."
                  : "Click an economy to focus on its trade routes."}
              </span>
            </div>
            <div className="result-pill">
              {selectedEconomy
                ? connectionMode === "imports"
                  ? `${mapPayload.lines.features.length} imports to ${selectedEconomy.name}`
                  : connectionMode === "exports"
                    ? `${mapPayload.lines.features.length} exports from ${selectedEconomy.name}`
                    : `${mapPayload.lines.features.length} routes for ${selectedEconomy.name}`
                : `${mapPayload.lines.features.length} routes shown`}
            </div>
            {selectedEconomy ? (
              <div
                className="connection-mode-filter"
                aria-label={`Connections for ${selectedEconomy.name}`}
              >
                <span>Connection type</span>
                <div>
                  {[
                    ["all", "All", selectedConnections.all.length],
                    ["imports", "Imports", selectedConnections.imports.length],
                    ["exports", "Exports", selectedConnections.exports.length],
                  ].map(([mode, label, count]) => (
                    <Segment
                      key={mode}
                      active={connectionMode === mode}
                      disabled={!count}
                      onClick={() => setConnectionMode(mode)}
                    >
                      {label} ({count})
                    </Segment>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="legend">
              <strong>Map key</strong>
              {selectedEconomy ? (
                <>
                  <span>
                    <i className="legend-line legend-line--import" />
                    Imports to {selectedEconomy.name}
                  </span>
                  <span>
                    <i className="legend-line legend-line--export" />
                    Exports from {selectedEconomy.name}
                  </span>
                </>
              ) : null}
              <span><i className="legend-supplier" />Supplier economy</span>
              <span><i className="legend-importer" />Importing economy</span>
              <span><i className="legend-both" />Both roles</span>
              <small>
                {selectedEconomy
                  ? "Node size shows total trade. Blue routes are imports to the selected economy; orange routes are exports from it. Reset the map to select another economy."
                  : `Click an economy to show its routes. Node size shows total trade; line width shows the ${reportingMode === "exports" ? "exporter" : "importer"}-reported value.`}
              </small>
            </div>
            <RouteDetail
              route={selectedRoute}
              productLabel={selectedProductLabel}
              reportingMode={reportingMode}
              year={year}
              onClose={() => setSelectedRouteId(null)}
            />
            {!mapReady && !mapError ? (
              <div className="map-loading">
                <span />
                Loading trade map…
              </div>
            ) : null}
            {mapError ? (
              <div className="map-error">
                <strong>Map unavailable</strong>
                <span>{mapError}</span>
              </div>
            ) : null}
          </section>

          <div hidden={flowView !== "table"}>
            <Panel
              title="Largest bilateral trade flows"
              subtitle={`${year} · ${reportingMode === "exports" ? "exporter" : "importer"}-reported values`}
              className="routes-panel flow-table-panel"
            >
              <RouteTable
                rows={analysis.routes.slice(0, flowLimit)}
                onSelect={(routeId) => {
                  setSelectedEconomyIndex(null);
                  setConnectionMode("all");
                  setSelectedRouteId(routeId);
                  setFlowView("map");
                }}
              />
            </Panel>
          </div>

          <Panel
            title="Bilateral trade structure"
            subtitle="Largest partners are named; all other trade is grouped under Other economies"
            className="sankey-panel sankey-panel--standalone"
          >
            <div className="sankey-basis-note">
              Includes all reported trade. The route limit applies only to the map and table.
            </div>
            <TradeSankey
              routes={sankeyFlows}
              economies={dataset.economies}
              selectedEconomyIndex={sankeyEconomyIndex}
              residualRows={
                countryEconomyIndex === null && effectiveProducts.length === 1
                  ? analysis.sankeyResiduals?.[100] || []
                  : []
              }
              totalValue={
                countryEconomyIndex === null
                  ? analysis.totalBilateral
                  : analysis.totalReported
              }
              onSelectEconomy={(economyIndex) => {
                setSankeyEconomyIndex((current) =>
                  current === economyIndex ? null : economyIndex,
                );
              }}
            />
          </Panel>

          <div className="two-column-grid">
            <Panel
              title={countryEconomy ? "Reporting economy" : `Leading ${reportingMode === "exports" ? "exporting" : "importing"} economies`}
              subtitle={countryEconomy ? `${reportingMode === "exports" ? "Exporter" : "Importer"}-reported World total` : "Reported World totals"}
            >
              <RankingBars
                rows={analysis.reporterRanking.slice(0, 10)}
                color="#2563eb"
              />
            </Panel>
            <Panel
              title={reportingMode === "exports" ? "Leading destinations" : "Leading suppliers"}
              subtitle={countryEconomy ? `Partners reported by ${countryEconomy.name}` : `${reportingMode === "exports" ? "Exporter" : "Importer"}-reported bilateral values`}
            >
              <RankingBars
                rows={analysis.partnerRanking.slice(0, 10)}
                color="#d97706"
              />
            </Panel>
          </div>

          {analysis.concentrationAvailable ? (
            <details className="concentration-detail">
              <summary>
                <span>
                  <strong>{reportingMode === "exports" ? "Destination concentration by exporter (HHI)" : "Supplier concentration by importer (HHI)"}</strong>
                  <small>20 largest reporting economies by trade value</small>
                </span>
                <ChevronDown size={18} />
              </summary>
              <div className="concentration-detail__body">
                <HhiChart
                  rows={analysis.reporterHhi.slice(0, 20)}
                  reporterLabel={reportingMode === "exports" ? "exporter" : "importer"}
                />
              </div>
            </details>
          ) : (
            <div className="concentration-availability-note">
              Economy-level concentration is available when one HS product code is selected.
            </div>
          )}
          </div>

          <div
            className="analysis-view trends-view"
            hidden={analysisView !== "trends"}
          >
            {trendAnalysis ? (
              <TrendSection
                analysis={trendAnalysis}
                startYear={trendStartYear}
                endYear={trendEndYear}
                selectedYear={selectedTrendYear}
                onSelectYear={setSelectedTrendYear}
                reporterName={countryEconomy?.name}
                reportingMode={reportingMode}
              />
          ) : (
            <div className="empty-state">No trend data available.</div>
            )}
          </div>

          <footer className="page-footer">
            <div>
              <strong>Asian Transport Observatory</strong>
              <span>
                Source: {dataset.meta?.source || "UN Comtrade"}. Annual
                {` ${reportingMode === "exports" ? "exporter" : "importer"}-reported trade`}, current US$ thousands. HS classifications follow the reporting year.
              </span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
