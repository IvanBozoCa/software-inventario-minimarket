import type { ContentUnit, MarketScope, StockUnit } from "./api";

const clp = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const clpExact = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatClp(value: number | string | null | undefined, exact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return "—";
  return (exact ? clpExact : clp).format(numeric);
}

export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return "—";
  return `${(numeric * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`;
}

/** Convierte una proporción (0.25) a texto en porcentaje para formularios (25). */
export function ratioToPercentInput(value: string | null | undefined): string {
  if (!value) return "";
  const numeric = Number(value) * 100;
  return Number.isNaN(numeric) ? "" : String(Math.round(numeric * 100) / 100);
}

/** Convierte un porcentaje escrito (25 o 25,5) a proporción en texto (0.255). */
export function percentInputToRatio(value: string): string | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isNaN(numeric)) return null;
  return (numeric / 100).toFixed(4);
}

export function parseDecimalInput(value: string): string | null {
  const trimmed = value.trim().replace(/\./g, "").replace(",", ".");
  if (!trimmed) return null;
  return Number.isNaN(Number(trimmed)) ? null : trimmed;
}

export const STOCK_UNIT_LABEL: Record<StockUnit, string> = {
  UNIT: "unidades",
  KG: "kg",
  L: "litros",
};

export const CONTENT_UNIT_LABEL: Record<ContentUnit, string> = {
  G: "g",
  KG: "kg",
  ML: "ml",
  L: "L",
  UNIT: "un.",
};

export const SCOPE_LABEL: Record<MarketScope, string> = {
  PICHILEMU: "Pichilemu",
  OHIGGINS: "Región de O'Higgins",
  NATIONAL: "Nacional",
  WEB: "Precio web",
};

export function formatQuantity(value: string | null | undefined, unit: StockUnit): string {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  const text = numeric.toLocaleString("es-CL", { maximumFractionDigits: 3 });
  return unit === "UNIT" ? text : `${text} ${STOCK_UNIT_LABEL[unit]}`;
}

export function formatContent(amount: string | null, unit: ContentUnit | null): string {
  if (!amount || !unit) return "";
  const numeric = Number(amount);
  const text = Number.isNaN(numeric) ? amount : numeric.toLocaleString("es-CL", { maximumFractionDigits: 3 });
  return `${text} ${CONTENT_UNIT_LABEL[unit]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function productTitle(product: {
  name: string;
  brand: string | null;
  variant: string | null;
  content_amount: string | null;
  content_unit: ContentUnit | null;
}): string {
  const parts = [product.name];
  if (product.brand) parts.push(product.brand);
  if (product.variant) parts.push(product.variant);
  const content = formatContent(product.content_amount, product.content_unit);
  if (content) parts.push(content);
  return parts.join(" · ");
}
