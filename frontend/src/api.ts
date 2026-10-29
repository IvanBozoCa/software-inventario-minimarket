// Cliente HTTP mínimo para la API local de SIM. Todas las funciones lanzan
// Error con el mensaje en español que devuelve el backend.

export const API_BASE =
  (import.meta.env?.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8010";

export type ContentUnit = "G" | "KG" | "ML" | "L" | "UNIT";
export type StockUnit = "UNIT" | "KG" | "L";
export type MarketScope = "PICHILEMU" | "OHIGGINS" | "NATIONAL" | "WEB";
export type MarketSourceType = "LOCAL_STORE" | "SUPERMARKET_WEB" | "PUBLIC_AGENCY" | "OTHER";
export type MatchType = "EXACT" | "EQUIVALENT";
export type PriceType = "REGULAR" | "PROMO";

export type Category = {
  id: string;
  name: string;
  active: boolean;
  min_margin: string | null;
  upper_margin: string | null;
};

export type Product = {
  id: string;
  name: string;
  barcode: string | null;
  category_id: string | null;
  sale_price_clp: number | null;
  track_stock: boolean;
  active: boolean;
  brand: string | null;
  variant: string | null;
  content_amount: string | null;
  content_unit: ContentUnit | null;
  stock_unit: StockUnit;
  last_unit_cost_clp: string | null;
  extra_supply_cost_clp: string | null;
  min_margin: string | null;
  upper_margin: string | null;
};

export type OverviewRow = {
  id: string;
  name: string;
  brand: string | null;
  variant: string | null;
  content_amount: string | null;
  content_unit: ContentUnit | null;
  category_id: string | null;
  category_name: string | null;
  active: boolean;
  track_stock: boolean;
  stock_unit: StockUnit;
  quantity: string | null;
  sale_price_clp: number | null;
  total_unit_cost_clp: string | null;
  current_gross_margin: string | null;
  cost_pending: boolean;
  margins_pending: boolean;
  market_reference_count: number;
  market_references_stale: boolean;
  needs_review: boolean;
};

export type WarningCode =
  | "COST_MISSING"
  | "PRICE_MISSING"
  | "MARGINS_MISSING"
  | "PRICE_BELOW_COST"
  | "MARGIN_BELOW_MIN"
  | "COST_INCREASED";

export type Pricing = {
  sale_price_clp: number | null;
  unit_cost_clp: string | null;
  extra_supply_cost_clp: string | null;
  total_unit_cost_clp: string | null;
  min_margin: string | null;
  min_margin_source: "PRODUCT" | "CATEGORY" | null;
  upper_margin: string | null;
  upper_margin_source: "PRODUCT" | "CATEGORY" | null;
  price_at_min_margin: string | null;
  price_at_upper_margin: string | null;
  current_gross_margin: string | null;
  current_markup: string | null;
  range_available: boolean;
  needs_review: boolean;
  warnings: { code: WarningCode; message: string }[];
};

export type CostChange = {
  id: string;
  previous_unit_cost_clp: string | null;
  new_unit_cost_clp: string | null;
  previous_extra_cost_clp: string | null;
  new_extra_cost_clp: string | null;
  source: string | null;
  note: string | null;
  changed_at: string;
};

export type PriceChange = {
  id: string;
  previous_price_clp: number | null;
  new_price_clp: number | null;
  note: string | null;
  changed_at: string;
};

export type Observation = {
  id: string;
  reference_id: string;
  price_clp: number;
  price_type: PriceType;
  promo_valid_from: string | null;
  promo_valid_until: string | null;
  observed_on: string;
  url: string | null;
  notes: string | null;
  status: "VALID" | "INVALID";
  invalid_reason: string | null;
  replaced_by_id: string | null;
  age_days: number;
  stale: boolean;
  promo_expired: boolean;
  promo_current: boolean;
  unit_price_clp: string | null;
  unit_price_label: string | null;
};

export type MarketSource = {
  id: string;
  name: string;
  source_type: MarketSourceType;
  scope: MarketScope;
  locality: string | null;
  url: string | null;
  notes: string | null;
  active: boolean;
};

export type MarketReference = {
  id: string;
  source: { id: string; name: string; scope: MarketScope; locality: string | null };
  product_name: string;
  brand: string | null;
  variant: string | null;
  content_amount: string | null;
  content_unit: ContentUnit | null;
  product_url: string | null;
  product_id: string | null;
  match_type: MatchType | null;
  notes: string | null;
  active: boolean;
  last_observed_on: string | null;
  stale: boolean;
  observations: Observation[];
};

export type ComparableExtreme = {
  price_clp: number;
  reference_id: string;
  source_name: string;
  scope: MarketScope;
  observed_on: string;
};

export type ProductDetail = {
  product: Product;
  category_name: string | null;
  quantity: string | null;
  pricing: Pricing;
  cost_history: CostChange[];
  price_history: PriceChange[];
  stock_movements: {
    id: string;
    movement_type: string;
    quantity_delta: string;
    note: string | null;
    created_at: string;
  }[];
  market: {
    stale_days: number;
    has_references: boolean;
    has_stale: boolean;
    exact_regular_low: ComparableExtreme | null;
    exact_regular_high: ComparableExtreme | null;
    references: MarketReference[];
  };
};

export type ImportResult = {
  sources_created: number;
  references_created: number;
  observations_created: number;
  duplicates_skipped: number;
  errors: string[];
};

// Nombres de campos de la API, para explicar los errores en palabras de la persona.
const FIELD_LABEL: Record<string, string> = {
  name: "El nombre",
  product_name: "El nombre del producto",
  barcode: "El código de barras",
  brand: "La marca",
  variant: "La variante",
  content_amount: "El contenido",
  content_unit: "La unidad del contenido",
  sale_price_clp: "El precio de venta",
  price_clp: "El precio",
  last_unit_cost_clp: "El costo unitario",
  extra_supply_cost_clp: "El costo adicional",
  cost_source: "La fuente del costo",
  min_margin: "El margen mínimo",
  upper_margin: "El margen superior",
  initial_quantity: "La cantidad inicial",
  quantity: "La cantidad",
  market_stale_days: "El plazo",
  observed_on: "La fecha de observación",
  promo_valid_until: "La fecha de término de la promoción",
  note: "El motivo",
  notes: "Las notas",
  url: "El sitio web",
  locality: "La localidad",
  reason: "El motivo",
};

type ValidationItem = { msg?: string; type?: string; loc?: unknown[]; ctx?: Record<string, unknown> };

const PERCENT_FIELDS = new Set(["min_margin", "upper_margin"]);

function limit(field: string, value: unknown): string {
  const numeric = Number(value);
  if (PERCENT_FIELDS.has(field)) return `${(numeric * 100).toLocaleString("es-CL")} %`;
  return numeric.toLocaleString("es-CL");
}

/** Traduce un error de validación de la API (en inglés) a una frase en español. */
export function describeValidationError(item: ValidationItem): string {
  const loc = Array.isArray(item.loc) ? item.loc.map(String) : [];
  const field = loc[loc.length - 1] ?? "";
  const label = FIELD_LABEL[field];
  const ctx = item.ctx ?? {};
  const msg = (item.msg ?? "").replace(/^Value error, /, "");
  if (loc[0] === "path" || loc[0] === "query") {
    if (item.type === "uuid_parsing") return "La dirección no corresponde a un registro válido.";
  }
  if (!label) {
    // Mensajes propios de la API (ya en español), p. ej. de validaciones del modelo.
    return /[áéíóúñ]|\b(el|la|no|debe)\b/i.test(msg) ? msg : "Revisa los datos ingresados.";
  }
  switch (item.type) {
    case "less_than":
      return `${label} debe ser menor que ${limit(field, ctx.lt)}.`;
    case "less_than_equal":
      return `${label} debe ser como máximo ${limit(field, ctx.le)}.`;
    case "greater_than":
      return `${label} debe ser mayor que ${limit(field, ctx.gt)}.`;
    case "greater_than_equal":
      return Number(ctx.ge) === 0 ? `${label} no puede ser negativo.` : `${label} debe ser al menos ${limit(field, ctx.ge)}.`;
    case "string_too_long":
      return `${label} puede tener como máximo ${ctx.max_length} caracteres.`;
    case "string_too_short":
    case "missing":
      return `${label} es obligatorio.`;
    case "decimal_max_places":
      return `${label} tiene demasiados decimales.`;
    case "decimal_max_digits":
    case "decimal_whole_digits":
      return `${label} es demasiado grande; revisa que no sobre un dígito.`;
    case "int_parsing":
    case "int_from_float":
    case "decimal_parsing":
    case "float_parsing":
      return `${label} debe ser un número.`;
    case "date_from_datetime_parsing":
    case "date_parsing":
      return `${label} no es una fecha válida.`;
    default:
      return /[áéíóúñ]|\b(el|la|no|debe)\b/i.test(msg) ? msg : `${label} no es válido.`;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return [...new Set(body.detail.map((item: ValidationItem) => describeValidationError(item)))].join(" ");
    }
  } catch {
    // sin cuerpo legible
  }
  if (response.status >= 500) {
    return "El servidor de SIM tuvo un problema y no guardó el cambio. Inténtalo de nuevo en un momento.";
  }
  return "No fue posible completar la acción";
}

