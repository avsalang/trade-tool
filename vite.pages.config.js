import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function githubPagesBase() {
  if (process.env.VITE_BASE_PATH) {
    const configured = process.env.VITE_BASE_PATH;
    return configured.endsWith("/") ? configured : `${configured}/`;
  }

  if (process.env.GITHUB_ACTIONS !== "true") return "/";

  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
  if (!repositoryName || repositoryName.endsWith(".github.io")) return "/";
  return `/${repositoryName}/`;
}

export default defineConfig({
  base: githubPagesBase(),
  root: "github-pages",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
