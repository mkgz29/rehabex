# ADMIN-02A — Auditoría funcional y diseño de experiencia del catálogo administrativo

Este documento es de análisis y diseño únicamente. No implementa nada. Su objetivo es dejar un diseño funcional aprobable, con brechas técnicas identificadas, antes de escribir una sola línea de ADMIN-02B/C/D.

**Regla principal de todo este trabajo:** si el cliente necesita entender Supabase, Cloudinary, CTA, URL, slug, assets, IDs, endpoints, pipelines o arquitectura para completar una tarea, la interfaz está mal diseñada.

## 1. Inventario actual

**Navegación del panel** (`src/admin/components/AdminLayout.tsx`): Inicio, Hero, Productos, Ventas, Sobre Nosotros. Ya usa lenguaje simple en las etiquetas de navegación; no hay tecnicismos ahí.

**Inicio** (`AdminHomePage.tsx`): página estática de bienvenida, sin datos ni accesos directos a tareas. No es un panel de control real.

**Productos** (`AdminProductsPage.tsx`): una sola pantalla con listado + formulario de alta/edición lado a lado. Campos actuales: nombre, descripción (opcional), categoría (texto libre, obligatorio), precio, una única imagen, orden de aparición (número), destacado (checkbox). Los productos nuevos siempre se crean inactivos; se activan después desde el listado con un botón "Activar". Edición usa concurrencia optimista (`expectedUpdatedAt`) ya funcional.

**Hero y Sobre Nosotros** (`AdminHeroPage.tsx`, `AdminAboutPage.tsx`): formularios de una sola imagen + campos de texto. Recién corregidos en CMS-UI-01: ya muestran un esqueleto mientras cargan, "Imagen no configurada" si no hay imagen persistida, y la imagen real una vez cargada — sin flash de ninguna foto vieja. Este es el mejor patrón de UX ya construido en el panel y debe reutilizarse como base para ADMIN-02B/C.

**Ventas** (`AdminOrdersPage.tsx` + `OrdersTable.tsx`): tabla de pedidos, fuera del alcance de ADMIN-02, no auditada en profundidad acá.

**Servicios administrativos** (`src/services/adminApi.ts`): todo pasa por `/api/admin/*` con el token del usuario, nunca escritura directa. Mensajes ya traducidos por código de estado HTTP: 401 "Tu sesion expiro...", 403 "No tenes permisos...", 404 "No se encontro el registro.", **409 "Este contenido fue modificado en otra sesion. Recarga los datos antes de guardar."** (ya coincide casi textualmente con lo pedido para "Conflict"), 422 "Revisa los datos del formulario." (genérico, sin decir qué campo).

**Validadores** (`server/admin/validators.ts`): cada campo tiene un límite explícito (nombre 160, descripción 4000, categoría 80, precio hasta 100.000.000, orden hasta 100.000, URL de imagen 2000). La categoría es **texto libre obligatorio**, con una lista bloqueada de palabras reservadas (`test`, `prueba`) que solo se aplica a productos activos. No existe una tabla de categorías ni una lista fija.

**Handlers** (`server/admin/handlers/products.ts`, `settings.ts`, `media.ts`): patrón consistente — auth → validar → llamar RPC → mapear error → responder. Sin lógica de negocio filtrada hacia el cliente.

**RPCs existentes:** `admin_create_product_with_media`, `admin_update_product_with_media`, `admin_set_product_active`, `admin_upsert_settings_document_with_media`, `admin_create_pending_media_asset`, `admin_finalize_media_asset`. Ninguna RPC de galería (múltiples imágenes) existe todavía.

**Tabla `products`:** `id`, `name`, `description`, `category` (texto libre), `price`, `image_url`, `image_asset_id`, `is_active`, `is_featured`, `display_order`, `created_at`, `updated_at`, `stock_on_hand`. No tiene columna de slug/dirección del producto. No tiene un estado "borrador" distinto de `is_active`.

