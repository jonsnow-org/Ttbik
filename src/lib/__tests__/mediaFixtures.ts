// Small REAL media for tests (not a test file): a gradient / black / noise PNG, a sine / silent WAV, a structurally complete MP4 shell.
import sharp from "sharp";

export async function png(kind: "gradient" | "black" | "gray" | "noise" = "gradient", size = 64): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3);
  let seed = 12345;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 3;
    let r = 0, g = 0, b = 0;
    if (kind === "gray") r = g = b = 137;
    else if (kind === "noise") { seed = (seed * 1103515245 + 12345) & 0x7fffffff; r = seed & 255; seed = (seed * 1103515245 + 12345) & 0x7fffffff; g = seed & 255; seed = (seed * 1103515245 + 12345) & 0x7fffffff; b = seed & 255; }
    else if (kind === "gradient") {
      const v = Math.round(((x + y) * 255) / (2 * size - 2));
      r = v; g = 255 - v; b = Math.floor(v / 2) + 40;
      if (x > size / 4 && x < size / 2 && y > size / 4 && y < size / 2) r = g = b = 255;
    }
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

export function wav(kind: "tone" | "silence" = "tone", seconds = 0.6, rate = 16000): Buffer {
  const n = Math.floor(seconds * rate);
  const data = Buffer.alloc(n * 2);
  if (kind === "tone") for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.4 * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const box = (name: string, payload: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + payload.length, 0); h.write(name, 4, "latin1"); return Buffer.concat([h, payload]); };
export function mp4Shell(payloadBytes = 4096): Buffer {
  return Buffer.concat([box("ftyp", Buffer.from([0x69,0x73,0x6f,0x6d,0,0,2,0,0x69,0x73,0x6f,0x6d,0x69,0x73,0x6f,0x32])), box("moov", Buffer.alloc(128)), box("mdat", Buffer.alloc(payloadBytes, 1))]);
}
export const b64 = (b: Buffer) => b.toString("base64");
