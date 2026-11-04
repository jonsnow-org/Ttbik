import qrcode from "qrcode-generator";

// Encode text as UTF-8 bytes so Arabic, emoji and other scripts are preserved.
// Type 0 lets the encoder select the smallest suitable QR version (1–40).
export default function QR(value: string): number[][] {
  qrcode.stringToBytes = (text) => Array.from(new TextEncoder().encode(text));

  const code = qrcode(0, "L");
  code.addData(value, "Byte");
  code.make();

  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) =>
      code.isDark(row, column) ? 1 : 0,
    ),
  );
}