/** La petición no llegó al servidor (sin Internet o servidor caído). */
export class NetworkError extends Error {
  constructor() {
    super("No se pudo conectar con SIM. Si estabas guardando, el cambio no se guardó: revisa tu conexión e inténtalo de nuevo.");
  }
}

// Token de acceso para la instalación publicada en Internet. En el equipo
// local el backend no exige contraseña y el token queda vacío.
const TOKEN_KEY = "sim.accessToken";
export const UNAUTHORIZED_EVENT = "sim:unauthorized";
// Se emiten cuando una petición falla por red o vuelve a responder, para que la
// cabecera no diga "Conectado" mientras el servidor no responde.
export const OFFLINE_EVENT = "sim:offline";
export const ONLINE_EVENT = "sim:online";

export function getAccessToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // almacenamiento no disponible (modo privado): la sesión dura la pestaña
  }
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    window.dispatchEvent(new Event(OFFLINE_EVENT));
    throw new NetworkError();
  }
  window.dispatchEvent(new Event(ONLINE_EVENT));
  if (response.status === 401 && path !== "/auth/login") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export type AuthMode = "none" | "password" | "supabase";

export type AccessStatus = {
  required: boolean;
  authenticated: boolean;
  expires_at: string | null;
  mode?: AuthMode;
  supabase_url?: string | null;
  supabase_anon_key?: string | null;
  email?: string | null;
};

