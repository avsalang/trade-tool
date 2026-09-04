const BASE_URL = import.meta.env.BASE_URL || "/";

export function assetUrl(path) {
  return `${BASE_URL}${path.replace(/^\/+/, "")}`;
}

export default function GuidanceShell({ children, footer }) {
  return (
    <div className="app-shell guidance-shell">
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

      <main className="guidance-workspace">
        <div className="guidance-content">
          {children}
          <footer className="page-footer guidance-footer">
            <div>
              <strong>Asian Transport Observatory</strong>
              <span>ATO Trade Intelligence</span>
            </div>
            <p>{footer}</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