**Tabla `product_images`** (hallazgo importante): **ya existe** desde la migración original de comercio (`202609110103_orders_commerce_foundation.sql`), con exactamente las columnas necesarias para una galería: `product_id`, `url`, `display_order`, `is_primary`, con restricciones únicas que garantizan una sola imagen principal y un orden único por producto, RLS ya configurado para lectura pública de productos activos. En ADMIN-01B se revocó correctamente el permiso de escritura directa (`authenticated`) sobre esta tabla, pero **nunca se creó una RPC de reemplazo**: hoy esta tabla no tiene ningún camino de escritura, ni desde el panel ni desde ningún handler. Es una base de datos ya lista, sin conexión al backend administrativo ni al frontend.

**Tabla `media_assets`:** ya modela un ciclo de vida genérico (`authorized` → `pending` → `attached` → `orphan_candidate`) pensado para adjuntarse a "cualquier contenido", no solo al Hero/About/producto único actuales. Reutilizable tal cual para una galería, sin cambios de diseño.

**Tabla `settings`:** almacén clave/valor en JSONB, usado hoy solo por `hero_content` y `about_content`. No existe un registro equivalente para categorías.

**Categorías actuales:** no existen como entidad. Es un campo de texto libre en `products.category`, validado solo por longitud y por la lista bloqueada de palabras reservadas.

**Estados de carga/vacío/error/éxito/conflicto:**
- Hero/About: los cuatro estados de imagen (cargando/vacío/lista/error) ya están resueltos desde CMS-UI-01.
- Productos: sin esqueleto de carga del listado (aparece vacío hasta que resuelve, sin indicador); sin vista previa; sin indicador de cambios sin guardar; conflicto de edición (409) ya tiene un mensaje humano, pero no hay una acción directa ("Recargar") en la interfaz, solo el texto.
- Validación (422): mensaje único genérico, no dice qué campo falló.

**Responsive y accesibilidad:** el layout usa grillas de Tailwind con puntos de quiebre (`sm:`, `lg:`, `xl:`) y ya es usable en pantallas chicas por estructura, pero no fue probado deliberadamente con una persona no técnica ni en dispositivos reales como parte de este trabajo. `FormField` ya asocia label+ayuda con el campo (accesible por defecto); no se auditaron lectores de pantalla en profundidad.

No se asume ninguna funcionalidad que no esté confirmada en el código: todo lo anterior fue verificado leyendo los archivos fuente reales, no descripciones previas.

## 2. Problemas encontrados

1. **Una sola imagen por producto.** No hay galería, ni imagen principal distinguible de secundarias, ni orden visual, ni texto alternativo. `ImageField` está diseñado para un único valor.
2. **Categoría sin lista fija.** El cliente debe escribir el nombre exacto de la categoría cada vez, sin autocompletar ni selector, con riesgo de errores de tipeo que dividen el catálogo en categorías duplicadas invisibles (ej. "Ortopedia" vs "ortopedia ").
3. **No existe una vista previa** del producto, del Hero ni del About antes de guardar.
4. **No existe una dirección de producto (slug).** No está en el modelo de datos ni en la interfaz. Si en el futuro se necesitan URLs de producto amigables, hoy no hay base para eso.
5. **"Borrador" no existe como estado propio.** Solo hay `is_active` (visible/oculto). Un producto a medio cargar y uno completo pero pausado se ven exactamente igual para el sistema.
6. **Errores de validación no dicen qué campo falló.** El mensaje "Revisa los datos del formulario." obliga a adivinar.
7. **Sin indicador de cambios sin guardar.** `handleCancel` descarta silenciosamente lo escrito sin avisar.
8. **Sin confirmación para acciones importantes.** Activar/desactivar un producto ocurre con un solo clic, sin un paso de confirmación.
9. **Vocabulario técnico visible:** "CTA principal" y "Link del CTA principal" en el formulario de Hero (ver Sección 5).
10. **Orden de aparición como número libre**, en vez de una interacción más natural (arrastrar para reordenar).
11. **Sin esqueleto de carga en el listado de productos**, a diferencia de Hero/About ya corregidos.
12. **La tabla de galería (`product_images`) existe pero no tiene ningún camino de escritura**, lo que es una oportunidad (ver Sección 6) más que un problema a resolver desde cero.

