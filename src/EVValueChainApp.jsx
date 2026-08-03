// Generated from the EV value-chain application by scripts/sync_ev_module.mjs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { ResponsiveContainer, Sankey } from "recharts";
import {
  ChevronDown,
  FilterX,
  Info,
  Maximize2,
  X,
} from "lucide-react";
import { financeExplorerMapStyle } from "./financeExplorerMapStyle";

const BASE_URL = import.meta.env.BASE_URL || "/";
const DEFAULT_PRODUCT = "870380";
const DEFAULT_FLOW_LIMIT = 50;

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

function formatHhi(value) {
  return Math.round(value || 0).toLocaleString("en-US");
}

function hhiBand(value) {
  if (value < 1000) return { label: "Low concentration", tone: "low" };
  if (value <= 1800) return { label: "Moderate concentration", tone: "medium" };
  return { label: "High concentration", tone: "high" };
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

function buildMapPayload(flows, economies, selectedEconomyIndex = null) {
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
    const role =
      node.supplierValue > 0 && node.importerValue > 0
        ? "both"
        : node.supplierValue > 0
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
        value: node.supplierValue + node.importerValue,
      },
    };
  });

  return {
    lines: { type: "FeatureCollection", features: lineFeatures },
    nodes: { type: "FeatureCollection", features: nodeFeatures },
    coordinates: nodeFeatures.map((feature) => feature.geometry.coordinates),
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

function RankingBars({ rows, color }) {
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) {
    return <div className="empty-state">No reported values for this view.</div>;
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
      onClick={() => onSelect?.(payload?.economyIndex)}
      style={{ cursor: "pointer" }}
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
      subtitle: "Reported bilateral trade in the current map view",
    };
  }
  const node = entry.payload;
  return {
    x: entry.x + entry.width / 2,
    y: entry.y + entry.height / 2,
    title: node?.name || "Trade economy",
    value: formatUsdThousand(node?.totalValue || 0),
    subtitle:
      node?.role === "supplier"
        ? "Supplier shipments in displayed links"
        : "Reported imports in displayed links",
  };
}

