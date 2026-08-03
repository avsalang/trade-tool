# ATO Trade Intelligence Platform

A static Asian Transport Observatory dashboard with two modules:

- **Trade Flow Explorer** presents annual product trade snapshots and trends.
- **EV Value Chain** presents the five-stage value-chain Sankey.

The Trade Flow Explorer currently covers 50 HS product codes. This includes
seven ICE passenger-vehicle HS6 codes under **General vehicle types**. They are
shown separately from broad HS 8703; broad and detailed codes must not be added
together.

The application is designed for GitHub Pages and contains no data-download or
export controls.

## Public data boundary

Only two publication extracts are included in the public repository:

- `public/data/trade-flows-comtrade.json`
- `public/data/comtrade-ev-bilateral.json`

They are deliberately reduced for browser presentation:

- Trade totals, rankings, HHI, and trend indicators are precomputed from the
  validated source. Only the 100 leading bilateral routes for each
  product-year are included for the interactive route views.
- EV Sankey data retains leading economies and combines remaining flows into
  **Other economies**. The underlying bilateral link table is not included.

Raw API responses, analysis-ready extraction caches, private source workbooks,
local build inputs, downloader scripts, credentials, and QA artifacts are
excluded by `.gitignore`. Because every asset used by a static site can be
inspected in a browser, publication protection is enforced through aggregation
and an automated release audit rather than through hidden interface controls.

Run the audit before committing or deploying:

```sh
npm run audit:public
```

The GitHub Pages workflow runs the same audit and stops if unexpected datasets,
local file paths, credential terms, excessive route counts, or oversized data
files are detected.

## Local preview

```sh
npm ci
npm run dev:pages
```

Build and preview the static release:

```sh
npm run build:pages
npm run preview:pages
```

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` deploys pushes to `main`.
It determines the repository base path automatically. The optional repository
variable `VITE_BASE_PATH` can override that path when necessary.

Before publishing, configure the GitHub repository under **Settings → Pages**
to use **GitHub Actions** as its source.
