# Medios de pago — procedencia de cada archivo

Todos los archivos de esta carpeta se descargaron de un dominio propiedad de la
marca correspondiente y se sirven de forma local. Ningún logo fue redibujado,
vectorizado desde una captura ni tomado de un agregador, un blog o un banco de
iconos. La aplicación no solicita ninguno de estos recursos a un dominio externo
en tiempo de ejecución.

Fecha de descarga: 2026-09-20.

| Archivo | Marca | Origen oficial | Formato |
| --- | --- | --- | --- |
| `mercadopago.svg` | Mercado Pago | Pack «Logos Mercado Pago 2025», enlazado desde la página oficial de marca <https://www.mercadopago.com.ar/mp/logo-oficial> y servido por el CDN de Mercado Libre: `https://http2.mlstatic.com/storage/pog-cm-admin/calm-assets/Logos Mercado Pago 2025--fb6f16c9.zip` → `Uso digital - RGB/SVGs/MP_RGB_HANDSHAKE_color_horizontal.svg` | SVG |
| `american-express.svg` | American Express | CDN estático oficial de American Express: `https://www.aexp-static.com/cdaas/one/statics/axp-static-assets/1.8.0/package/dist/img/logos/dls-logo-bluebox-solid.svg` | SVG |
| `visa.png` | Visa | CDN oficial de Visa: `https://cdn.visa.com/v2/assets/images/logos/visa/blue/logo.png` (208 × 68 px, RGBA) | PNG |
| `naranja-x.png` | Naranja X | Asset del sitio oficial <https://www.naranjax.com/>, servido por su CDN de contenidos: `https://images.ctfassets.net/yxlyq25bynna/5aunl52F9uDLxXLUC8L7O4/b025683cc1824c386a19c478a5dd46ae/isologo-naranjax.png` (155 × 36 px, RGBA) | PNG |

## Faltante: Mastercard

**No hay archivo de Mastercard y no debe agregarse uno dibujado a mano.**

Todos los endpoints oficiales de Mastercard responden `Access Denied` (Akamai)
desde este entorno, tanto por HTTP directo como desde un navegador real:

- `https://brand.mastercard.com/` → 403
- `https://brand.mastercard.com/brandcenter.html` → 403
- `https://www.mastercard.com/global/en.html` → 403
- `https://www.mastercard.com.ar/es-ar.html` → 403
- `https://www.mastercard.com/content/dam/.../mc-logo-52.svg` → 403

Para completar la franja hace falta descargar desde el Brand Center de
Mastercard (requiere aceptar sus condiciones de uso) el símbolo horizontal a
color y guardarlo como:

```
src/assets/payments/mastercard.svg
```

Una vez presente el archivo, basta con descomentar su entrada en
`paymentMethods` dentro de `src/components/PaymentMethods.tsx`; el componente ya
contempla su altura óptica y no requiere ningún otro cambio.

## Notas de formato

`visa.png` y `naranja-x.png` son PNG porque ninguna de las dos marcas publica un
SVG accesible fuera de su brand center. Ambos son los archivos que la propia
marca sirve en su sitio. Si más adelante se consiguen los SVG oficiales, se
reemplazan los archivos conservando el nombre y sólo hay que cambiar la
extensión en el import.
