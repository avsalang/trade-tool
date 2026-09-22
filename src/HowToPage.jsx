import GuidanceShell, { assetUrl } from "./GuidanceShell.jsx";

function AnnotatedScreenshot({ src, alt, callouts }) {
  return (
    <figure className="howto-figure">
      <div className="howto-image-wrap">
        <img src={assetUrl(`how-to/${src}`)} alt={alt} />
        {callouts.map((callout) => (
          <span
            key={callout.marker}
            className="howto-highlight"
            style={{
              "--callout-left": callout.left,
              "--callout-top": callout.top,
              "--callout-width": callout.width,
              "--callout-height": callout.height,
            }}
            aria-hidden="true"
          >
            <b><span>{callout.marker}</span></b>
          </span>
        ))}
      </div>
      <figcaption>
        {callouts.map((callout) => (
          <span key={callout.marker}>
            <b><span>{callout.marker}</span></b>
            {callout.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function DefinitionGroups({ groups }) {
  return (
    <div className="howto-definitions">
      <h3>Definitions</h3>
      {groups.map((group) => (
        <details key={group.title} className="howto-definition-group">
          <summary>{group.title}</summary>
          <dl>
            {group.items.map(({ term, description }) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

const NAVIGATION_CALLOUTS = [
  { marker: "A", label: "Choose an analysis page from the navigation panel.", left: "0.6%", top: "3%", width: "13.8%", height: "94%" },
  { marker: "B", label: "Select a product, product group or combination of compatible HS codes.", left: "23.1%", top: "28.5%", width: "36.7%", height: "18%" },
  { marker: "C", label: "Choose a reporting economy and whether the importer or exporter reported the trade.", left: "60%", top: "28.5%", width: "37.7%", height: "18%" },
  { marker: "D", label: "Choose a snapshot year or a trend period. Route limits apply to the map and table.", left: "22.8%", top: "50%", width: "57.1%", height: "17%" },
];

const SNAPSHOT_CALLOUTS = [
  { marker: "A", label: "Read total reported trade and partner concentration for the current selection.", left: "1.5%", top: "12.2%", width: "97.2%", height: "15.6%" },
  { marker: "B", label: "Switch between the route map and table. Both follow the Routes shown setting.", left: "1.5%", top: "29.7%", width: "97.2%", height: "5%" },
  { marker: "C", label: "Select an economy to focus on its connections. Reset the map before choosing another.", left: "1.5%", top: "38%", width: "97.2%", height: "61.5%" },
  { marker: "D", label: "Use the map key to interpret node roles, routes and values.", left: "2.4%", top: "71%", width: "19.8%", height: "27.4%" },
];

const TRENDS_CALLOUTS = [
  { marker: "A", label: "Check reporting coverage across the selected period.", left: "1.4%", top: "9%", width: "97.2%", height: "8.6%" },
  { marker: "B", label: "Compare the endpoints for trade value, growth and concentration.", left: "1.4%", top: "18.8%", width: "97.2%", height: "9.4%" },
  { marker: "C", label: "Follow annual trade value and select a point for the exact figure.", left: "1.4%", top: "29.5%", width: "97.2%", height: "29.9%" },
  { marker: "D", label: "Compare partner shares and changes in the HHI concentration measure.", left: "1.4%", top: "60.7%", width: "97.2%", height: "34.2%" },
];

const VALUE_CHAIN_CALLOUTS = [
  { marker: "A", label: "Choose the year, material focus and reporting basis.", left: "56.5%", top: "4.6%", width: "41.4%", height: "6.7%" },
  { marker: "B", label: "Read the chart from material scope through the five trade stages to end users.", left: "2%", top: "20.4%", width: "96%", height: "8.4%" },
  { marker: "C", label: "Follow the named bilateral relationships; remaining trade is grouped under Other economies.", left: "2%", top: "28.4%", width: "96%", height: "63.5%" },
  { marker: "D", label: "Compare the full trade total reported for each stage.", left: "2%", top: "92%", width: "96%", height: "5.1%" },
];

const FILTER_DEFINITIONS = [{
  title: "Trade filters",
  items: [
    { term: "Product or group", description: "Selects one HS product, a predefined group or several compatible product codes. Overlapping broad and detailed codes cannot be combined." },
    { term: "Reporting economy", description: "Shows trade reported by the selected economy. All reporting economies combines reporters with available data." },
    { term: "Reported by", description: "Importer uses declarations submitted by importing economies; Exporter uses declarations submitted by exporting economies." },
    { term: "Snapshot", description: "Shows one reporting year." },
    { term: "Trends", description: "Compares annual results across a selected period." },
    { term: "Routes shown", description: "Limits the map and table to the 25, 50 or 100 largest bilateral routes. It does not change headline totals or the full-value Sankey." },
  ],
}];

const SNAPSHOT_DEFINITIONS = [{
  title: "Snapshot indicators and figures",
  items: [
    { term: "Reported imports or exports", description: "The full annual current-US-dollar value reported for the selected products and economies." },
    { term: "Herfindahl–Hirschman Index (HHI)", description: "A 0–10,000 measure of supplier or destination concentration. A higher value means trade is concentrated among fewer partners." },
    { term: "Supplier economy", description: "The origin economy in a bilateral relationship." },
    { term: "Importing economy", description: "The destination economy in a bilateral relationship." },
    { term: "Both roles", description: "An economy appearing as both a supplier and an importer in the displayed network." },
    { term: "Direction at a selected economy", description: "Into and Out of describe the route direction at the economy selected on the map. This is separate from who reported the trade." },
    { term: "Other economies", description: "Relationships included in the Sankey total but not individually named." },
  ],
}];

const TREND_DEFINITIONS = [{
  title: "Trend indicators",
  items: [
    { term: "Comparable economies", description: "Reporting economies with observations across the selected comparison period." },
    { term: "Overall change", description: "The percentage difference between the first and last annual values." },
    { term: "Compound annual growth rate", description: "The average annual rate connecting the first value to the last value over the period." },
    { term: "Change in HHI", description: "The difference between the first- and last-year concentration index." },
    { term: "Current US$", description: "Nominal trade value for the reporting year, shortened to thousands, millions, billions or trillions where appropriate." },
  ],
}];

const VALUE_CHAIN_DEFINITIONS = [{
  title: "Value-chain figure",
  items: [
    { term: "Material focus", description: "Selects cobalt, graphite or lithium products for the material-specific upstream stages. Downstream battery and vehicle stages are shared." },
    { term: "Stage total", description: "The full reported trade value of products assigned to that stage." },
    { term: "Band width", description: "A bilateral route’s share of the total reported exports or imports for its stage." },
    { term: "Leading economies", description: "The three largest exporters at a stage and their three main partners, with selected adjacent economies retained to keep leading routes visible across the chain." },
    { term: "Other economies", description: "All remaining reported trade combined in one band so that the stage total remains complete." },
  ],
}];

function GuideSection({ id, title, intro, screenshot, alt, callouts, definitions, children, tabSection = false }) {
  return (
    <section id={id} className={`howto-step${tabSection ? " howto-tab-section" : ""}`}>
      <header>
        <div>
          <h2>{title}</h2>
          <p>{intro}</p>
        </div>
      </header>
      <AnnotatedScreenshot src={screenshot} alt={alt} callouts={callouts} />
      <DefinitionGroups groups={definitions} />
      <div className="howto-reading-guide">{children}</div>
    </section>
  );
}

export default function HowToPage() {
  return (
    <GuidanceShell footer="Source: United Nations Comtrade annual merchandise trade data.">
      <div className="page howto-page">
        <header className="howto-heading">
          <h1>How to use the trade tools</h1>
          <p>
            Use the Trade Flow Explorer to examine selected products, reporting
            economies and bilateral relationships. Use the EV Value Chain to compare
            trade across related production stages.
          </p>
        </header>

        <nav className="howto-page-links" aria-label="How-to page sections">
          <a href="#guide-snapshot">Trade snapshot</a>
          <a href="#guide-trends">Change over time</a>
          <a href="#guide-value-chain">EV Value Chain</a>
        </nav>

        <GuideSection
          title="Navigation and filters"
          intro="Start by choosing the analysis and defining the trade you want to examine."
          screenshot="navigation-and-filters.png"
          alt="Trade tool navigation and filters"
          callouts={NAVIGATION_CALLOUTS}
          definitions={FILTER_DEFINITIONS}
        >
          <p>
            Select a product, a full product group or a custom combination of compatible
            HS codes. The selected economy and reporting basis apply across the Trade
            Flow Explorer. Clear the product selection to return to the no-data state,
            or use Reset to restore the default view.
          </p>
          <p>
            Imports and exports are separate reporting views and can differ. Choose the
            reporting basis that fits the question rather than combining the two.
          </p>
        </GuideSection>

        <GuideSection
          id="guide-snapshot"
          tabSection
          title="Trade snapshot"
          intro="Use this view to examine trade value, concentration and bilateral relationships for one year."
          screenshot="trade-snapshot.png"
          alt="Trade snapshot indicators and route map"
          callouts={SNAPSHOT_CALLOUTS}
          definitions={SNAPSHOT_DEFINITIONS}
        >
          <p>
            Reported trade and HHI use the full validated selection. The Routes shown
            setting applies only to the map and table. Node size on the map uses total
            trade for the selected product and year; line width represents the value of
            a displayed route.
          </p>
          <p>
            Select an economy on the map to show its connections. Reset the map before
            choosing another economy. The bilateral-trade Sankey below the map and table
            includes the full reported value and is not affected by Routes shown.
          </p>
        </GuideSection>

        <GuideSection
          id="guide-trends"
          tabSection
          title="Change over time"
          intro="Use Trends to compare annual trade and concentration over a selected period."
          screenshot="trade-trends.png"
          alt="Trade trends indicators and annual charts"
          callouts={TRENDS_CALLOUTS}
          definitions={TREND_DEFINITIONS}
        >
          <p>
            Choose the first and last year in the filter bar. The summary cards compare
            the endpoints, while the charts show each annual observation in between.
            Select a point on the trade-value chart to read the annual value.
          </p>
          <p>
            Read the HHI series together with trade value and partner shares. A rising
            HHI means trade became more concentrated among fewer partners; it does not
            by itself show that trade became more vulnerable.
          </p>
        </GuideSection>

        <GuideSection
          id="guide-value-chain"
          tabSection
          title="EV Value Chain"
          intro="Use this view to compare leading trading economies across five groups of EV-related products."
          screenshot="ev-value-chain.png"
          alt="Electric-vehicle value-chain Sankey and controls"
          callouts={VALUE_CHAIN_CALLOUTS}
          definitions={VALUE_CHAIN_DEFINITIONS}
        >
          <p>
            Read the chart from left to right. The upstream stages change with the
            selected material. Battery, component and vehicle products are common to
            all three material views. Switch the reporting basis to compare
            exporter-reported exports with importer-reported imports.
          </p>
          <p>
            Named bands identify the leading relationships selected by the method.
            “Other economies” keeps the remaining value in the chart, so each stage
            total represents the full reported amount. Compare widths within a stage,
            not between stages with different totals.
          </p>
        </GuideSection>
      </div>
    </GuidanceShell>
  );
}
