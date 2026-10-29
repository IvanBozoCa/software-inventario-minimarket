import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Aviso con el rol accesible que corresponde: los errores se anuncian de
 * inmediato (role="alert") y se llevan a la vista, para que no queden fuera de
 * la pantalla en el celular; los avisos y confirmaciones usan role="status".
 */
export function Alert({
  kind,
  children,
  style,
}: {
  kind: "danger" | "warn" | "ok" | "info";
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const text = typeof children === "string" ? children : null;

  useEffect(() => {
    if (kind === "danger") ref.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [kind, text]);

  return (
    <div ref={ref} className={`alert ${kind}`} role={kind === "danger" ? "alert" : "status"} style={style}>
      {children}
    </div>
  );
}
