export type Route =
  | { page: "inventory" }
  | { page: "product-new"; barcode?: string }
  | { page: "product-edit"; id: string }
  | { page: "product"; id: string }
  | { page: "categories" }
  | { page: "market" };

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [head, second, third] = path.split("/");
  if (head === "productos" && second === "nuevo") {
    // Código leído con el escáner (#/productos/nuevo?codigo=…).
    const barcode = new URLSearchParams(query).get("codigo")?.trim();
    return barcode ? { page: "product-new", barcode } : { page: "product-new" };
  }
  if (head === "productos" && second && third === "editar") return { page: "product-edit", id: second };
  if (head === "productos" && second) return { page: "product", id: second };
  if (head === "categorias") return { page: "categories" };
  if (head === "mercado") return { page: "market" };
  return { page: "inventory" };
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  const hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
  if (options.replace) {
    // Reemplaza la entrada del historial (p. ej. tras crear un producto, para
    // que "atrás" no vuelva a un formulario en blanco) y avisa del cambio.
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = hash;
}

/** Parámetros después de "?" en la dirección (#/?filtro=revisar). */
export function hashQuery(): URLSearchParams {
  const hash = window.location.hash;
  const index = hash.indexOf("?");
  return new URLSearchParams(index >= 0 ? hash.slice(index + 1) : "");
}

/** Guarda filtros en la dirección sin agregar una entrada al historial. */
export function replaceHashQuery(params: Record<string, string>) {
  const path = window.location.hash.split("?")[0] || "#/";
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== ""));
  const text = query.toString();
  window.history.replaceState(null, "", text ? `${path}?${text}` : path);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Mensaje para mostrar en la próxima pantalla (p. ej. "Cambios guardados").
let flash = "";

export function setFlash(message: string) {
  flash = message;
}

export function takeFlash(): string {
  const message = flash;
  flash = "";
  return message;
}
