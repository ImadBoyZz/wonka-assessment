import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: this repo may live inside a folder that contains
  // other projects (and their lockfiles).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
