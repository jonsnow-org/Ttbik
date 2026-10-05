import path from "node:path";
import webpack from "next/dist/compiled/webpack/webpack-lib.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },                 // the app uses no next/image: switch the image optimizer (a known attack surface of Next 14) off
  experimental: { externalDir: true },          // use the compiled contract wrappers and rules from ../build and ../lib
  webpack: (config, { isServer }) => {
    // one copy of @ton/core for the wrappers and the app (Address/Cell instanceof must agree)
    config.resolve.alias["@ton/core"] = path.resolve("./node_modules/@ton/core");
    if (!isServer) {
      config.resolve.fallback = { ...(config.resolve.fallback || {}), buffer: path.resolve("./node_modules/buffer/"), crypto: false, fs: false };
      config.plugins.push(new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }));
    }
    return config;
  },
};
export default nextConfig;