## 3. Diseño funcional propuesto

### 3.1 Navegación final de ADMIN-02
Se mantiene la navegación actual (Inicio, Hero, Productos, Ventas, Sobre Nosotros). No se agregan secciones nuevas: "Categorías" se resuelve como un selector dentro del formulario de producto (Sección 3.3), no como una pantalla aparte, para no multiplicar la navegación que el cliente debe aprender.

### 3.2 Pantalla de lista de productos
- **Búsqueda:** un campo de texto simple que filtra por nombre a medida que se escribe.
- **Filtros:** por categoría (selector) y por estado (Todos / Visibles / Ocultos / Borradores).
- **Estado visible:** una etiqueta clara junto a cada producto ("Visible en la tienda", "Oculto", "Borrador"), nunca solo un punto de color sin texto.
- **Acciones principales:** Editar, Mostrar/Ocultar, Duplicar (para catálogos con variantes similares — opcional, ver Sección 10).
- **Estado vacío:** si no hay productos todavía, un mensaje de bienvenida con un botón directo a "Crear el primer producto", no una lista en blanco.
- **Estado de error:** mensaje humano con un botón "Reintentar", igual que ya existe en `FeaturedProductsSection`/`StorePage` del sitio público.
- **Estado de carga:** esqueleto de tarjetas, mismo patrón visual ya construido para las imágenes en CMS-UI-01.

### 3.3 Formulario de producto, dividido en secciones
1. **Información básica:** nombre, descripción, categoría (selector con opción de crear una nueva si no existe).
2. **Precio y categoría:** precio, y aquí mismo la categoría si se decide agrupar visualmente (a definir en el diseño visual final, no afecta el modelo de datos).
3. **Imágenes:** galería (ver ADMIN-02C), con la imagen principal marcada visualmente.
4. **Visibilidad:** Borrador / Visible en la tienda / Oculto, y el interruptor de "Destacado".
5. **Vista previa:** cómo se va a ver la tarjeta del producto en la tienda, actualizada en vivo mientras se completa el formulario.

### 3.4 Campos visibles para el cliente
Nombre, descripción, categoría, precio, imágenes (con marca de "principal" y orden), destacado (sí/no), estado (borrador/visible/oculto).

### 3.5 Campos técnicos que deben generarse y permanecer ocultos
`id` del producto, `image_asset_id`, `expectedUpdatedAt`, cualquier identificador de Cloudinary o Supabase, cualquier valor de `display_order` interno de galería que no sea la posición visual arrastrable, y la futura dirección/slug del producto (se genera sola a partir del nombre, nunca se edita a mano salvo que el dueño pida explícitamente esa capacidad en el futuro).

### 3.6 Mensajes de ayuda y ejemplos
Cada campo mantiene el patrón ya usado por `FormField` (ayuda debajo del campo). Ejemplos concretos a agregar: en categoría, mostrar las categorías ya usadas como sugerencia; en precio, aclarar que se muestra tal cual al comprador; en imágenes, aclarar el tamaño y formato aceptado (ya existe ese texto en `ImageField`, se mantiene).

### 3.7 Confirmaciones para acciones importantes
Ocultar un producto visible, publicar un borrador, y reemplazar una imagen ya usada deben pedir una confirmación explícita de un paso ("¿Ocultar este producto de la tienda?" con Confirmar/Cancelar), no ejecutarse con un solo clic como hoy.

### 3.8 Indicador de cambios sin guardar
El formulario debe mostrar un aviso visible ("Tenés cambios sin guardar") apenas se modifica cualquier campo, y debe preguntar antes de descartarlos al cancelar o salir.

