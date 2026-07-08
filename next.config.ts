import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite kör riktig Postgres i processen (WASM) — får inte bundlas av Next
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
