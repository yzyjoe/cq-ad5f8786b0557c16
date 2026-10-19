import test from "node:test";
import assert from "node:assert/strict";
import { createPixPayload, paymentLinkHash, readPaymentLink } from "../src/pix.ts";

const reference = "K12345678901234567890";

test("Pix payload contains the confirmed receiver, BRL amount and reference", () => {
  const code = createPixPayload(660, reference);
  assert.ok(code.startsWith("000201"));
  assert.ok(code.includes("br.gov.bcb.pix"));
  assert.ok(code.includes("0d203c06-b2e4-4104-b091-a433966f8224"));
  assert.ok(code.includes("5406660.00"));
  assert.ok(code.includes(`05${reference.length}${reference}`));
  assert.match(code, /6304[0-9A-F]{4}$/);
});

test("Pix rejects an invalid amount or transaction reference", () => {
  assert.throws(() => createPixPayload(0, reference));
  assert.throws(() => createPixPayload(-5, reference));
  assert.throws(() => createPixPayload(10.001, reference));
  assert.throws(() => createPixPayload(10, "INVALID/REF"));
});

test("shareable payment link restores only allowed products", () => {
  const hash = paymentLinkHash({ reference, amountBrl: 660, cart: { "tech-jacket": 1, "tech-pants": 1 }, sizes: { "tech-jacket": "M" } });
  assert.deepEqual(readPaymentLink(hash, ["tech-jacket", "tech-pants"]), {
    reference, amountBrl: 660, cart: { "tech-jacket": 1, "tech-pants": 1 }, sizes: { "tech-jacket": "M" },
  });
  assert.equal(readPaymentLink("#pay/%7B%22cart%22%3A%7B%22fake%22%3A1%7D%7D", ["tech-jacket"]), null);
  assert.equal(readPaymentLink("#pay/not-json", ["tech-jacket"]), null);
});
