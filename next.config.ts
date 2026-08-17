import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: an unrelated lockfile in a parent directory
  // otherwise makes Next.js infer the wrong root for file tracing.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
