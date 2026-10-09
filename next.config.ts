import type { NextConfig } from 'next'

// Dual deployment:
//   - Vercel: plain `next build` (no env flags) — server build, root path.
//   - GitHub Pages: `EXPORT_STATIC=1 NEXT_PUBLIC_BASE_PATH=/neon-haven next build`
//     (see .github/workflows/pages.yml) — static export under the repo sub-path.
//
// Runtime model/texture URLs go through `assetUrl()` in src/game/config.ts so
// both layouts resolve. Texture URIs baked into the GLBs are relative
// (`../tex/...`) and work under any base path.

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
const staticExport = process.env.EXPORT_STATIC === '1'

const nextConfig: NextConfig = {
  transpilePackages: ['three'],
  experimental: {
    optimizePackageImports: ['three'],
  },
  ...(staticExport ? { output: 'export' as const } : {}),
  ...(basePath ? { basePath, assetPrefix: `${basePath}/` } : {}),
}

export default nextConfig
