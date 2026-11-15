# Madrid Rentas de Oficinas

Aplicación Next.js preparada para Vercel. Alcance exclusivo: **oficinas en alquiler en Madrid capital**. Se excluyen compraventa, viviendas, locales, naves, coworking, centros de negocios y alquiler por puesto.

## Fuentes abiertas previstas
Belbex, LoopNet España, JLL, CBRE, Savills y Cushman & Wakefield. El buscador consulta resultados públicos indexados y visita fichas de anuncios. La extracción automática es heurística y los portales pueden limitarla o modificar sus páginas. No se garantiza un mínimo fijo de resultados: solo se incorporan fichas cuando se pueden detectar datos suficientes y se excluyen páginas de búsqueda y anuncios que no parecen corresponder a Madrid capital.

## Datos económicos
- Renta: €/m²/mes.
- Comunidad: €/m²/mes.
- IBI: €/m²/mes.
- Coste total: suma de renta, comunidad e IBI, solo cuando los tres están disponibles.
- Los importes no publicados quedan pendientes; nunca se sustituyen por cero.

## Despliegue
Proyecto Next.js vinculado a Vercel. No requiere claves de API de pago.

## Limitaciones de la primera versión
Los resultados se mantienen en la sesión del navegador. Todavía no hay base de datos, histórico de cambios, geocodificación, alertas ni sincronización programada. El formulario manual permite completar datos que no aparecen en los anuncios. La búsqueda automática debe validarse con ejemplos reales de cada portal antes de considerarla exhaustiva.
