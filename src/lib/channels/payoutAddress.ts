import { createHash } from "crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string): Buffer | null {
  let n = 0n;
  for (const ch of value) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) return null;
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
  bytes.reverse();
  let zeroes = 0;
  while (value[zeroes] === "1") zeroes++;
  return Buffer.concat([Buffer.alloc(zeroes), Buffer.from(bytes)]);
}

/** TRON mainnet Base58Check address validation (version byte + double-SHA256 checksum). */
export function isValidTronPayoutAddress(value: string): boolean {
  const address = String(value || "").trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;
  const payload = decoded.subarray(0, 21);
  const first = createHash("sha256").update(payload).digest();
  const checksum = createHash("sha256").update(first).digest().subarray(0, 4);
  return checksum.every((b, i) => b === decoded[21 + i]);
}

function crc16Xmodem(data: Buffer): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** TON user-friendly address validation: Base64URL payload and CRC16-XMODEM checksum. */
export function isValidTonPayoutAddress(value: string): boolean {
  const address = String(value || "").trim();
  if (!/^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/.test(address)) return false;
  const base64 = address.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== 36) return false;
  const tag = bytes[0] & 0x7f;
  if (tag !== 0x11 && tag !== 0x51) return false;
  const expected = crc16Xmodem(bytes.subarray(0, 34));
  return bytes[34] === (expected >> 8) && bytes[35] === (expected & 0xff);
}

/** TRON transaction IDs are 32-byte hashes encoded as 64 hexadecimal characters. */
export function isValidTronTransactionHash(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

export type ChannelPayoutNetwork = "USDT-TRC20" | "TON";

export function detectChannelPayoutNetwork(value: string): ChannelPayoutNetwork | null {
  if (isValidTronPayoutAddress(value)) return "USDT-TRC20";
  if (isValidTonPayoutAddress(value)) return "TON";
  return null;
}
