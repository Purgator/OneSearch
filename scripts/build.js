// Builds one ZIP per browser into dist/:
//   dist/OneSearch-chrome.zip   (Chrome, Vivaldi, Edge, Brave...)
//   dist/OneSearch-firefox.zip  (Firefox)
// Usage: node scripts/build.js
// The source manifest.json declares both browsers' keys so the repo folder
// loads unpacked anywhere; each build keeps only the keys its browser needs.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Minimal ZIP writer (deflate, forward-slash paths, manifest.json at the
// archive root) so the build has no dependency on external zip tools.
function listFiles(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
      : [`${prefix}${e.name}`]
  );
}

function makeZip(dir) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const name of listFiles(dir).sort()) {
    const data = fs.readFileSync(path.join(dir, name));
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const FILES = ["README.md", "LICENSE"];
const DIRS = ["src", "icons"];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const targets = {
  chrome(m) {
    delete m.background.scripts;
    delete m.browser_specific_settings;
  },
  firefox(m) {
    delete m.background.service_worker;
  }
};

fs.rmSync(dist, { recursive: true, force: true });

for (const [name, adapt] of Object.entries(targets)) {
  const stage = path.join(dist, name);
  fs.mkdirSync(stage, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(stage, f));
  for (const d of DIRS) fs.cpSync(path.join(root, d), path.join(stage, d), { recursive: true });

  const m = JSON.parse(JSON.stringify(manifest));
  adapt(m);
  fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(m, null, 2) + "\n");

  const zip = `OneSearch-${name}.zip`;
  fs.writeFileSync(path.join(dist, zip), makeZip(stage));
  console.log(`built dist/${zip} (v${m.version})`);
}
