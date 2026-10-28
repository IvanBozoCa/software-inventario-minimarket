# Pruebas E2E del modo Caja (histórico)

`caja.spec.ts` prueba el modo Caja (POS) de la etapa anterior del proyecto.
Ese modo ya no se monta en la aplicación (ver `src/legacy/CajaApp.tsx`), por lo
que esta prueba no forma parte de `npm run test:e2e`. Se conserva como
referencia por si el POS vuelve a ser parte del producto.
