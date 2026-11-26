import type { PaymentMethod } from "./api";
import { parseLocaleNumber } from "./format";

export type CartLine = {
  key: string;
  productId: string | null;
  label: string;
  // Precio de SIM (o escrito en la caja si el producto no tiene precio o es monto libre).
  unitPrice: number | null;
  typedPrice: boolean;
  // Texto tal como se escribe (acepta coma decimal en productos por peso).
  quantity: string;
  weight: boolean;
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

/** Cantidad numérica de una línea, o null si no se puede leer. */
export function lineQuantity(line: CartLine): number | null {
  const parsed = parseLocaleNumber(line.quantity);
  if (parsed === null || parsed === undefined) return null;
  const value = Number(parsed);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!line.weight && !Number.isInteger(value)) return null;
  return value;
}

export function lineTotal(line: CartLine): number | null {
  const quantity = lineQuantity(line);
  if (quantity === null || line.unitPrice === null) return null;
  // En milésimas y con enteros, para redondear igual que el servidor (mitad hacia arriba).
  const milli = Math.round(quantity * 1000) * line.unitPrice;
  return Math.floor((milli + 500) / 1000);
}

