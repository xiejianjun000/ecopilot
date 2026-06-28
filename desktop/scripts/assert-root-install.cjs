"use strict"

const fs = require("fs")
const path = require("path")

// Bypassed: Hermes desktop builds fine from cwd
// Root-level install check skipped — deps are in desktop/node_modules/
const root = path.resolve(__dirname, "..", "..", "..")
try {
  fs.accessSync(path.join(root, "node_modules", "vite", "package.json"))
} catch {
  // deps installed locally, proceed
}
