# Medios de pago — procedencia de cada archivo

Todos los archivos de esta carpeta se descargaron de un dominio propiedad de la
marca correspondiente y se sirven de forma local. Ningún logo fue redibujado,
vectorizado desde una captura ni tomado de un agregador, un blog o un banco de
iconos. La aplicación no solicita ninguno de estos recursos a un dominio externo
en tiempo de ejecución.

Fecha de descarga de los assets existentes: 2026-09-20. Mastercard, Cabal y
Maestro se incorporaron el 2026-10-18.

| Archivo | Marca | Origen oficial | Formato |
| --- | --- | --- | --- |
| `mercadopago.svg` | Mercado Pago | Pack «Logos Mercado Pago 2025», enlazado desde la página oficial de marca <https://www.mercadopago.com.ar/mp/logo-oficial> y servido por el CDN de Mercado Libre: `https://http2.mlstatic.com/storage/pog-cm-admin/calm-assets/Logos Mercado Pago 2025--fb6f16c9.zip` → `Uso digital - RGB/SVGs/MP_RGB_HANDSHAKE_color_horizontal.svg` | SVG |
| `american-express.svg` | American Express | CDN estático oficial de American Express: `https://www.aexp-static.com/cdaas/one/statics/axp-static-assets/1.8.0/package/dist/img/logos/dls-logo-bluebox-solid.svg` | SVG |
| `visa.png` | Visa | CDN oficial de Visa: `https://cdn.visa.com/v2/assets/images/logos/visa/blue/logo.png` (208 × 68 px, RGBA) | PNG |
| `mastercard.png` | Mastercard | Sprite argentino 2× del [repositorio público oficial `mercadolibre/payment-methods-component`](https://github.com/mercadolibre/payment-methods-component/tree/b39185a1af716590bbbee55886d486f0c306eb10), fijado al commit `b39185a1af716590bbbee55886d486f0c306eb10`: `src/images/ar/payment-methods-large@2x.png`. Se extrajo sin redibujar ni recolorear el rectángulo 92 × 72 px que la hoja oficial `payment-methods.ar__large.css` asigna a `.paymentmethod-master`. | PNG |
| `naranja-x.png` | Naranja X | Asset del sitio oficial <https://www.naranjax.com/>, servido por su CDN de contenidos: `https://images.ctfassets.net/yxlyq25bynna/5aunl52F9uDLxXLUC8L7O4/b025683cc1824c386a19c478a5dd46ae/isologo-naranjax.png` (155 × 36 px, RGBA) | PNG |
| `cabal.png` | Cabal | Sprite argentino 2× del repositorio público oficial `mercadolibre/payment-methods-component`, fijado al commit `b39185a1af716590bbbee55886d486f0c306eb10`: `src/images/ar/payment-methods-large@2x.png`. Se extrajo sin redibujar ni recolorear el rectángulo 160 × 56 px que la hoja oficial `dist/payment-methods.ar__large.css` asigna a `.paymentmethod-cabal.paymentmethod-large`. | PNG |
| `maestro.png` | Maestro | Mismo sprite argentino 2× oficial y commit fijado. Se extrajo sin redibujar ni recolorear el rectángulo 88 × 76 px que `dist/payment-methods.ar__large.css` asigna a `.paymentmethod-maestro.paymentmethod-large`. | PNG |

La disponibilidad de Cabal y Maestro para Argentina se verificó el 2026-10-18
en la [documentación oficial de medios de pago de Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/sales-processing/payment-methods):
Cabal figura para crédito y débito, y Maestro para débito. La integración de
Checkout Pro de Rehabex no excluye individualmente ninguno de estos medios.

## Notas de formato

`visa.png` y `naranja-x.png` son PNG porque los SVG oficiales no están disponibles
sin pasar por sus formularios o brand centers. Ambos PNG son los archivos que la
propia marca sirve desde sus dominios. No se vectorizan ni se convierten para no
crear derivados no oficiales.