function TradeSankey({
  routes,
  economies,
  selectedEconomyIndex,
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

    const connectedSuppliers = supplierIndexes.filter((economyIndex) =>
      visibleSupplierTotals.has(economyIndex),
    );
    const connectedImporters = importerIndexes.filter((economyIndex) =>
      visibleImporterTotals.has(economyIndex),
    );
    const nodes = [
      ...connectedSuppliers.map((economyIndex, index) => ({
        name: economies[economyIndex]?.name || "Unknown",
        role: "supplier",
        economyIndex,
        totalValue: visibleSupplierTotals.get(economyIndex),
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

    return {
      nodes,
      links,
      maximumColumnNodes: Math.max(
        connectedSuppliers.length,
        connectedImporters.length,
      ),
    };
  }, [economies, routes]);

  if (!sankeyData.links.length) {
    return <div className="empty-state">No mapped trade flows available.</div>;
  }

  const sankeyHeight = Math.max(
    520,
    sankeyData.maximumColumnNodes * (SANKEY_NODE_PADDING + 24) + 72,
  );
  const nodeRenderer = (props) => (
    <TradeFlowNode
      {...props}
      onSelect={onSelectEconomy}
      isActive={selectedEconomyIndex === props.payload?.economyIndex}
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

const STAGE_COLUMN_COLORS = [
  "#0F766E",
  "#0EA5E9",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#EA580C",
  "#10B981",
];
const STAGE_NAMES = {
  1: "Extraction",
  2: "Processing",
  3: "Battery materials",
  4: "Cells and battery packs",
  5: "Electric vehicles",
};
const STAGE_ROLES = [
  "Material scope",
  "Extraction supplier",
  "Processing economy",
  "Battery-material economy",
  "Cell and battery-pack economy",
  "Electric-vehicle exporter",
  "Final import destination",
];
const STAGE_MATERIAL_INDEX = {
  Cobalt: 0,
  Graphite: 1,
  Lithium: 2,
  "Shared downstream": 3,
};
const STAGE_NODE_PADDING = 24;

function formatComtradeUsd(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(digits)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(digits)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(digits)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(digits)}K`;
  return `$${value.toFixed(0)}`;
}

function stageCountryName(name) {
  return name;
}

function stageLinksFor(data, reportingSide, material, stage) {
  const materialIndex =
    stage <= 3
      ? STAGE_MATERIAL_INDEX[material]
      : STAGE_MATERIAL_INDEX["Shared downstream"];
  return data.links.filter(
    (link) =>
      link[0] === reportingSide &&
      link[1] === stage &&
      link[2] === materialIndex &&
      link[5] > 0,
  );
}

function stageTotalsByCountry(links, position) {
  const totals = new Map();
  links.forEach((link) => {
    totals.set(link[position], (totals.get(link[position]) || 0) + link[5]);
  });
  return totals;
}

function stageTopCountries(scores, countries, count = 3) {
  return [...scores.entries()]
    .filter(([index]) => !countries[index].special)
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([index]) => index);
}

function uniqueStageCountries(indexes) {
  return [...new Set(indexes)];
}

function stageDestinationsForExporter(links, exporterIndex, countries) {
  const totals = new Map();
  links.forEach((link) => {
    if (link[3] !== exporterIndex) return;
    totals.set(link[4], (totals.get(link[4]) || 0) + link[5]);
  });
  return stageTopCountries(totals, countries);
}

function stageScopeProfiles(data, reportingSide, material, fallbackTotals) {
  const groups = (data.scopeGroups || [])
    .map((group, groupIndex) => {
      const exporterTotals = new Map();
      (data.scopeLinks || []).forEach((link) => {
        if (link[0] !== reportingSide || link[1] !== groupIndex) return;
        exporterTotals.set(
          link[2],
          (exporterTotals.get(link[2]) || 0) + link[3],
        );
      });
      return {
        ...group,
        groupIndex,
        exporterTotals,
        total: [...exporterTotals.values()].reduce(
          (sum, value) => sum + value,
          0,
        ),
      };
    })
    .filter((group) => group.material === material && group.total > 0);

  if (groups.length) return groups;
  return [
    {
      id: `${material.toLowerCase()}-products`,
      material,
      name: `${material} products`,
      exporterTotals: fallbackTotals,
      total: [...fallbackTotals.values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
    },
  ];
}

function buildStageChain(data, reportingSide, material) {
  const profiles = [1, 2, 3, 4, 5].map((stage) => {
    const links = stageLinksFor(data, reportingSide, material, stage);
    return {
      stage,
      links,
      total: links.reduce((sum, link) => sum + link[5], 0),
    };
  });
  const exporterTotals = new Map();
  const importerTotals = new Map();
  profiles.forEach((profile) => {
    exporterTotals.set(profile.stage, stageTotalsByCountry(profile.links, 3));
    importerTotals.set(profile.stage, stageTotalsByCountry(profile.links, 4));
  });

  const scopeProfiles = stageScopeProfiles(
    data,
    reportingSide,
    material,
    exporterTotals.get(1),
  ).map((profile) => ({
    ...profile,
    leadingExporters: stageTopCountries(
      profile.exporterTotals,
      data.countries,
    ),
  }));

  const leadingExporters = new Map();
  leadingExporters.set(
    1,
    uniqueStageCountries(
      scopeProfiles.flatMap((profile) => profile.leadingExporters),
    ),
  );
  for (let stage = 2; stage <= 5; stage += 1) {
    leadingExporters.set(
      stage,
      stageTopCountries(exporterTotals.get(stage), data.countries),
    );
  }

  const leadingDestinations = new Map();
  const namedRouteSets = new Map();
  profiles.forEach((profile) => {
    const destinations = [];
    const namedRoutes = new Set();
    leadingExporters.get(profile.stage).forEach((exporterIndex) => {
      const selectedDestinations = stageDestinationsForExporter(
        profile.links,
        exporterIndex,
        data.countries,
      );
      selectedDestinations.forEach((importerIndex) => {
        destinations.push(importerIndex);
        namedRoutes.add(`${exporterIndex}|${importerIndex}`);
      });
    });
    leadingDestinations.set(
      profile.stage,
      uniqueStageCountries(destinations),
    );
    namedRouteSets.set(profile.stage, namedRoutes);
    profile.namedValue = profile.links.reduce(
      (sum, link) =>
        sum +
        (namedRoutes.has(`${link[3]}|${link[4]}`) ? link[5] : 0),
      0,
    );
    profile.namedCoverage = profile.total
      ? profile.namedValue / profile.total
      : 0;
  });

  const columnScores = new Map([[1, exporterTotals.get(1)]]);
  for (let depth = 2; depth <= 5; depth += 1) {
    const priorImports = importerTotals.get(depth - 1);
    const nextExports = exporterTotals.get(depth);
    const priorTotal = profiles[depth - 2].total || 1;
    const nextTotal = profiles[depth - 1].total || 1;
    const scores = new Map();
    new Set([...priorImports.keys(), ...nextExports.keys()]).forEach(
      (countryIndex) => {
        scores.set(
          countryIndex,
          (priorImports.get(countryIndex) || 0) / priorTotal +
            (nextExports.get(countryIndex) || 0) / nextTotal,
        );
      },
    );
    columnScores.set(depth, scores);
  }
  columnScores.set(6, importerTotals.get(5));

  const selected = new Map();
  selected.set(1, leadingExporters.get(1));
  for (let depth = 2; depth <= 5; depth += 1) {
    selected.set(
      depth,
      uniqueStageCountries([
        ...leadingDestinations.get(depth - 1),
        ...leadingExporters.get(depth),
      ]).sort(
        (left, right) =>
          (columnScores.get(depth).get(right) || 0) -
          (columnScores.get(depth).get(left) || 0),
      ),
    );
  }
  selected.set(6, leadingDestinations.get(5));
  const nodes = [];
  const nodeIndex = new Map();
  scopeProfiles.forEach((profile) => {
    const id = `0|scope|${profile.id}`;
    nodeIndex.set(id, nodes.length);
    nodes.push({
      id,
      name: profile.name,
      fullName: `${profile.name} in the selected HS6 scope`,
      depth: 0,
      kind: "scope",
      role: STAGE_ROLES[0],
      color: STAGE_COLUMN_COLORS[0],
      totalValue: 0,
    });
  });
  const nodeKey = (depth, countryIndex) => `${depth}|${countryIndex}`;

  for (let depth = 1; depth <= 6; depth += 1) {
    selected.get(depth).forEach((countryIndex) => {
      const country = data.countries[countryIndex];
      nodeIndex.set(nodeKey(depth, countryIndex), nodes.length);
      nodes.push({
        id: nodeKey(depth, countryIndex),
        name: stageCountryName(country.name),
        fullName: country.name,
        depth,
        kind: "country",
        role: STAGE_ROLES[depth],
        color: STAGE_COLUMN_COLORS[depth],
        totalValue: 0,
      });
    });
    nodeIndex.set(nodeKey(depth, "other"), nodes.length);
    nodes.push({
      id: nodeKey(depth, "other"),
      name: "Other economies",
      fullName: "Other economies and unselected routes",
      depth,
      kind: "other",
      role: STAGE_ROLES[depth],
      color: "#CBD5E1",
      totalValue: 0,
    });
  }

  const links = [];
  scopeProfiles.forEach((profile) => {
    const source = nodeIndex.get(`0|scope|${profile.id}`);
    const leadingSet = new Set(profile.leadingExporters);
    const rootGroups = new Map();
    profile.exporterTotals.forEach((value, countryIndex) => {
      const mapped = leadingSet.has(countryIndex) ? countryIndex : "other";
      rootGroups.set(mapped, (rootGroups.get(mapped) || 0) + value);
    });
    rootGroups.forEach((value, mapped) => {
      const target = nodeIndex.get(nodeKey(1, mapped));
      links.push({
        source,
        target,
        value: profiles[0].total ? (value / profiles[0].total) * 100 : 0,
        valueUsd: value,
        stage: 0,
        kind: mapped === "other" ? "scope-residual" : "scope-exporter",
        exporter: `${profile.name} scope`,
        importer: nodes[target].fullName,
        color: nodes[source].color,
      });
    });
  });

  profiles.forEach((profile) => {
    const grouped = new Map();
    const exporterSet = new Set(leadingExporters.get(profile.stage));
    const namedRoutes = namedRouteSets.get(profile.stage);
    profile.links.forEach((link) => {
      const isNamedExporter = exporterSet.has(link[3]);
      const isNamedRoute = namedRoutes.has(`${link[3]}|${link[4]}`);
      const sourceCountry = isNamedExporter ? link[3] : "other";
      const targetCountry = isNamedRoute ? link[4] : "other";
      const kind = isNamedRoute
        ? "named"
        : isNamedExporter
          ? "exporter-residual"
          : "stage-residual";
      const key = `${sourceCountry}|${targetCountry}|${kind}`;
      const current = grouped.get(key);
      if (current) current.valueUsd += link[5];
      else
        grouped.set(key, {
          sourceCountry,
          targetCountry,
          kind,
          valueUsd: link[5],
        });
    });

    grouped.forEach((row) => {
      const source = nodeIndex.get(
        nodeKey(profile.stage, row.sourceCountry),
      );
      const target = nodeIndex.get(
        nodeKey(profile.stage + 1, row.targetCountry),
      );
      links.push({
        source,
        target,
        value: profile.total ? (row.valueUsd / profile.total) * 100 : 0,
        valueUsd: row.valueUsd,
        stage: profile.stage,
        kind: row.kind,
        exporter: nodes[source].fullName,
        importer: nodes[target].fullName,
        color: nodes[source].color,
      });
    });
  });

  for (let depth = 2; depth <= 5; depth += 1) {
    selected.get(depth).forEach((countryIndex) => {
      const current = nodeIndex.get(nodeKey(depth, countryIndex));
      if (!links.some((link) => link.target === current)) {
        links.push({
          source: nodeIndex.get(nodeKey(depth - 1, "other")),
          target: current,
          value: 0.001,
          valueUsd: 0,
          stage: depth - 1,
          exporter: "",
          importer: "",
          color: "transparent",
          hidden: true,
        });
      }
      if (!links.some((link) => link.source === current)) {
        links.push({
          source: current,
          target: nodeIndex.get(nodeKey(depth + 1, "other")),
          value: 0.001,
          valueUsd: 0,
          stage: depth,
          exporter: "",
          importer: "",
          color: "transparent",
          hidden: true,
        });
      }
    });
  }

  nodes.forEach((node, index) => {
    const outgoing = links
      .filter((link) => !link.hidden && link.source === index)
      .reduce((sum, link) => sum + link.value, 0);
    const incoming = links
      .filter((link) => !link.hidden && link.target === index)
      .reduce((sum, link) => sum + link.value, 0);
    node.totalValue = Math.max(outgoing, incoming);
  });

  return {
    chart: { nodes, links },
    profiles,
    visibleLinks: links.filter((link) => !link.hidden && link.stage > 0)
      .length,
    selectedCountries: new Set([...selected.values()].flat()).size,
  };
}

function StageChainNode({
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
}) {
  const isScope = payload?.kind === "scope";
  const labelX = isScope ? x - 12 : x + width + 8;
  const lines = wrapSankeyLabel(payload?.name || `Node ${index + 1}`, 20);
  return (
    <g
      {...rest}
      className="stage-chain-node"
      data-stage-depth={payload?.depth}
      data-stage-name={payload?.name}
      onClick={() => onSelect(payload?.id)}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 4)}
        fill={payload?.color}
        fillOpacity={isDimmed ? 0.25 : 0.92}
        stroke={isActive ? "#0F172A" : "transparent"}
        strokeWidth={isActive ? 2 : 0}
        rx={3}
      />
      <text
        x={labelX}
        y={y + Math.max(height, 4) / 2}
        textAnchor={isScope ? "end" : "start"}
        dominantBaseline="middle"
        fill={isDimmed ? "#94A3B8" : "#334155"}
        stroke="#FFFFFF"
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {lines.map((line, lineIndex) => (
          <tspan
            key={`${payload?.id}-${lineIndex}`}
            x={labelX}
            dy={
              lineIndex === 0
                ? -((lines.length - 1) * 15) / 2
                : 15
            }
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function StageChainLink({
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
  isDimmed,
  isActive,
}) {
  if (payload?.hidden) return <path d="" />;
  const width = Math.max(linkWidth || 0, 1);
  const path = [
    `M${sourceX},${sourceY - width / 2}`,
    `C${sourceControlX},${sourceY - width / 2} ${targetControlX},${targetY - width / 2} ${targetX},${targetY - width / 2}`,
    `L${targetX},${targetY + width / 2}`,
    `C${targetControlX},${targetY + width / 2} ${sourceControlX},${sourceY + width / 2} ${sourceX},${sourceY + width / 2}`,
    "Z",
  ].join(" ");
  return (
    <path
      className={`${className || ""} stage-chain-link`.trim()}
      d={path}
      fill={payload?.color}
      fillOpacity={isDimmed ? 0.08 : isActive ? 0.76 : 0.5}
      stroke="none"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

function getStageHover(entry, type) {
  if (type === "link") {
    const link = entry?.payload || entry;
    if (link?.hidden || !link?.exporter || !link?.importer) return null;
    return {
      x: (entry.sourceX + entry.targetX) / 2,
      y: (entry.sourceY + entry.targetY) / 2,
      title: `${link.exporter} → ${link.importer}`,
      value: `${Number(link.value || 0).toFixed(1)}% · ${formatComtradeUsd(link.valueUsd)}`,
      subtitle:
        link.stage === 0
          ? "Share of upstream scope"
          : link.kind === "named"
            ? `${STAGE_NAMES[link.stage]} · UNCTAD-selected bilateral flow`
            : link.kind === "exporter-residual"
              ? `${STAGE_NAMES[link.stage]} · remaining destinations`
              : `${STAGE_NAMES[link.stage]} · remaining exporters and routes`,
    };
  }
  const node = entry.payload;
  return {
    x: entry.x + entry.width / 2,
    y: entry.y + entry.height / 2,
    title: node.fullName,
    value: `${Number(node.totalValue || 0).toFixed(1)}% of stage flow`,
    subtitle: node.role,
  };
}

export function StageValueChainSection({ data }) {
  const availableYears = data.years || [data.year];
  const [stageYear, setStageYear] = useState(() =>
    Math.max(...availableYears),
  );
  const [material, setMaterial] = useState("Cobalt");
  const [reportingSide, setReportingSide] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);
  const annualData = data.datasets?.[String(stageYear)] || data;
  const chain = useMemo(
    () => buildStageChain(annualData, reportingSide, material),
    [annualData, material, reportingSide],
  );
  const selectedNodeIndex = selectedNodeId
    ? chain.chart.nodes.findIndex((node) => node.id === selectedNodeId)
    : -1;
  const connectedNodeIndexes = new Set();
  if (selectedNodeIndex >= 0) {
    connectedNodeIndexes.add(selectedNodeIndex);
    chain.chart.links.forEach((link) => {
      if (link.hidden) return;
      if (link.source === selectedNodeIndex)
        connectedNodeIndexes.add(link.target);
      if (link.target === selectedNodeIndex)
        connectedNodeIndexes.add(link.source);
    });
  }
  const activeNode =
    selectedNodeIndex >= 0 ? chain.chart.nodes[selectedNodeIndex] : null;
  const reportingNoun = reportingSide === 0 ? "exports" : "imports";
  const columns = [
    ["Material scope", `${material} products`],
    ["Extraction", "Upstream suppliers"],
    ["Processing", "Refining economies"],
    ["Battery materials", "Active materials"],
    ["Cell components", "Cells and battery packs"],
    ["Electric vehicles", "Vehicle exporters"],
    ["End users", "Import destinations"],
  ];
  const nodeRenderer = (props) => {
    const nodeIndex = chain.chart.nodes.findIndex(
      (node) => node.id === props.payload?.id,
    );
    return (
      <StageChainNode
        {...props}
        onSelect={(id) =>
          setSelectedNodeId((current) => (current === id ? null : id))
        }
        isActive={props.payload?.id === selectedNodeId}
        isDimmed={
          selectedNodeIndex >= 0 && !connectedNodeIndexes.has(nodeIndex)
        }
      />
    );
  };
  const linkRenderer = (props) => {
    const connected =
      selectedNodeIndex < 0 ||
      props.payload?.source === selectedNodeIndex ||
      props.payload?.target === selectedNodeIndex;
    return (
      <StageChainLink
        {...props}
        isActive={selectedNodeIndex >= 0 && connected}
        isDimmed={!connected}
      />
    );
  };

  return (
    <section className="stage-overview-section" aria-labelledby="stage-overview-title">
      <header className="stage-overview-intro">
        <div>
          <h2 id="stage-overview-title">
            EV Value Chain
          </h2>
        </div>
        <div className="stage-overview-controls">
          <label>
            Year
            <select
              value={stageYear}
              onChange={(event) => {
                setStageYear(Number(event.target.value));
                setSelectedNodeId(null);
              }}
            >
              {[...availableYears]
                .sort((left, right) => right - left)
                .map((availableYear) => (
                  <option key={availableYear} value={availableYear}>
                    {availableYear}
                  </option>
                ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <label>
            Material focus
            <select
              value={material}
              onChange={(event) => {
                setMaterial(event.target.value);
                setSelectedNodeId(null);
              }}
            >
              <option>Cobalt</option>
              <option>Graphite</option>
              <option>Lithium</option>
            </select>
            <ChevronDown size={15} />
          </label>
          <label>
            Data reported by
            <select
              value={reportingSide}
              onChange={(event) => {
                setReportingSide(Number(event.target.value));
                setSelectedNodeId(null);
              }}
            >
              <option value={0}>Exporting economies</option>
              <option value={1}>Importing economies (mirror data)</option>
            </select>
            <ChevronDown size={15} />
          </label>
        </div>
      </header>

      <div className="stage-method-note">
        This interactive figure follows the value-chain Sankey approach
        presented in{" "}
        <a
          href="https://unctad.org/system/files/official-document/ditcmisc2023d1_en_0.pdf"
          target="_blank"
          rel="noreferrer"
        >
          UNCTAD’s <em>Technical note on critical minerals</em>
        </a>
        . Using bilateral HS6 UN Comtrade data, the chart shows the three leading
        exporters at each stage and their three largest destinations. Remaining
        flows are grouped under “Other economies,” and band width represents each
        bilateral flow’s share of the stage’s total exports.
      </div>

      <article className="stage-chain-panel">
        {activeNode ? (
          <div className="stage-chain-selection">
            Highlighting {activeNode.role.toLowerCase()}:{" "}
            <strong>{activeNode.fullName}</strong>
            <button type="button" onClick={() => setSelectedNodeId(null)}>
              Clear
            </button>
          </div>
        ) : null}
        <div className="stage-chain-scroll">
          <div className="stage-chain-inner">
            <div className="stage-column-headings">
              {columns.map(([heading, subtitle]) => (
                <div key={heading}>
                  <strong>{heading}</strong>
                  <span>{subtitle}</span>
                </div>
              ))}
            </div>
            <div className="stage-chain-rails" aria-hidden="true">
              {columns.map(([heading]) => <i key={heading} />)}
            </div>
            <div className="stage-chain-canvas">
              <ResponsiveContainer width="100%" height={690}>
                <Sankey
                  data={chain.chart}
                  nodePadding={STAGE_NODE_PADDING}
                  nodeWidth={14}
                  iterations={64}
                  linkCurvature={0.56}
                  sort={false}
                  margin={{ top: 34, right: 150, bottom: 24, left: 150 }}
                  node={nodeRenderer}
                  link={linkRenderer}
                  onMouseEnter={(entry, type) =>
                    setHoveredItem(getStageHover(entry, type))
                  }
                  onMouseLeave={() => setHoveredItem(null)}
                />
              </ResponsiveContainer>
              {hoveredItem ? (
                <div
                  className="stage-chain-tooltip"
                  style={{
                    left: Math.min(hoveredItem.x + 12, 1320),
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
        </div>
        <footer className="stage-chain-footer">
          <span>
            Band width shows share of stage {reportingNoun}
          </span>
          <div>
            {chain.profiles.map((profile) => (
              <span key={profile.stage}>
                <i style={{ background: STAGE_COLUMN_COLORS[profile.stage] }} />
                {STAGE_NAMES[profile.stage]}{" "}
                <strong>{formatComtradeUsd(profile.total)}</strong>
                <small>
                  {(profile.namedCoverage * 100).toFixed(0)}% named
                </small>
              </span>
            ))}
          </div>
        </footer>
      </article>
    </section>
  );
}

function HhiChart({ rows }) {
  if (!rows.length) {
    return <div className="empty-state">No importer HHI values available.</div>;
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
                <small>{row.topSupplierName}</small>
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
    return <div className="empty-state">No bilateral routes available.</div>;
  }
  return (
    <div className="route-table-wrap">
      <table className="route-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Supplier</th>
            <th />
            <th>Importing market</th>
            <th>Trade value</th>
            <th>Share of selected flows</th>
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

function RouteDetail({ route, product, year, onClose }) {
  if (!route) return null;
  return (
    <aside className="detail-panel" aria-label="Selected trade route">
      <div className="detail-header">
        <div>
          <h2>{route.supplierName} → {route.importerName}</h2>
          <p>HS {product.code} · {year}</p>
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
          <span>Reported bilateral import value</span>
          <strong>{formatDetailedUsd(route.value)}</strong>
        </div>
        <section className="detail-section">
          <h3>Route context</h3>
          <dl>
            <div>
              <dt>Share of selected bilateral flows</dt>
              <dd>{formatPercent(route.share)}</dd>
            </div>
            <div>
              <dt>Share of importer’s total</dt>
              <dd>{formatPercent(route.importerShare)}</dd>
            </div>
            <div>
              <dt>Importer World total</dt>
              <dd>{formatUsdThousand(route.importerWorld)}</dd>
            </div>
          </dl>
        </section>
        <section className="detail-section">
          <h3>Interpretation</h3>
          <p>
            The supplier is reported by the importing economy. This is not the
            supplier’s complete global export value.
          </p>
        </section>
      </div>
    </aside>
  );
}

export default function EVValueChainApp() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const mapPayloadRef = useRef(buildMapPayload([], []));
  const [dataset, setDataset] = useState(null);
  const [stageDataset, setStageDataset] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [productCode, setProductCode] = useState(DEFAULT_PRODUCT);
  const [year, setYear] = useState(2023);
  const [flowLimit, setFlowLimit] = useState(DEFAULT_FLOW_LIMIT);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [selectedEconomyIndex, setSelectedEconomyIndex] = useState(null);
  const [connectionMode, setConnectionMode] = useState("all");
  const [showHhiInfo, setShowHhiInfo] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(assetUrl("data/ev-trade-flows.json")),
      fetch(assetUrl("data/comtrade-ev-bilateral.json")),
    ])
      .then(async ([tradeResponse, stageResponse]) => {
        if (!tradeResponse.ok || !stageResponse.ok) {
          throw new Error("The Comtrade datasets could not be loaded.");
        }
        return Promise.all([tradeResponse.json(), stageResponse.json()]);
      })
      .then(([payload, stagePayload]) => {
        setDataset(payload);
        setStageDataset(stagePayload);
        const defaultProduct = payload.products.find(
          (product) => product.code === DEFAULT_PRODUCT,
        );
        setProductCode(defaultProduct?.code || payload.products[0]?.code);
        setYear(Math.max(...payload.years));
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  const selectedProduct = useMemo(
    () =>
      dataset?.products.find((product) => product.code === productCode) || null,
    [dataset, productCode],
  );

  const analysis = useMemo(() => {
    if (!dataset || !selectedProduct) return null;
    const productIndex = dataset.products.indexOf(selectedProduct);
    const yearIndex = dataset.years.indexOf(year);
    const worldIndex = dataset.economies.findIndex(
      (economy) => economy.name === "World",
    );
    const worldByImporter = new Map();
    const bilateral = [];

    dataset.records.forEach((record) => {
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
    const totalImported = [...worldByImporter.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const totalExported = validBilateral.reduce(
      (sum, row) => sum + row.value,
      0,
    );
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

    const importers = [...worldByImporter.entries()]
      .filter(([, value]) => value > 0)
      .map(([economyIndex, value]) => ({
        economyIndex,
        name: dataset.economies[economyIndex].name,
        iso3: dataset.economies[economyIndex].iso3,
        value,
        share: totalImported ? value / totalImported : 0,
      }))
      .sort((left, right) => right.value - left.value);

    const suppliers = [...supplierTotals.entries()]
      .map(([economyIndex, value]) => ({
        economyIndex,
        name: dataset.economies[economyIndex].name,
        iso3: dataset.economies[economyIndex].iso3,
        value,
        share: totalExported ? value / totalExported : 0,
      }))
      .sort((left, right) => right.value - left.value);

    const overallHhi = suppliers.reduce(
      (sum, supplier) => sum + supplier.share ** 2 * 10_000,
      0,
    );

    const importerHhi = importers
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

    return {
      totalImported,
      totalExported,
      reporters: worldByImporter.size,
      overallHhi,
      importers,
      suppliers,
      importerHhi,
      routes,
    };
  }, [dataset, selectedProduct, year]);

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
  const mapPayload = useMemo(
    () =>
      buildMapPayload(
        mapFlows,
        dataset?.economies || [],
        selectedEconomyIndex,
      ),
    [dataset, mapFlows, selectedEconomyIndex],
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

  useEffect(() => {
    mapPayloadRef.current = mapPayload;
  }, [mapPayload]);

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
                <span>Importer-reported bilateral flow</span>
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
        map.getCanvas().style.cursor = "pointer";
        const props = feature.properties;
        popupRef.current
          ?.setLngLat(feature.geometry.coordinates)
          .setHTML(
            `<div class="map-popup">
              <div class="map-popup__dot" style="background:#0f172a"></div>
              <div>
                <strong>${escapeHtml(props.name)}</strong>
                <span>Click to show connected trade flows</span>
                <p>${escapeHtml(formatUsdThousand(Number(props.value), 2))}</p>
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
        const economyIndex = Number(
          event.features?.[0]?.properties?.economyIndex,
        );
        if (!Number.isFinite(economyIndex)) return;
        popupRef.current?.remove();
        setSelectedRouteId(null);
        setConnectionMode("all");
        setSelectedEconomyIndex((current) =>
          current === economyIndex ? null : economyIndex,
        );
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

  const resetFilters = () => {
    setProductCode(DEFAULT_PRODUCT);
    setYear(Math.max(...(dataset?.years || [2023])));
    setFlowLimit(DEFAULT_FLOW_LIMIT);
    setSelectedRouteId(null);
    setSelectedEconomyIndex(null);
    setConnectionMode("all");
  };

  if (loadError) {
    return <div className="application-loading">{loadError}</div>;
  }
  if (!dataset || !stageDataset || !analysis || !selectedProduct) {
    return <div className="application-loading">Loading trade-flow data…</div>;
  }

  const hhi = hhiBand(analysis.overallHhi);
  const hasFilters =
    productCode !== DEFAULT_PRODUCT ||
    year !== Math.max(...dataset.years) ||
    flowLimit !== DEFAULT_FLOW_LIMIT ||
    selectedEconomyIndex !== null;
  const upstreamProducts = dataset.products.filter(
    (product) => product.stage < 4,
  );
  const directEvProducts = dataset.products.filter(
    (product) => product.stage >= 4,
  );

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
        <section className="filter-bar" aria-label="Trade dashboard filters">
          <label className="select-wrap select-wrap--product">
            <span>Product code</span>
            <select
              value={productCode}
              onChange={(event) => {
                setProductCode(event.target.value);
                setSelectedRouteId(null);
                setSelectedEconomyIndex(null);
                setConnectionMode("all");
              }}
              aria-label="Product code"
            >
              <optgroup label="Upstream minerals and material inputs">
                {upstreamProducts.map((product) => (
                  <option key={product.code} value={product.code}>
                    HS {product.code} · {product.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="EV value-chain — batteries and vehicles">
                {directEvProducts.map((product) => (
                  <option key={product.code} value={product.code}>
                    HS {product.code} · {product.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <ChevronDown size={15} />
          </label>

          <label className="select-wrap">
            <span>Reporting year</span>
            <select
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value));
                setSelectedRouteId(null);
                setSelectedEconomyIndex(null);
                setConnectionMode("all");
              }}
              aria-label="Reporting year"
            >
              {[...dataset.years].reverse().map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>

          <div className="flow-filter" aria-label="Flows displayed on map">
            <span>Map flows</span>
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

          <button
            className="reset-button"
            type="button"
            onClick={resetFilters}
            disabled={!hasFilters}
          >
            <FilterX size={16} />
            <span>Reset</span>
          </button>
        </section>

        <div className="content">
          <header className="page-header">
            <div>
              <h1>EV value-chain product trade flows</h1>
              <p>
                Importer-reported trade for covered reporting markets; suppliers
                may be worldwide · {analysis.reporters} reporting markets with
                data in {year}
              </p>
            </div>
          </header>

          <section className="kpi-grid" aria-label="Headline indicators">
            <KpiCard
              label="Reported imports"
              value={formatUsdThousand(analysis.totalImported)}
              subtext={`${analysis.reporters} reporting markets · World totals`}
            />
            <KpiCard
              label="Supplier concentration"
              value={formatHhi(analysis.overallHhi)}
              subtext={`${hhi.label} · covered markets`}
            >
              <button
                className="kpi-info-button"
                type="button"
                onClick={() => setShowHhiInfo((current) => !current)}
                aria-expanded={showHhiInfo}
              >
                <Info size={14} />
                What is HHI?
              </button>
            </KpiCard>
          </section>

          {showHhiInfo ? (
            <div className="hhi-info-card">
              <Info size={16} />
              <div className="hhi-info-content">
                <p>
                  HHI is the sum of squared supplier shares on a 0–10,000
                  scale. A higher score means imports rely more heavily on
                  fewer supplier economies. The guide used here is: below
                  1,000 = low concentration, 1,000–1,800 = moderate, and
                  above 1,800 = high. These market-concentration thresholds
                  are adapted as a descriptive guide to supplier dependence;
                  they are not an antitrust assessment.
                </p>
                <a
                  href="https://www.justice.gov/atr/herfindahl-hirschman-index"
                  target="_blank"
                  rel="noreferrer"
                >
                  Method and thresholds: U.S. Department of Justice
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

          <section className="map-card">
            <div ref={mapContainer} className="map-container" />
            <div className="map-toolbar">
              <button className="fit-button" type="button" onClick={fitView}>
                <Maximize2 size={15} />
                Fit trade network
              </button>
            </div>
            <div className="result-pill">
              {selectedEconomy
                ? connectionMode === "imports"
                  ? `${mapPayload.lines.features.length} import routes into ${selectedEconomy.name}`
                  : connectionMode === "exports"
                    ? `${mapPayload.lines.features.length} export routes from ${selectedEconomy.name}`
                    : `${mapPayload.lines.features.length} routes connected to ${selectedEconomy.name}`
                : `${mapPayload.lines.features.length} mapped routes · top ${Math.min(
                    flowLimit,
                    analysis.routes.length,
                  )} flows`}
            </div>
            {selectedEconomy ? (
              <div className="node-selection-pill">
                <span>
                  Showing trade to and from <strong>{selectedEconomy.name}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEconomyIndex(null);
                    setConnectionMode("all");
                  }}
                  aria-label="Clear selected country"
                >
                  <X size={15} />
                </button>
              </div>
            ) : null}
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
              <strong>Trade-flow map</strong>
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
                  ? "Blue lines end in the selected economy; orange lines start there. Line width represents reported value."
                  : "Line width represents importer-reported bilateral value. Click a country to distinguish its import and export connections."}
              </small>
            </div>
            <RouteDetail
              route={selectedRoute}
              product={selectedProduct}
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

          <Panel
            title="Supplier-to-importer trade flows"
            subtitle={
              selectedEconomy
                ? connectionMode === "imports"
                  ? `Imports into ${selectedEconomy.name} from worldwide suppliers; node values reflect displayed links`
                  : connectionMode === "exports"
                    ? `Supplier shipments from ${selectedEconomy.name} to reporting markets; node values reflect displayed links`
                    : `Connections to and from ${selectedEconomy.name} within available reporting-market flows`
                : "Leading supplier flows into covered reporting markets; node values reflect displayed links"
            }
            className="sankey-panel"
          >
            <TradeSankey
              routes={mapFlows}
              economies={dataset.economies}
              selectedEconomyIndex={selectedEconomyIndex}
              onSelectEconomy={(economyIndex) => {
                setSelectedRouteId(null);
                setConnectionMode("all");
                setSelectedEconomyIndex((current) =>
                  current === economyIndex ? null : economyIndex,
                );
              }}
            />
          </Panel>

          <div className="two-column-grid">
            <Panel
              title="Top reporting import markets"
              subtitle="Ranked by importer-reported World totals"
            >
              <RankingBars
                rows={analysis.importers.slice(0, 10)}
                color="#2563eb"
              />
            </Panel>
            <Panel
              title="Top suppliers to reporting markets"
              subtitle="Ranked by shipments into covered importing markets"
            >
              <RankingBars
                rows={analysis.suppliers.slice(0, 10)}
                color="#d97706"
              />
            </Panel>
          </div>

          <div className="concentration-routes-grid">
            <Panel
              title="Supplier concentration by importer"
              subtitle="All reporting importers, ranked from most to least concentrated"
              className="hhi-panel"
            >
              <HhiChart rows={analysis.importerHhi} />
            </Panel>
            <Panel
              title="Top bilateral routes"
              subtitle="Largest supplier-to-reporting-market flows in the available data"
              className="routes-panel"
            >
              <RouteTable
                rows={analysis.routes.slice(0, 20)}
                onSelect={(routeId) => {
                  setSelectedEconomyIndex(null);
                  setConnectionMode("all");
                  setSelectedRouteId(routeId);
                }}
              />
            </Panel>
          </div>

          <StageValueChainSection data={stageDataset} />

          <footer className="page-footer">
            <div>
              <strong>Asian Transport Observatory</strong>
              <span>
                Source: UN Comtrade API · importer-reported values in current
                US$ thousand
              </span>
            </div>
            <p>
              Missing observations are not treated as zero. “Exports” refer
              only to supplier shipments into covered importing markets.
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