### 3.9 Comportamiento de Guardar, Cancelar y salir con cambios pendientes
- **Guardar:** deshabilitado mientras hay errores de validación visibles; mientras guarda, el botón indica "Guardando..." (ya existe este patrón en `FormActions`).
- **Cancelar:** si hay cambios sin guardar, pide confirmación antes de descartar (hoy no lo hace).
- **Salir con cambios pendientes:** si el cliente intenta navegar a otra sección del panel con cambios sin guardar, se le avisa antes de perderlos.

### 3.10 Experiencia responsive
Escritorio: listado y formulario lado a lado (como hoy). Tablet: listado arriba, formulario abajo, o navegación por pestañas. Celular: una sola columna, con el formulario ocupando toda la pantalla al editar, y un botón claro para volver al listado sin perder lo escrito.

## 4. Mapa de pantallas

```
Panel
├── Inicio                          (sin cambios en ADMIN-02)
├── Hero                            (sin cambios funcionales; ya corregido en CMS-UI-01)
├── Productos
│   ├── Lista de productos          (ADMIN-02B)
│   │   ├── Barra de búsqueda y filtros
│   │   ├── Estado vacío / error / carga
│   │   └── Tarjeta de producto → Editar
│   └── Formulario de producto      (ADMIN-02B + ADMIN-02C)
│       ├── Información básica
│       ├── Precio y categoría
│       ├── Imágenes (galería)      (ADMIN-02C)
│       ├── Visibilidad
│       └── Vista previa
├── Ventas                          (sin cambios, fuera de alcance)
└── Sobre Nosotros                  (sin cambios funcionales; ya corregido en CMS-UI-01)
```

No se agrega ninguna pantalla nueva al menú principal.

## 5. Diccionario de lenguaje simple

Tecnicismos detectados hoy en el panel y su reemplazo:

| Término técnico visible hoy | Dónde aparece | Reemplazo propuesto |
|---|---|---|
| "CTA principal" / "Texto del CTA principal" | `AdminHeroPage.tsx` | "Texto del botón principal" |
| "Link del CTA principal" | `AdminHeroPage.tsx` | "Enlace del botón principal" |
| "Revisa los datos del formulario." (genérico) | `adminApi.ts`, error 422 | Mensaje específico por campo (ver Sección 6) |

Reemplazos ya definidos para ADMIN-02 (a aplicar quede o no un término visible hoy):

| Término técnico | Reemplazo |
|---|---|
| CTA | Texto del botón |
| URL | Enlace |
| Slug | Dirección del producto (generada automáticamente) |
| Asset | Imagen |
| Active | Visible en la tienda |
| Inactive | Oculto |
| Draft | Borrador |
| Upload | Subir imagen |
| Conflict | "Este producto fue modificado en otra ventana. Actualizá la página antes de continuar." |

El resto del panel actual (Inicio, Productos, Ventas, Sobre Nosotros, "Nombre", "Descripcion", "Precio", "Categoria", "Imagen no configurada.", "Imagen no disponible.", "Producto activado/desactivado correctamente.") ya usa lenguaje simple y se mantiene igual.

## 6. Cambios técnicos necesarios

