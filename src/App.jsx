import { lazy, Suspense, useEffect, useState } from "react";

const TradeExplorerApp = lazy(() => import("./TradeExplorerApp.jsx"));
const EVValueChainApp = lazy(() => import("./EVValueChainOnlyApp.jsx"));

const MODULES = {
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
  return window.location.hash.toLowerCase().startsWith("#/ev-value-chain")
    ? "ev"
    : "trade";
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
    document.title =
      activeModule === "ev"
        ? "EV Value Chain | ATO Trade Intelligence"
        : "Trade Flow Explorer | ATO Trade Intelligence";
  }, [activeModule]);

  return (
    <div className="platform-shell">
      <aside className="platform-sidebar">
        <div className="platform-sidebar__title">Trade tools</div>
        <nav className="platform-sidebar__nav" aria-label="Trade intelligence modules">
          {Object.entries(MODULES).map(([key, module]) => {
            const isActive = activeModule === key;
            return (
              <a
                key={key}
                className={`platform-sidebar__link${isActive ? " active" : ""}`}
                href={module.hash}
                aria-current={isActive ? "page" : undefined}
              >
                <span>{module.title}</span>
              </a>
            );
          })}
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
          {activeModule === "ev" ? <EVValueChainApp /> : <TradeExplorerApp />}
        </Suspense>
      </main>
    </div>
  );
}
