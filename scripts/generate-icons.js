// Generates simple placeholder PNG icons for the Chrome extension
// Pure Node.js — no dependencies needed
const fs = require('fs');
const path = require('path');

// Minimal PNG encoder — creates a solid-color square PNG
function createSolidPng(size, r, g, b) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // CRC32 lookup table
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeData));
    return Buffer.concat([len, typeData, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);   // width
  ihdr.writeUInt32BE(size, 4);   // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB

  // Raw pixel data (filter byte + RGB per row)
  const rowBytes = 1 + size * 3;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const offset = y * rowBytes + 1 + x * 3;
      raw[offset]     = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  // Compress with zlib deflate (minimal — store blocks, no compression)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

sizes.forEach(size => {
  // Upwork green: #14a51e → rgb(20, 165, 30)
  const buf = createSolidPng(size, 20, 165, 30);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, buf);
  console.log(`Created ${filePath}`);
});

console.log('Done. Icons generated.');
