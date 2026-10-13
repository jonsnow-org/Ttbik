import { isAtharSender } from "../atharWatch";

jest.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({}) }));

describe("Athar payment alerts ignore the Zenobia ledger", () => {
  it("does not count a payment from the Zenobia ledger wallet (in any address form)", () => {
    expect(isAtharSender("0:9eb094e339a542fdcae8bd2800bd3adb4fa9fbeceaa4b694ab46c7bf4cfeac91")).toBe(false);
    expect(isAtharSender("0:9EB094E339A542FDCAE8BD2800BD3ADB4FA9FBECEAA4B694AB46C7BF4CFEAC91")).toBe(false);
    expect(isAtharSender("UQCesJTjOaVC_crovSgAvTrbT6n77OqktpSrRse_TP6skQHV")).toBe(false);
  });
  it("still counts any other sender", () => {
    expect(isAtharSender("0:6dde1cc5149d751a3063cc3e76de6dcd9f286a44dc9f2829b356af7fcd57e340")).toBe(true);
    expect(isAtharSender("EQDXLw2VpsvpKRAa0lJBAa8sVt8kINCE5_OMZIiSH2XsjgZf")).toBe(true);
  });
});
