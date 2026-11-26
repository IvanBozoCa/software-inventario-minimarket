import { createContext, useContext } from "react";

export type UserRole = "ADMIN" | "SELLER";

export type SessionUser = {
  name: string;
  email: string | null;
  role: UserRole;
  canEditPrices: boolean;
};

// Sin sesión restringida (equipo local) se trabaja como administrador.
export const LOCAL_ADMIN: SessionUser = { name: "Administrador", email: null, role: "ADMIN", canEditPrices: true };

export const SessionContext = createContext<SessionUser>(LOCAL_ADMIN);

export function useSession() {
  const user = useContext(SessionContext);
  return { ...user, isAdmin: user.role === "ADMIN" };
}

export const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  SELLER: "Vendedor",
};