| Necesidad | Ya soporta la base | Requiere migración | Requiere RPC nueva | Requiere endpoint | Requiere componente frontend | Reutilizable tal cual |
|---|---|---|---|---|---|---|
| Categoría seleccionable (no texto libre) | No | Sí (si se decide una tabla `categories`; ver Sección 10) o No (si se decide derivar la lista de categorías ya usadas en `products.category`, sin tabla nueva) | Sí, si hay tabla nueva | Sí, si hay tabla nueva | Sí (selector con opción de crear) | Los límites de longitud/caracteres de `validators.ts` |
| Galería de varias imágenes | Parcial — tabla `product_images` ya existe con el esquema correcto | No, para la tabla base (ya existe) | Sí — no existe ninguna RPC de galería hoy | Sí — nuevas rutas bajo `/api/admin/products/images/*` o similar | Sí — un `ImageGalleryField` nuevo, distinto del `ImageField` actual de una sola imagen | El pipeline firmado de Cloudinary completo (`media_assets`, `admin_create_pending_media_asset`, `admin_finalize_media_asset`) |
| Imagen principal de la galería | Sí — columna `is_primary` con restricción de unicidad ya existe | No | Sí | Sí | Sí (marcar como principal en la UI) | La restricción de base de datos ya impide tener dos principales a la vez |
| Orden de imágenes | Sí — columna `display_order` con restricción de unicidad ya existe | No | Sí | Sí | Sí (arrastrar para reordenar) | La restricción de base de datos ya impide dos imágenes con el mismo orden |
| Estado "Borrador" distinto de oculto | No — solo existe `is_active` | Posiblemente, si el dueño decide que borrador y oculto deben ser estados distintos (ver Sección 10) | Sí, si se agrega el estado | Sí, si se agrega el estado | Sí (selector de tres estados en vez de un interruptor) | — |
| Dirección del producto (slug) | No — no existe la columna | Sí | Sí (generarla en el servidor, nunca confiar en el valor del cliente, mismo criterio que ya se aplica a `image_url`/`image_asset_id`) | Sí | No necesariamente visible (se muestra solo como referencia de lectura, no como campo editable en la v1) | El patrón de "el servidor decide, el cliente no propone" ya usado en `media.ts` para folder/publicId |
| Vista previa en vivo | No existe | No | No | No | Sí — un componente de vista previa que reutilice `ProductCard`/`HeroSection` con los datos del formulario en memoria, sin guardar nada | Los componentes públicos ya existentes (`ProductCard`, `HeroSection`) |
| Mensajes de validación por campo | Parcial — el servidor ya distingue el error exacto (`invalid_name`, `invalid_price`, etc. en `validators.ts`) | No | No | No — falta mapear el código de error existente a un mensaje por campo en el cliente | Sí — mostrar el error debajo del campo correspondiente | Los códigos de error que el backend ya devuelve, hoy solo se descartan en el cliente |
| Confirmaciones e indicador de cambios sin guardar | No | No | No | No | Sí — componente de confirmación reutilizable + hook de "formulario sucio" | `FormActions` como base |

### Riesgos de seguridad y concurrencia
- Cualquier RPC nueva de galería debe seguir exactamente el mismo patrón ya validado en ADMIN-01B/01C: `SECURITY DEFINER`, `search_path=''`, validación de rol admin fresca, `request_id` para auditoría, y bloqueo optimista igual al que ya usa `admin_update_product` (`expected_updated_at`), para no reabrir una condición de carrera entre dos administradores editando la misma galería a la vez.
- Si se agrega una tabla `categories`, debe definirse qué pasa con productos que ya tienen una categoría en texto libre que no coincida con ninguna categoría nueva (migración de datos, no solo de esquema).
- El endpoint de reordenar imágenes debe validar que todas las imágenes reordenadas pertenezcan al mismo producto y a un administrador autenticado, para evitar que un ID de imagen ajeno se cuele en la lista.
- No debe implementarse ninguna eliminación física automática de imágenes de Cloudinary sin una estrategia de recuperación (esto ya está excluido explícitamente del alcance, ver Sección 8).

No se escribió SQL ni código en este documento, tal como se pidió.

## 7. Riesgos

- **Alcance:** la tentación de resolver "categorías" con una tabla nueva completa (con jerarquías, íconos, etc.) en vez de la versión mínima necesaria para que el cliente no escriba texto libre. Se recomienda la versión mínima primero.
- **Concurrencia en galería:** reordenar y reemplazar imágenes al mismo tiempo desde dos pestañas puede generar conflictos si no se reutiliza el mismo patrón de `expected_updated_at` ya probado en productos.
- **Costo de Cloudinary:** una galería de varias imágenes por producto multiplica el uso de almacenamiento/transformaciones frente al esquema actual de una imagen; no es un riesgo de seguridad pero sí de costo operativo a vigilar cuando se cargue el catálogo real (Fase 3 del roadmap).
- **Sobrecarga de la primera versión:** agregar vista previa, galería, categorías seleccionables y confirmaciones todo junto en un solo bloque sería difícil de revisar. Por eso se recomienda la división en ADMIN-02B/C/D (Sección 8).

