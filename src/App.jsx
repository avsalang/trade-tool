import { lazy, Suspense, useEffect, useState } from "react";

const TradeExplorerApp = lazy(() => import("./TradeExplorerApp.jsx"));
const EVValueChainApp = lazy(() => import("./EVValueChainOnlyApp.jsx"));
const AboutPage = lazy(() => import("./AboutPage.jsx"));
const HowToPage = lazy(() => import("./HowToPage.jsx"));

const MODULES = {
  about: {
    hash: "#/about",
    title: "About",
    utility: true,
  },
  howto: {
    hash: "#/how-to",
    title: "How to",
    utility: true,
  },
  trade: {
    hash: "#/trade-explorer",
    title: "Trade Flow Explorer",
  },
  ev: {
    hash: "#/ev-value-chain",
    title: "EV Value Chain",
  },
};

function moduleFromHash() {
  const hash = window.location.hash.toLowerCase();
  if (hash.startsWith("#/about")) return "about";
  if (hash.startsWith("#/how-to")) return "howto";
  if (hash.startsWith("#/ev-value-chain")) return "ev";
  return "trade";
}

export default function App() {
  const [activeModule, setActiveModule] = useState(moduleFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveModule(moduleFromHash());
      window.scrollTo({ top: 0, behavior: "auto" });
    };

    if (!window.location.hash) {
      window.history.replaceState(null, "", MODULES.trade.hash);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    document.title = `${MODULES[activeModule].title} | ATO Trade Intelligence`;
  }, [activeModule]);

  const utilityModules = Object.entries(MODULES).filter(([, module]) => module.utility);
  const toolModules = Object.entries(MODULES).filter(([, module]) => !module.utility);

  const renderLinks = (modules) =>
    modules.map(([key, module]) => {
      const isActive = activeModule === key;
      return (
        <a
          key={key}
          className={`platform-sidebar__link${module.utility ? " platform-sidebar__link--utility" : ""}${isActive ? " active" : ""}`}
          href={module.hash}
          aria-current={isActive ? "page" : undefined}
        >
          <span>{module.title}</span>
        </a>
      );
    });

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <div className="platform-sidebar__title">Trade tools</div>
        <nav className="platform-sidebar__nav" aria-label="Trade intelligence pages">
          <div className="platform-sidebar__utility">
            {renderLinks(utilityModules)}
          </div>
          <div className="platform-sidebar__divider" aria-hidden="true" />
          <div className="platform-sidebar__tools">
            {renderLinks(toolModules)}
          </div>
        </nav>
      </aside>

      <main className="platform-module">
        <Suspense
          fallback={
            <div className="platform-module-loading" role="status">
              Loading {MODULES[activeModule].title}…
            </div>
          }
        >
          {activeModule === "about" ? (
            <AboutPage />
          ) : activeModule === "howto" ? (
            <HowToPage />
          ) : activeModule === "ev" ? (
            <EVValueChainApp />
          ) : (
            <TradeExplorerApp />
          )}
        </Suspense>
      </main>
    </div>
  );
}
