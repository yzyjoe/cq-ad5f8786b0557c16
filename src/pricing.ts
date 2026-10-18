export const EXCHANGE_RATE = 1.22; // CNY per BRL, confirmed for this quotation.
export const INSURANCE_RATE = 0.06;
export const MAX_CART_WEIGHT_GRAMS = 6000;

// BJ EUB: each started 100 g is charged at the next 100 g bracket.
const BJ_EUB_CNY = [
  48, 63, 76, 90, 105, 120, 134, 148, 162, 176,
  191, 205, 220, 233, 248, 262, 276, 291, 305, 319,
] as const;

export type PricedProduct = {
  id: string;
  cny: number;
  weightGrams: number;
};

export type Quote = {
  itemCount: number;
  weightGrams: number;
  shippingMethod: "BJ EUB" | "SH SAL" | null;
  productCny: number;
  shippingCny: number;
  insuranceCny: number;
  additionalCny: number;
  quoteCny: number;
  productBrl: number;
  shippingBrl: number;
  insuranceBrl: number;
  additionalBrl: number;
  roundingBrl: number;
  baseBrl: number;
  serviceBrl: number;
  totalBrl: number;
  isConfirmedTechSetExample: boolean;
  overLimit: boolean;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function shippingPriceCny(weightGrams: number): number | null {
  if (!Number.isFinite(weightGrams) || weightGrams < 0 || weightGrams > MAX_CART_WEIGHT_GRAMS) return null;
  if (weightGrams === 0) return 0;
  if (weightGrams <= 2000) return BJ_EUB_CNY[Math.ceil(weightGrams / 100) - 1];
  if (weightGrams <= 3000) return 328;
  if (weightGrams <= 4000) return 392;
  if (weightGrams <= 5000) return 456;
  return 520;
}

export function serviceFeeBrl(itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (itemCount === 1) return 20;
  if (itemCount === 2) return 35;
  return 45 + (itemCount - 3) * 10;
}

export function calculateQuote(cart: Record<string, number>, products: readonly PricedProduct[]): Quote {
  const itemCount = products.reduce((sum, product) => sum + Math.max(0, cart[product.id] || 0), 0);
  const weightGrams = products.reduce((sum, product) => sum + product.weightGrams * Math.max(0, cart[product.id] || 0), 0);
  const productCny = products.reduce((sum, product) => sum + product.cny * Math.max(0, cart[product.id] || 0), 0);
  const overLimit = weightGrams > MAX_CART_WEIGHT_GRAMS;
  const shippingCny = shippingPriceCny(weightGrams) ?? 0;
  const insuranceCny = itemCount ? roundMoney((productCny + shippingCny) * INSURANCE_RATE) : 0;

  // The owner's complete 761 CNY example includes photos, domestic freight and
  // other CSSBuy costs. It is only valid for one jacket + one pair of pants.
  const isConfirmedTechSetExample = itemCount === 2 && cart["tech-jacket"] === 1 && cart["tech-pants"] === 1;
  const additionalCny = isConfirmedTechSetExample ? roundMoney(761 - productCny - shippingCny - insuranceCny) : 0;
  const quoteCny = roundMoney(productCny + shippingCny + insuranceCny + additionalCny);
  const productBrl = roundMoney(productCny / EXCHANGE_RATE);
  const shippingBrl = roundMoney(shippingCny / EXCHANGE_RATE);
  const insuranceBrl = roundMoney(insuranceCny / EXCHANGE_RATE);
  const additionalBrl = roundMoney(additionalCny / EXCHANGE_RATE);
  const baseBrl = isConfirmedTechSetExample ? 625 : roundMoney(quoteCny / EXCHANGE_RATE);
  const roundingBrl = roundMoney(baseBrl - productBrl - shippingBrl - insuranceBrl - additionalBrl);
  const serviceBrl = serviceFeeBrl(itemCount);

  return {
    itemCount, weightGrams, shippingMethod: itemCount ? (weightGrams <= 2000 ? "BJ EUB" : "SH SAL") : null,
    productCny, shippingCny, insuranceCny, additionalCny, quoteCny,
    productBrl, shippingBrl, insuranceBrl, additionalBrl, roundingBrl,
    baseBrl, serviceBrl, totalBrl: roundMoney(baseBrl + serviceBrl),
    isConfirmedTechSetExample, overLimit,
  };
}
