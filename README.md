# AlbionEconomy

Herramienta de economía para Albion Online (servidor Américas por defecto): flipping entre ciudades y Mercado Negro, y próximamente crafteo, refinado y transmutación.

Los precios vienen de [Albion Online Data Project](https://www.albion-online-data.com) (datos aportados por jugadores, por eso cada precio se marca con su antigüedad). Las imágenes salen de `render.albiononline.com`.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/ (sitio estático, sin backend)
npm run catalog    # regenera public/data/*.json desde ao-bin-dumps (tras un parche del juego)
```

## Módulos

- **Flipping** (listo): mejor ruta de compra→venta por ítem, con impuestos premium/sin premium, tarifas de orden, semáforo de frescura y volumen de ventas.
- **Crafteo y Refinado** (listos): costo de materiales (ingrediente más barato entre las ciudades elegidas) con retorno de recursos, tarifa de estación, impuestos y mejor ciudad de venta / Mercado Negro.
- **Transmutación** (listo): (a) subir ítems de .0 a .3 con runas, almas y reliquias, con las cantidades reales de cada ítem; (b) transmutar recursos (madera, mineral, fibra, cuero, piedra) de .0 a .4 pagando plata. Evalúa todas las rutas y muestra la mejor. El paso a .4 en ítems (fragmentos avalonianos) no está incluido: los datos del juego no traen su cantidad.

## Actualización automática de precios

La API de Albion Data limita a **100 peticiones/min y 300 cada 5 min por IP**, así que la web no la consulta al abrirse. Un workflow de GitHub Actions (`.github/workflows/update.yml`, cada ~10 min) ejecuta `scripts/fetch-prices.mjs`, que baja los precios y los publica como archivos estáticos en `data/prices/`:

- **Corrida rápida** (cada vez): ítems T4–T8 sin encantar + ingredientes de sus recetas → ~19 peticiones.
- **Con encantados** (cada ~30 min): T4–T8 con cualquier encantamiento → ~59 peticiones.
- **Barrido completo** (cada ~90 min): todo el catálogo salvo cosméticos, mobiliario y "otros" → ~64 peticiones.
- Si la API falla, se conserva el dato anterior y el sitio sigue funcionando.
- En la web, "Consultar en vivo" va directo a la API (usa el cupo de tu IP); otra calidad u otro servidor también la usan.

Local: `npm run prices` genera `public/data/prices/` (ignorado por git) para probar con datos reales.

## Despliegue gratis

Todo corre en GitHub Pages con el mismo workflow:

1. Sube el repo a GitHub (**público**, para minutos de Actions ilimitados).
2. *Settings → Pages → Source: GitHub Actions*.
3. Lanza el workflow una vez (*Actions → Run workflow*, marcando "barrido completo"). Desde ahí se actualiza solo.

Nota: GitHub desactiva los workflows programados tras 60 días sin actividad en el repo; basta con reactivarlo.
