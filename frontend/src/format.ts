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

/** Convierte una proporción (0.25) a texto en porcentaje para formularios (25 o 25,5). */
export function ratioToPercentInput(value: string | null | undefined): string {
  if (!value) return "";
  const numeric = Number(value) * 100;
  return Number.isNaN(numeric) ? "" : String(Math.round(numeric * 100) / 100).replace(".", ",");
}

/** Convierte un porcentaje escrito (25, 25,5 o 25 %) a proporción en texto (0.255). */
export function percentInputToRatio(value: string): string | null {
  const parsed = parseLocaleNumber(value);
  if (parsed === null || parsed === undefined) return null;
  return (Number(parsed) / 100).toFixed(4);
}

/**
 * Lee un número escrito a la chilena y lo devuelve normalizado ("1990.5").
 * Devuelve null si el campo está vacío y undefined si no se entiende.
 *
 * Acepta "$" y "%", espacios, la coma decimal (1,5) y el punto de miles
 * (1.990). El punto se toma como separador de miles solo si lo siguen grupos
 * de exactamente tres dígitos; si no, es un punto decimal (1990.5, 1.5,
 * 1450.00), como lo escribe un teclado numérico o la propia API.
 */
export function parseLocaleNumber(raw: string): string | null | undefined {
  const text = raw.replace(/[\s\u00a0]/g, "").replace(/^\$/, "").replace(/^(-?)\$/, "$1").replace(/%$/, "");
  if (!text) return raw.trim() ? undefined : null;
  let normalized: string;
  if (text.includes(",")) {
    if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(text)) return undefined;
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else if (/^-?(\d+|\d*\.\d+)$/.test(text)) {
    normalized = text;
  } else {
    return undefined;
  }
  return Number.isFinite(Number(normalized)) ? normalized : undefined;
}

/** Valor numérico de la API ("1450.00", "1.500") listo para editar en un campo ("1.450", "1,5"). */
export function toNumberInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "";
  return numeric.toLocaleString("es-CL", { maximumFractionDigits: 3, useGrouping: true });
}

export class FieldError extends Error {}

export const MAX_PRICE_CLP = 100_000_000;

/**
 * Lee un campo numérico de formulario. Devuelve el valor normalizado, null si
 * está vacío y no es obligatorio, o lanza FieldError con un mensaje que dice
 * qué escribir. Nunca descarta en silencio un valor que no entiende.
 */
export function readNumberField(
  raw: string,
  label: string,
  options: { required?: boolean; integer?: boolean; min?: number; max?: number; example: string; positive?: boolean },
): string | null {
  const parsed = parseLocaleNumber(raw);
  if (parsed === null) {
    if (options.required) throw new FieldError(`Ingresa ${label}, por ejemplo ${options.example}.`);
    return null;
  }
  if (parsed === undefined) {
    throw new FieldError(`No se entiende ${label} «${raw.trim()}». Escribe solo números, por ejemplo ${options.example}.`);
  }
  const numeric = Number(parsed);
  if (numeric < 0) throw new FieldError(`${capitalize(label)} no puede ser negativo.`);
  if (options.positive && numeric === 0) throw new FieldError(`${capitalize(label)} debe ser mayor que cero.`);
  if (options.integer && !Number.isInteger(numeric)) {
    throw new FieldError(`${capitalize(label)} va en pesos enteros, sin decimales (por ejemplo ${options.example}).`);
  }
  if (options.min !== undefined && numeric < options.min) {
    throw new FieldError(`${capitalize(label)} debe ser al menos ${options.min.toLocaleString("es-CL")}.`);
  }
  if (options.max !== undefined && numeric > options.max) {
    throw new FieldError(`${capitalize(label)} es demasiado alto; revisa que no sobre un dígito.`);
  }
  return options.integer ? String(Math.round(numeric)) : parsed;
}

/** Lee un margen en porcentaje (25, 25,5 o 25 %) y lo devuelve como proporción. */
export function readMarginField(raw: string, label: string): string | null {
  const value = readNumberField(raw, label, { example: "25" });
  if (value === null) return null;
  if (Number(value) >= 100) throw new FieldError(`${capitalize(label)} debe ser menor que 100 %.`);
  return (Number(value) / 100).toFixed(4);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * ¿Conviene pedir confirmación antes de guardar este precio? Devuelve el
 * motivo, o null si el precio parece normal.
 */
export function priceWarning(next: number, previous: number | null, cost?: number | null): string | null {
  if (next === 0) return "El precio queda en $0.";
  if (cost !== null && cost !== undefined && cost > 0 && next < cost) {
    return `El precio (${formatClp(next)}) queda bajo el costo (${formatClp(cost)}).`;
  }
  if (previous !== null && previous > 0) {
    const change = (next - previous) / previous;
    if (Math.abs(change) > 0.5) {
      return `El precio cambia de ${formatClp(previous)} a ${formatClp(next)} (${change > 0 ? "+" : ""}${Math.round(change * 100)} %).`;
    }
  }
  return null;
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

/** Minúsculas y sin tildes, para buscar sin importar cómo se escribió. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
