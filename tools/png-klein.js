// Kleiner PNG-Leser/-Schreiber ohne Abhaengigkeiten (fuer die Item-Bilder aus Minecraft).
// Liest alle normalen PNGs (Graustufen, RGB, Palette, mit Alpha, 1-16 Bit, ohne Interlacing)
// und schreibt RGBA mit 8 Bit. Bilder sind { width, height, data: Uint8Array (RGBA) }.
'use strict';

const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIDE = 4096;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decode(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('Kein PNG');
  let p = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (name === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
  }
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) throw new Error('PNG-Größe ungültig');
  if (interlace) throw new Error('PNG mit Interlacing wird nicht unterstützt');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('PNG-Art wird nicht unterstützt');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('PNG unvollständig');

  // Filter rueckgaengig machen
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0;
      const b = y > 0 ? px[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[row - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + x] = v & 0xff;
    }
  }

  const sample = (row, i) => {
    // i-ter Wert der Zeile, auf 0-255 gebracht
    if (depth === 8) return px[row + i];
    if (depth === 16) return px[row + i * 2];
    const perByte = 8 / depth;
    const byte = px[row + Math.floor(i / perByte)];
    const shift = 8 - depth * ((i % perByte) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rawSample = (row, i) => {
    // Wert ohne Umrechnung (fuer den Vergleich mit tRNS)
    if (depth === 16) return px.readUInt16BE(row + i * 2);
    if (depth === 8) return px[row + i];
    const perByte = 8 / depth;
    return (px[row + Math.floor(i / perByte)] >> (8 - depth * ((i % perByte) + 1))) & ((1 << depth) - 1);
  };

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const idx = sample(row, x);
        if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG-Palette fehlt');
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(row, x * channels);
        out[o] = out[o + 1] = out[o + 2] = g;
        if (type === 4) out[o + 3] = sample(row, x * channels + 1);
        else out[o + 3] = trns && trns.length >= 2 && rawSample(row, x) === trns.readUInt16BE(0) ? 0 : 255;
      } else {
        out[o] = sample(row, x * channels); out[o + 1] = sample(row, x * channels + 1); out[o + 2] = sample(row, x * channels + 2);
        if (type === 6) out[o + 3] = sample(row, x * channels + 3);
        else {
          const key = trns && trns.length >= 6;
          out[o + 3] = key && rawSample(row, x * 3) === trns.readUInt16BE(0) && rawSample(row, x * 3 + 1) === trns.readUInt16BE(2) && rawSample(row, x * 3 + 2) === trns.readUInt16BE(4) ? 0 : 255;
        }
      }
    }
  }
  return { width, height, data: out };
}

function chunk(name, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(name, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encode(img) {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- einfache Bild-Werkzeuge ----------
function create(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}
function crop(img, x, y, w, h) {
  const out = create(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const s = (sy * img.width + sx) * 4, d = (j * w + i) * 4;
      for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
    }
  }
  return out;
}
// src ueber dst legen (mit Alpha)
function blit(dst, src, dx, dy) {
  for (let j = 0; j < src.height; j++) {
    for (let i = 0; i < src.width; i++) {
      const x = dx + i, y = dy + j;
      if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) continue;
      const s = (j * src.width + i) * 4, d = (y * dst.width + x) * 4;
      const a = src.data[s + 3] / 255;
      if (a <= 0) continue;
      const da = dst.data[d + 3] / 255;
      const oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) dst.data[d + k] = Math.round((src.data[s + k] * a + dst.data[d + k] * da * (1 - a)) / oa);
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}
function flipH(img) {
  const out = create(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4, d = (y * img.width + (img.width - 1 - x)) * 4;
      for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
    }
  }
  return out;
}
function flipV(img) {
  const out = create(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    const s = y * img.width * 4, d = (img.height - 1 - y) * img.width * 4;
    out.data.set(img.data.subarray(s, s + img.width * 4), d);
  }
  return out;
}
// mit einer Farbe einfaerben (wie Minecraft: multiplizieren)
function tint(img, rgb) {
  const out = create(img.width, img.height);
  out.data.set(img.data);
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = Math.round((out.data[i] * r) / 255);
    out.data[i + 1] = Math.round((out.data[i + 1] * g) / 255);
    out.data[i + 2] = Math.round((out.data[i + 2] * b) / 255);
  }
  return out;
}
// Pixel fuer Pixel vergroessern (nur zum Ansehen)
function scale(img, f) {
  const out = create(img.width * f, img.height * f);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const s = (Math.floor(y / f) * img.width + Math.floor(x / f)) * 4, d = (y * out.width + x) * 4;
      for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
    }
  }
  return out;
}

module.exports = { decode, encode, create, crop, blit, flipH, flipV, tint, scale, crc32 };
