import { useEffect, useState } from "react";
import { StageValueChainSection } from "./EVValueChainApp.jsx";

const BASE_URL = import.meta.env.BASE_URL || "/";

function assetUrl(path) {
  return `${BASE_URL}${path.replace(/^\/+/, "")}`;
}

export default function EVValueChainOnlyApp() {
  const [dataset, setDataset] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetch(assetUrl("data/comtrade-ev-bilateral.json"))
      .then((response) => {
        if (!response.ok) throw new Error("The EV value-chain dataset could not be loaded.");
        return response.json();
      })
      .then(setDataset)
      .catch((error) => setLoadError(error.message));
  }, []);

  if (loadError) {
    return <div className="application-loading">{loadError}</div>;
  }
  if (!dataset) {
    return <div className="application-loading">Loading EV value-chain data…</div>;
  }

  return (
    <div className="app-shell ev-chain-only-shell">
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

      <main className="ev-chain-only-workspace">
        <div className="ev-chain-only-content">
          <StageValueChainSection data={dataset} />
          <footer className="page-footer">
            <div>
              <strong>Asian Transport Observatory</strong>
              <span>EV Value Chain</span>
            </div>
            <p>
              Source: UN Comtrade annual bilateral trade data, 2022–2024.
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
