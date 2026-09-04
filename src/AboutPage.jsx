import GuidanceShell from "./GuidanceShell.jsx";

const LINKS = {
  comtrade: "https://comtradeplus.un.org/",
  docs: "https://uncomtrade.org/docs/",
  policy: "https://uncomtrade.org/docs/policy-on-use-and-re-dissemination/",
  hhi: "https://www.justice.gov/atr/herfindahl-hirschman-index",
  unctad: "https://unctad.org/system/files/official-document/ditcmisc2023d1_en_0.pdf",
};

function ExternalLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function AboutPage() {
  return (
    <GuidanceShell footer="Source: United Nations Comtrade annual merchandise trade data.">
      <div className="page about-page">
        <header className="about-heading">
          <span>About</span>
          <h1>ATO Trade Intelligence</h1>
          <p>
            Explore trade in selected transport products and goods across the
            electric-vehicle value chain.
          </p>
        </header>

        <article className="about-panel">
          <section>
            <h3>Overview</h3>
            <p>
              ATO Trade Intelligence brings together two complementary views of
              international merchandise trade. The Trade Flow Explorer examines one
              product or a selected group of products by year, reporting basis and
              economy. The EV Value Chain groups selected products into five stages,
              from extraction through electric vehicles and their destination markets.
            </p>
            <p>
              The tool can be used to identify major trading economies, compare
              bilateral relationships, review changes over time and examine how
              concentrated trade is among suppliers or destinations.
            </p>
          </section>

          <section>
            <h3>Scope and Limitations</h3>
            <p>
              The Trade Flow Explorer covers annual data from 2015 to 2024 for 68
              selected Harmonized System product codes. These include broad transport
              categories, detailed vehicle types, minerals, processed materials,
              batteries and electric-vehicle products. Some detailed codes were
              introduced after 2015 and are shown only for the years in which they are
              available.
            </p>
            <p>
              Values are annual reporter-reported imports or exports from UN Comtrade
              and are presented in current US dollars. Importer and exporter reports
              may differ because of valuation, timing, partner attribution,
              transshipment and reporting practices. Missing observations are not
              treated as zero, and recently reported data may be revised.
            </p>
            <p>
              Headline totals, rankings, concentration measures and trends use the full
              validated data available for the selected products and years. The map and
              table show up to the 100 largest bilateral routes. The bilateral-trade
              Sankey retains the full reported value by combining smaller relationships
              under “Other economies.”
            </p>
            <p>
              Supplier or destination concentration is measured with the
              Herfindahl–Hirschman Index (HHI). Higher values indicate that trade is
              concentrated among fewer partners. HHI should be considered alongside
              the underlying trade relationships and is not a complete measure of
              supply-chain risk.
            </p>
            <p>
              Product coverage follows the HS codes listed in the selector. Broad codes
              may contain goods with different technologies or uses, while some
              specialised products cannot be isolated precisely. Overlapping broad and
              detailed codes cannot be selected together because this would count the
              same trade more than once.
            </p>
          </section>

          <section>
            <h3>Disclaimer</h3>
            <p>
              This tool is intended for research, analysis and knowledge sharing. It is
              not an official UN Comtrade publication and does not replace the source
              database, national trade statistics or the applicable metadata. Users
              should consult the original sources for official figures and definitions.
            </p>
          </section>

          <section>
            <h3>Acknowledgements</h3>
            <p>
              The tool was developed by the Asian Transport Observatory. The EV
              value-chain presentation adapts the method described in UNCTAD’s
              <ExternalLink href={LINKS.unctad}> <em>Technical note on critical minerals</em></ExternalLink>.
            </p>
          </section>

          <section>
            <h3>Sources</h3>
            <p>
              Trade data are drawn from the <ExternalLink href={LINKS.comtrade}>UN Comtrade database</ExternalLink>.
              Definitions and API documentation are available through the <ExternalLink href={LINKS.docs}>UN Comtrade documentation</ExternalLink>.
              Use and redistribution are subject to the <ExternalLink href={LINKS.policy}>UN Comtrade policy on use and re-dissemination</ExternalLink>.
              The concentration bands refer to the <ExternalLink href={LINKS.hhi}>U.S. Department of Justice explanation of HHI</ExternalLink>.
            </p>
          </section>
        </article>
      </div>
    </GuidanceShell>
  );
}
