#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const dist = path.join(__dirname, "..", "..", "dist", "index.js");
if (fs.existsSync(dist)) {
  require(dist);
} else {
  require("ts-node/register/transpile-only");
  require("../src/index.ts");
}
