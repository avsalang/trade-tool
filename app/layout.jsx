import "maplibre-gl/dist/maplibre-gl.css";
import "../src/styles.css";
import "../src/filter-layout.css";

export const metadata = {
  title: "ATO Transport Product Trade Flow Explorer",
  description:
    "Explore importer-reported bilateral transport product trade flows, market shares, and supplier concentration with the Asian Transport Observatory.",
  icons: {
    icon: "/ATO_logo.jpg",
  },
};

export const viewport = {
  themeColor: "#0d1b2a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
