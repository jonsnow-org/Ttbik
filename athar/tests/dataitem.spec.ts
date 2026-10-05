// The permanent-storage item built with our small signer must be IDENTICAL, byte for byte, to the one the general library builds:
// same bytes, same signature, same id. (The library stays a dev-only dependency, used here as the reference.)
import { createData, EthereumSigner } from "../web/node_modules/@dha-team/arbundles";
import { buildDataItem } from "../web/lib/dataitem";
import { buildItem } from "../web/lib/storage";

const tags = [{ name: "Content-Type", value: "image/svg+xml" }, { name: "App-Name", value: "Athar" }];
const keyOf = (i: number) => Array.from({ length: 32 }, (_, k) => ((i * 31 + k * 7 + 5) & 0xff).toString(16).padStart(2, "0")).join("");

describe("data item", () => {
  it.each([0, 1, 7, 255, 4096, 70000])("identical to the reference library (%i bytes)", async (n) => {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 13 + n) & 0xff);
    const key = keyOf(n + 1);
    const mine = buildDataItem(data, key, tags, "0".repeat(32));
    const signer = new EthereumSigner(key);
    const ref = createData(data, signer, { tags, anchor: "0".repeat(32) });
    await ref.sign(signer);
    expect(mine.id).toBe(ref.id);
    expect(Buffer.from(mine.raw).equals(Buffer.from(ref.getRaw()))).toBe(true);
  });
  it("the library accepts the signature of ours as valid", async () => {
    const { DataItem } = await import("../web/node_modules/@dha-team/arbundles");
    const mine = buildDataItem(new TextEncoder().encode("hello athar"), keyOf(3), tags, "0".repeat(32));
    expect(await DataItem.verify(Buffer.from(mine.raw))).toBe(true);
  });
  it("the id depends only on the content (same file, same id)", async () => {
    const a = await buildItem("<svg/>"), b = await buildItem("<svg/>"), c = await buildItem("<svg />");
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});
