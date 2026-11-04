import test from "node:test";
import assert from "node:assert/strict";
import QR from "../../src/lib/qrMin.ts";

function assertSquareMatrix(matrix) {
  assert.ok(matrix.length > 0);
  assert.ok(matrix.every((row) => row.length === matrix.length));
  assert.ok(matrix.every((row) => row.every((cell) => cell === 0 || cell === 1)));
}

test("creates QR matrices for Arabic and emoji text", () => {
  const matrix = QR("مرحباً بالعالم 🌍");
  assertSquareMatrix(matrix);
  assert.ok(matrix.length >= 21);
});

test("automatically expands beyond the previous five-version capacity", () => {
  const matrix = QR("https://example.com/" + "long-path-segment/".repeat(30));
  assertSquareMatrix(matrix);
  assert.ok(matrix.length > 37, "expected a QR version larger than version 5");
});

test("encodes long UTF-8 payloads locally", () => {
  const matrix = QR("مرحبا".repeat(250));
  assertSquareMatrix(matrix);
  assert.ok(matrix.length > 37);
});

test("rejects payloads beyond the QR standard capacity without corrupt output", () => {
  assert.throws(() => QR("x".repeat(4000)));
});
