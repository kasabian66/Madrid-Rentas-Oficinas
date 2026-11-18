# Madrid Rentas de Oficinas

Aplicación Next.js 15 / React 19 / TypeScript, preparada para Vercel. Alcance exclusivo: **oficinas en alquiler en Madrid capital**. Se excluyen compraventa, viviendas, locales, naves, coworking, centros de negocios y alquiler por puesto.

## Datos económicos y unidades

Los tres conceptos se almacenan y muestran normalizados en **€/m²/mes**:

- Renta.
- Gastos de comunidad o mantenimiento (*Service Charge*).
- IBI.
- Coste total mensual: suma de los tres anteriores, solo si todos están disponibles.

Los importes anuales expresados explícitamente por m² se dividen entre 12. La extracción automática no convierte importes totales sin una base inequívoca; esos datos quedan pendientes para evitar estimaciones incorrectas. Los campos manuales se introducen directamente en €/m²/mes.

## Fuentes consultadas

Belbex, LoopNet España, JLL, CBRE, Savills y Cushman & Wakefield. El buscador consulta resultados públicos indexados y visita fichas individuales. La extracción es heurística, depende del HTML de cada portal y puede verse limitada por sus controles. No se garantiza un número mínimo de resultados. Solo se incorporan fichas con superficie y renta identificables, y los gastos no publicados quedan vacíos.

El distrito automático solo se asigna si aparece en la dirección extraída; en caso contrario figura como «Sin determinar». No se deduce a partir del texto comercial de la página.

## Datos y privacidad

Las ofertas de la sesión se guardan en el almacenamiento local del navegador. No existe una base de datos compartida ni sincronización entre dispositivos. Borrar los datos del sitio en el navegador elimina esa copia local. No se requieren claves de API de pago ni se almacenan credenciales de usuario.

## Validaciones incluidas

- Validación de superficie, renta, gastos y URL en la incorporación manual.
- Los filtros de superficie y renta excluyen fichas cuyo dato necesario está pendiente.
- Validación de host y protocolo HTTPS para enlaces consultados por el servidor.
- Límites de tiempo y concurrencia en consultas externas.
- Exportación CSV con protección frente a fórmulas ejecutables en hojas de cálculo.

## Limitaciones conocidas

- La búsqueda automática no está validada de forma exhaustiva para todos los formatos de anuncios de cada portal.
- Solo se extraen tarifas con unidades explícitas por m²; los importes totales de comunidad o IBI requieren revisión manual.
- El almacenamiento es local al navegador y no ofrece histórico, sincronización ni recuperación entre dispositivos.
- No hay mapa ni geocodificación.
- No se incluyen todavía pruebas automatizadas unitarias o end-to-end en el repositorio.
