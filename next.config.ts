import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile exists in the user profile folder; pin the root here.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
