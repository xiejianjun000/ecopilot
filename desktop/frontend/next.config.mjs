import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import("next").NextConfig} */
const nextConfig = {
  devIndicators: false,
  output: 'standalone',
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  async rewrites() {
    return [
      {
        source: '/api/hermes/:path*',
        destination: 'http://127.0.0.1:8648/api/:path*',
      },
    ]
  },
}
export default nextConfig
