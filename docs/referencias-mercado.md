# Referencias de precios de mercado

## Principios

- Cada referencia identifica **fuente, cobertura geográfica, fecha de
  observación, tipo de precio (habitual o promoción) y vigencia** cuando se
  conoce.
- Las referencias viven separadas del inventario. Se asocian a un producto
  propio como **mismo producto** (misma marca, variante y presentación) o como
  **producto equivalente**.
- SIM no promedia precios de mercado ni los usa para fijar el precio. Muestra
  los valores más bajo y más alto entre referencias exactas, vigentes y
  habituales, con su fuente.
- Una referencia con más de N días desde su última observación se marca
  "Precio por verificar" (N configurable en Precios de mercado, 30 por
  defecto). Las promociones vencidas se conservan pero no se presentan como
  vigentes.
- Un precio web nacional no es el precio vigente en Pichilemu. Por eso la
  cobertura `WEB` se muestra como "Precio web" y se separa de `PICHILEMU`,
  `OHIGGINS` y `NATIONAL`.

## Fuentes evaluadas (28-10-2026)

| Fuente | Resultado | Uso en SIM |
| --- | --- | --- |
| **ODEPA – Precios al consumidor** (odepa.gob.cl/precios/consumidor, datos.odepa.gob.cl) | Publica precios semanales de abarrotes, carnes, frutas, verduras, lácteos y pan en supermercados y ferias de 9 regiones (Arica y Parinacota, Coquimbo, Valparaíso, Metropolitana, Maule, Ñuble, Biobío, La Araucanía, Los Lagos). **La Región de O'Higgins no está en la cobertura publicada.** El portal de datos abiertos y el sitio no fueron accesibles desde el entorno de desarrollo (bloqueo a rastreadores), por lo que no se verificó licencia ni formato de descarga. | No integrada. Es la fuente pública más prometedora para abarrotes y frescos a nivel regional; conviene revisarla manualmente y cargar por CSV con cobertura `NATIONAL` o la región que corresponda. |
| **SERNAC – cotizadores** (sernac.cl) | Cotizadores puntuales (Fiestas Patrias, materiales de construcción); no hay un comparador permanente de abarrotes ni descarga de datos. | No integrada. |
| **Lider.cl** (super.lider.cl) | Páginas públicas de categoría con precio normal y "Rebaja" (sin vigencia ni tienda indicada). No hay API pública documentada. | 11 observaciones tomadas manualmente el 28-10-2026 (bebidas 1,5 L / 2 L). |
| **Jumbo.cl** (jumbo.cl) | Páginas públicas con precio normal y "Oferta" (sin vigencia ni tienda), y promociones por cantidad ("Lleva 2 por…") que no se registran como precio unitario. Sin API pública documentada. | 14 observaciones manuales el 28-10-2026 (bebidas, arroz, azúcar, aceite, leche). |
| Unimarc, Santa Isabel, Tottus, negocios de Pichilemu | No se consultaron en esta etapa. | Se registran manualmente cuando el administrador observe precios. |

No se implementó ningún rastreo automático: dependería de técnicas que
pueden incumplir las condiciones de uso de los sitios y de un mantenimiento
constante. La vía prevista es la carga manual y la importación CSV.

## Datos precargados

Archivo: `backend/data/referencias_mercado_2026-10-28.csv` (25 observaciones,
18 referencias, 2 fuentes). Carga con:

```bash
cd backend && python scripts/seed_market_references.py
```

La carga es idempotente: una observación con la misma referencia, fecha, tipo
y precio no se duplica. Todas las referencias quedan **sin asociar** a
productos propios: el administrador decide la asociación y si es coincidencia
exacta o equivalente.

Cobertura real precargada: Coca-Cola (1,5 L original y sin azúcar; 2 L
desechable y retornable), Pepsi 1,5 L, Inca Kola 1,5 L, Sprite 1,5 L, Fanta
Naranja 1,5 L, Arroz Tucapel grado 1 1 kg, Azúcar Iansa 1 kg, Aceite Chef
maravilla 1 L, Leche Colun entera 1 L. Cualquier otro producto del minimarket
aparecerá como "pendiente de referencias" hasta que se registren.

## Formato CSV de importación

Codificación UTF-8, separador coma o punto y coma (se detecta solo, como guarda Excel en Chile), primera fila con encabezados. Los valores aceptan el código interno o su nombre en español (sin importar tildes ni mayúsculas). La pantalla Mercado › Importar CSV ofrece una plantilla.

| Columna | Obligatoria | Valores |
| --- | --- | --- |
| `fuente` | sí | Nombre de la tienda/sitio. Se crea si no existe. |
| `tipo_fuente` | sí | `LOCAL_STORE`, `SUPERMARKET_WEB`, `PUBLIC_AGENCY`, `OTHER` o Negocio local, Supermercado, Organismo público, Otra |
| `cobertura` | sí | `PICHILEMU`, `OHIGGINS`, `NATIONAL`, `WEB` o Pichilemu, Región de O'Higgins, Nacional, Web |
| `localidad` | no | Texto libre (p. ej. Pichilemu). |
| `url_fuente` | no | Sitio de la fuente. |
| `producto` | sí | Nombre del producto observado. |
| `marca`, `variante` | no | |
| `contenido`, `unidad_contenido` | no (ambos o ninguno) | Número y `G`, `KG`, `ML`, `L`, `UNIT`. Permite el precio por kg/L/unidad. |
| `precio_clp` | sí | Entero en pesos (acepta `1990`, `1.990` y `$1.990`), hasta $100.000.000. |
| `tipo_precio` | sí | `REGULAR` o `PROMO` (o Habitual, Promoción). |
| `promo_desde`, `promo_hasta` | no (solo `PROMO`) | `AAAA-MM-DD` o `dd-mm-aaaa`; el término no puede ser anterior a la observación. |
| `fecha_observacion` | sí | `AAAA-MM-DD` o `dd-mm-aaaa`; no puede estar en el futuro. |
| `url` | no | Página concreta del producto. |
| `notas` | no | Texto libre (p. ej. "etiqueta Oferta, sin vigencia"). |

Las filas con error se informan por número de línea y no bloquean el resto.
