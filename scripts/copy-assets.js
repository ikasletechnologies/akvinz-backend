const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src", "assets");
const dest = path.join(__dirname, "..", "dist", "assets");

fs.cpSync(src, dest, { recursive: true });
