// Permanent storage. Files under 100 KiB are stored on Arweave for free through ArDrive Turbo; the upload is signed with a
// throw-away key that holds nothing (it only identifies the uploader). Once stored, nobody (including us) can delete the file.
import { TurboFactory } from "@ardrive/turbo-sdk";
import crypto from "crypto";

export const MAX_BYTES = 100 * 1024 - 1024;           // keep a margin under the free limit
export const GATEWAY = "https://turbo-gateway.com";    // any Arweave gateway serves the same id; this one answers at once

let key = process.env.ATHAR_TURBO_KEY || "";
export function turboKey() {
  if (!key) key = crypto.randomBytes(32).toString("hex");    // only used if nothing is configured: still fine, it holds no funds
  return key.startsWith("0x") ? key : "0x" + key;
}

export async function uploadPermanent(data: Buffer, contentType: string, tags: Record<string, string> = {}) {
  if (data.length > MAX_BYTES) throw new Error("file too large for free permanent storage");
  const turbo = TurboFactory.authenticated({ privateKey: turboKey(), token: "ethereum" });
  const r = await turbo.uploadFile({
    fileStreamFactory: () => data,
    fileSizeFactory: () => data.length,
    dataItemOpts: { tags: [{ name: "Content-Type", value: contentType }, { name: "App-Name", value: "Athar" }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))] },
  });
  return { id: r.id as string, url: `${GATEWAY}/${r.id}` };
}

export { idToUint256 } from "./ids";