## 8. División recomendada

- **ADMIN-02B — Productos, categorías y publicación:** formulario dividido en secciones, categoría seleccionable, estados de visibilidad (borrador/visible/oculto), vista previa, validaciones por campo, manejo de conflicto con acción directa.
- **ADMIN-02C — Galería e imágenes:** conecta la tabla `product_images` ya existente con nuevas RPCs, imagen principal, orden por arrastre, reemplazo seguro, reutilizando el pipeline firmado de Cloudinary de ADMIN-01C.
- **ADMIN-02D — Usabilidad, responsive y validación:** prueba real con una persona no técnica, revisión de accesibilidad, indicador de cambios sin guardar, confirmaciones, guía visual preliminar del panel completo.

## 9. Criterios de aceptación verificables por subbloque

**ADMIN-02B:**
- Un producto puede crearse y editarse sin que ningún mensaje de error mencione un término técnico.
- La categoría se elige de una lista o se crea escribiendo, nunca queda en blanco por error de tipeo.
- Un producto puede guardarse como borrador y publicarse después, sin perder los datos cargados.
- Un error de validación señala exactamente qué campo corregir.
- Un conflicto de edición (409) ofrece una acción directa para recargar, no solo un mensaje.

**ADMIN-02C:**
- Un producto puede tener más de una imagen.
- Exactamente una imagen puede marcarse como principal en todo momento (la base de datos ya lo garantiza; la interfaz debe reflejarlo).
- El orden de las imágenes puede cambiarse arrastrando, sin escribir números.
- Reemplazar una imagen no dejar productos con imágenes rotas ni interrumpe la publicación existente.
- Ninguna imagen se borra físicamente de Cloudinary sin pasar por el criterio de recuperación definido.

**ADMIN-02D:**
- Una persona sin conocimientos técnicos completa las 12 tareas del cliente listadas en el encargo original sin pedir ayuda.
- El panel se usa correctamente en computadora, tablet y celular.
- Cancelar con cambios sin guardar pide confirmación.
- Ningún mensaje de error técnico (código HTTP, nombre de tabla, stack trace) llega a la pantalla del cliente.

## 10. Preguntas que requieren decisión del dueño

1. **¿"Borrador" debe ser un estado distinto de "Oculto", o alcanza con reutilizar el `is_active` actual como único interruptor de visibilidad?** Esto define si hace falta una migración de base de datos o no.
2. **¿Las categorías deben ser una lista fija que solo el dueño del negocio puede ampliar, o cualquier administrador puede crear una categoría nueva al cargar un producto?** Define si hace falta una pantalla de administración de categorías además del selector en el formulario de producto.
3. **¿Cuántas imágenes como máximo debe permitirse por producto?** Afecta el diseño de la interfaz de galería y el costo estimado de Cloudinary.
4. **¿Se necesita la función "Duplicar producto" mencionada como opcional en la Sección 3.2, o queda fuera de ADMIN-02?**
5. **¿La dirección del producto (slug) debe mostrarse al cliente como referencia de solo lectura desde la v1, o puede posponerse hasta que exista una necesidad real de compartir enlaces de producto?**
6. **¿Qué pasa con las imágenes reemplazadas ("orphan_candidate" en `media_assets`)? ¿Se borran manualmente de forma periódica, se dejan indefinidamente, o se define un proceso de limpieza en una fase posterior?** Esto no se resuelve en ADMIN-02C por decisión explícita del alcance, pero la decisión de "qué hacer eventualmente" es del dueño del negocio, no una decisión técnica unilateral.
