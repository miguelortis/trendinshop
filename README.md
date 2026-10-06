# TrendinShop

Plataforma comercial para proveedores y revendedores.

TrendinShop reunirá en una sola aplicación:

- Catálogo maestro de productos.
- Variantes por color, talla y otros atributos.
- Inventario central y movimientos de stock.
- Catálogos personalizados para revendedores.
- Precios de venta y cálculo de ganancias.
- Clientes no registrados con búsqueda por cédula.
- Ventas directas del administrador y ventas de revendedores.
- Cuentas por cobrar y pagos parciales.
- Métodos de pago y comprobantes.
- Enlaces compartibles para catálogos y productos.

## Stack

- Next.js + TypeScript.
- MongoDB + Mongoose.
- Axios.
- TanStack Query v5.
- Zustand.
- Next.js Proxy para el primer control de navegación.
- API integrada en el mismo proyecto mediante Route Handlers.
- Router central en `src/lib/api/router.ts`.

## Desarrollo local

1. Copia `.env.example` a `.env.local`.
2. Configura `MONGODB_URI`.
3. Ejecuta `npm install`.
4. Ejecuta `npm run dev`.

## Roadmap

1. Autenticación, usuarios y roles.
2. Modelos de productos, variantes e inventario.
3. Catálogo de revendedores.
4. Clientes y ventas.
5. Cuentas por cobrar y pagos.
6. Métodos de pago y comprobantes.
7. Compartir catálogo y productos.
8. Dashboard y reportes.
