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

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item: { msg?: string; loc?: unknown[] }) => {
          const field = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1]) : "";
          const msg = (item.msg ?? "").replace(/^Value error, /, "");
          return field ? `${field}: ${msg}` : msg;
        })
        .join(" · ");
    }
  } catch {
    // sin cuerpo legible
  }
  return "No fue posible completar la acción";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  health: () => request<{ status: string }>("/health"),

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