export const api = {
  health: () => request<{ status: string }>("/health"),
  accessStatus: () => request<AccessStatus>("/auth/status"),
  login: (password: string) =>
    request<{ token: string; expires_at: string; session_hours: number }>("/auth/login", {
      method: "POST",
      body: json({ password }),
    }),

  categories: (includeInactive = false) =>
    request<Category[]>(`/categories?include_inactive=${includeInactive}`),
  createCategory: (body: Partial<Category>) =>
    request<Category>("/categories", { method: "POST", body: json(body) }),
  updateCategory: (id: string, body: Partial<Category>) =>
    request<Category>(`/categories/${id}`, { method: "PATCH", body: json(body) }),

  overview: (params: { search?: string; categoryId?: string; includeInactive?: boolean }) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.categoryId) query.set("category_id", params.categoryId);
    if (params.includeInactive) query.set("include_inactive", "true");
    return request<OverviewRow[]>(`/products/overview?${query.toString()}`);
  },
  product: (id: string) => request<Product>(`/products/${id}`),
  productDetail: (id: string) => request<ProductDetail>(`/products/${id}/detail`),
  createProduct: (body: Record<string, unknown>) =>
    request<Product>("/products", { method: "POST", body: json(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    request<Product>(`/products/${id}`, { method: "PATCH", body: json(body) }),
  updatePrice: (id: string, sale_price_clp: number, note?: string) =>
    request<Product>(`/products/${id}/price`, {
      method: "PUT",
      body: json({ sale_price_clp, note: note || null }),
    }),
  updateCost: (
    id: string,
    body: { last_unit_cost_clp: string | null; extra_supply_cost_clp: string | null; source?: string; note?: string },
  ) => request<Product>(`/products/${id}/cost`, { method: "PUT", body: json(body) }),
  updateStock: (id: string, quantity: string, note?: string) =>
    request<unknown>(`/products/${id}/stock`, {
      method: "PUT",
      body: json({ quantity, note: note || null }),
    }),

  sources: (includeInactive = false) =>
    request<MarketSource[]>(`/market/sources?include_inactive=${includeInactive}`),
  createSource: (body: Record<string, unknown>) =>
    request<MarketSource>("/market/sources", { method: "POST", body: json(body) }),
  updateSource: (id: string, body: Record<string, unknown>) =>
    request<MarketSource>(`/market/sources/${id}`, { method: "PATCH", body: json(body) }),

  references: (params: { search?: string; unlinked?: boolean; productId?: string }) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.unlinked) query.set("unlinked", "true");
    if (params.productId) query.set("product_id", params.productId);
    return request<MarketReference[]>(`/market/references?${query.toString()}`);
  },
  createReference: (body: Record<string, unknown>) =>
    request<MarketReference>("/market/references", { method: "POST", body: json(body) }),
  updateReference: (id: string, body: Record<string, unknown>) =>
    request<MarketReference>(`/market/references/${id}`, { method: "PATCH", body: json(body) }),
  linkReference: (id: string, product_id: string | null, match_type: MatchType | null) =>
    request<MarketReference>(`/market/references/${id}/link`, {
      method: "PUT",
      body: json({ product_id, match_type }),
    }),
  addObservation: (referenceId: string, body: Record<string, unknown>) =>
    request<MarketReference>(`/market/references/${referenceId}/observations`, {
      method: "POST",
      body: json(body),
    }),
  correctObservation: (id: string, body: Record<string, unknown>) =>
    request<MarketReference>(`/market/observations/${id}/correct`, {
      method: "POST",
      body: json(body),
    }),
  invalidateObservation: (id: string, reason: string) =>
    request<MarketReference>(`/market/observations/${id}/invalidate`, {
      method: "POST",
      body: json({ reason }),
    }),
  importCsv: (csv: string) =>
    request<ImportResult>("/market/import", { method: "POST", body: json({ csv }) }),

  settings: () => request<{ market_stale_days: number }>("/settings"),
  updateSettings: (market_stale_days: number) =>
    request<{ market_stale_days: number }>("/settings", {
      method: "PUT",
      body: json({ market_stale_days }),
    }),
};
