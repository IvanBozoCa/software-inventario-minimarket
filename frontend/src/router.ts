export type Route =
  | { page: "inventory" }
  | { page: "product-new" }
  | { page: "product-edit"; id: string }
  | { page: "product"; id: string }
  | { page: "categories" }
  | { page: "market" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [head, second, third] = path.split("/");
  if (head === "productos" && second === "nuevo") return { page: "product-new" };
  if (head === "productos" && second && third === "editar") return { page: "product-edit", id: second };
  if (head === "productos" && second) return { page: "product", id: second };
  if (head === "categorias") return { page: "categories" };
  if (head === "mercado") return { page: "market" };
  return { page: "inventory" };
}

export function navigate(path: string) {
  window.location.hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
}
