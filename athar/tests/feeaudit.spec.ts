// The picture fee cannot be dodged by sending a purchase by hand, and the owner is never charged.
import { beginCell, Address } from "@ton/core";
import { storeBuy } from "../build/athar_AtharMinter";
import { judge, parseBuyTx, BuyRec } from "../web/lib/feeaudit";
import { arweaveId } from "../web/lib/ids";

const REF = arweaveId(123456789n), REF2 = arweaveId(987654321n);
const OTHER = Address.parse("EQAuIOwjzSmGQfL925LjD5eG0Qk1zJNRk4Ap8jzSOwnCRIYf").toRawString();
const ADMIN = Address.parse("UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSz").toRawString();
const rec = (o: Partial<BuyRec> = {}): BuyRec => ({ index: 5, buyer: OTHER, style: 0, ref: REF, lt: "1", ...o });
const tok = (o: any = {}) => ({ index: 5, mediaRef: REF, media: [{ ref: REF }], ...o });

describe("picture fee", () => {
  it("no picture: nothing to judge", () => expect(judge(tok({ mediaRef: null, media: [] }), [rec()], ADMIN, true)).toBe("ok"));
  it("a photo bound with no fee (style 0) by anyone else is not shown", () => expect(judge(tok(), [rec()], ADMIN, true)).toBe("unpaid"));
  it("the same photo bound through the fee path (style 1 or 2) is shown", () => {
    expect(judge(tok(), [rec({ style: 1 })], ADMIN, true)).toBe("ok");
    expect(judge(tok(), [rec({ style: 2 })], ADMIN, true)).toBe("ok");
  });
  it("the owner pays no fee: his purchases are always shown", () => expect(judge(tok(), [rec({ buyer: ADMIN })], ADMIN, true)).toBe("ok"));
  it("a plain generated picture is free for everybody", () => expect(judge(tok(), [rec()], ADMIN, false)).toBe("ok"));
  it("a picture set later through the item's own paid message is shown", () => {
    expect(judge(tok({ mediaRef: REF2, media: [{ ref: REF2 }, { ref: REF }] }), [rec()], ADMIN, true)).toBe("ok");
  });
  it("a token that was not a direct purchase (auction, box) is shown", () => expect(judge(tok(), [], ADMIN, true)).toBe("ok"));
  it("a picture that cannot be read right now is shown and judged on the next look", () => expect(judge(tok(), [rec()], ADMIN, null)).toBe("ok"));
});

describe("reading a purchase from the chain", () => {
  const body = (style: number) => beginCell().store(storeBuy({ $$type: "Buy", index: 5n, recipient: null, occasion: 0n, mediaRef: 123456789n, style: BigInt(style) })).endCell().toBoc().toString("base64");
  const tx = (o: any = {}) => ({ lt: "99", description: { aborted: false }, in_msg: { opcode: "0x41540044", source: ADMIN, message_content: { body: body(2) } }, ...o });
  it("reads index, buyer, style and picture id", () => {
    const r = parseBuyTx(tx())!;
    expect(r).toMatchObject({ index: 5, buyer: ADMIN, style: 2, ref: REF, lt: "99" });
  });
  it("ignores a purchase the contract refused, other messages, and garbage", () => {
    expect(parseBuyTx(tx({ description: { aborted: true } }))).toBeNull();
    expect(parseBuyTx(tx({ in_msg: { opcode: "0x41540042", source: ADMIN, message_content: { body: body(0) } } }))).toBeNull();
    expect(parseBuyTx({})).toBeNull();
    expect(parseBuyTx(tx({ in_msg: { opcode: "0x41540044", source: ADMIN, message_content: { body: "AAAA" } } }))).toBeNull();
  });
});
