// Public receiving details previously used on this site, reconfirmed by the owner.
export const PIX_RECEIVER = {
  key: "0d203c06-b2e4-4104-b091-a433966f8224",
  name: "JOAO LUCAS PRUDENTE",
  city: "GUARULHOS",
} as const;

function tlv(id: string, value: string): string {
  if (!/^\d{2}$/.test(id) || value.length > 99) throw new Error("Campo Pix inválido.");
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16(value: string): string {
  let crc = 0xffff;
  for (let index = 0; index < value.length; index += 1) {
    crc ^= value.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function createPaymentReference(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `K${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function createPixPayload(amountBrl: number, reference: string): string {
  if (!Number.isFinite(amountBrl) || amountBrl <= 0 || amountBrl > 999999.99 || Math.round(amountBrl * 100) / 100 !== amountBrl) {
    throw new Error("Valor Pix inválido.");
  }
  if (!/^K[A-Z0-9]{1,24}$/.test(reference)) throw new Error("Referência Pix inválida.");
  const merchantAccount = tlv("00", "br.gov.bcb.pix") + tlv("01", PIX_RECEIVER.key);
  const fields = tlv("00", "01") + tlv("26", merchantAccount) + tlv("52", "0000") + tlv("53", "986")
    + tlv("54", amountBrl.toFixed(2)) + tlv("58", "BR") + tlv("59", PIX_RECEIVER.name.slice(0, 25))
    + tlv("60", PIX_RECEIVER.city.slice(0, 15)) + tlv("62", tlv("05", reference));
  const body = `${fields}6304`;
  return body + crc16(body);
}

export type PaymentLinkData = {
  reference: string;
  amountBrl: number;
  cart: Record<string, number>;
  sizes: Record<string, string>;
};

export function paymentLinkHash(data: PaymentLinkData): string {
  return `#pay/${encodeURIComponent(JSON.stringify(data))}`;
}

export function readPaymentLink(hash: string, allowedIds: readonly string[]): PaymentLinkData | null {
  if (!hash.startsWith("#pay/") || hash.length > 4096) return null;
  try {
    const data = JSON.parse(decodeURIComponent(hash.slice(5))) as Partial<PaymentLinkData>;
    if (!data || !/^K[A-Z0-9]{1,24}$/.test(data.reference || "")) return null;
    if (typeof data.amountBrl !== "number" || !Number.isFinite(data.amountBrl) || data.amountBrl <= 0) return null;
    if (!data.cart || typeof data.cart !== "object" || Array.isArray(data.cart)) return null;
    if (!data.sizes || typeof data.sizes !== "object" || Array.isArray(data.sizes)) return null;
    const cart: Record<string, number> = {};
    const sizes: Record<string, string> = {};
    for (const [id, quantity] of Object.entries(data.cart)) {
      if (!allowedIds.includes(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) return null;
      cart[id] = quantity;
    }
    if (!Object.keys(cart).length) return null;
    for (const [id, size] of Object.entries(data.sizes)) {
      if (!allowedIds.includes(id) || typeof size !== "string" || size.length > 70) return null;
      sizes[id] = size;
    }
    return { reference: data.reference!, amountBrl: data.amountBrl, cart, sizes };
  } catch {
    return null;
  }
}
