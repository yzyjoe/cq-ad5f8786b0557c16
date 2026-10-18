import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, shippingPriceCny, serviceFeeBrl } from "../src/pricing.ts";

test("BJ EUB uses 100 g brackets and stops at 2 kg", () => {
  assert.equal(shippingPriceCny(1), 48);
  assert.equal(shippingPriceCny(100), 48);
  assert.equal(shippingPriceCny(101), 63);
  assert.equal(shippingPriceCny(1000), 176);
  assert.equal(shippingPriceCny(1200), 205);
  assert.equal(shippingPriceCny(2000), 319);
});

test("SH SAL covers every weight up to 6 kg, with no undefined 7 kg price", () => {
  assert.equal(shippingPriceCny(2001), 328);
  assert.equal(shippingPriceCny(3000), 328);
  assert.equal(shippingPriceCny(3001), 392);
  assert.equal(shippingPriceCny(4001), 456);
  assert.equal(shippingPriceCny(6000), 520);
  assert.equal(shippingPriceCny(6001), null);
  assert.equal(shippingPriceCny(7000), null);
});

test("the existing Kicknity service fee remains separate", () => {
  assert.equal(serviceFeeBrl(1), 20);
  assert.equal(serviceFeeBrl(2), 35);
  assert.equal(serviceFeeBrl(3), 45);
  assert.equal(serviceFeeBrl(4), 55);
});

test("one 2025 Tech Fleece set uses the owner's complete quotation", () => {
  const products = [
    { id: "tech-jacket", cny: 255, weightGrams: 650 },
    { id: "tech-pants", cny: 245, weightGrams: 550 },
  ];
  const quote = calculateQuote({ "tech-jacket": 1, "tech-pants": 1 }, products);
  assert.equal(quote.weightGrams, 1200);
  assert.equal(quote.productCny, 500);
  assert.equal(quote.shippingCny, 205);
  assert.equal(quote.insuranceCny, 42.3);
  assert.equal(quote.additionalCny, 13.7);
  assert.equal(quote.quoteCny, 761);
  assert.equal(quote.baseBrl, 625);
  assert.equal(quote.serviceBrl, 35);
  assert.equal(quote.totalBrl, 660);
  assert.equal(quote.isConfirmedTechSetExample, true);
});

test("other quantities do not inherit the set's fixed example price", () => {
  const products = [
    { id: "tech-jacket", cny: 255, weightGrams: 650 },
    { id: "tech-pants", cny: 245, weightGrams: 550 },
  ];
  const quote = calculateQuote({ "tech-jacket": 2, "tech-pants": 1 }, products);
  assert.equal(quote.isConfirmedTechSetExample, false);
  assert.equal(quote.additionalCny, 0);
  assert.equal(quote.insuranceCny, Math.round((755 + 305) * 0.06 * 100) / 100);
});

test("an over-limit basket is explicitly flagged", () => {
  const quote = calculateQuote({ shoe: 9 }, [{ id: "shoe", cny: 143, weightGrams: 704 }]);
  assert.equal(quote.weightGrams, 6336);
  assert.equal(quote.overLimit, true);
});
