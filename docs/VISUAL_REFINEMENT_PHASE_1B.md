# Refinamiento visual Home — Fase 1B

## Alcance

Esta fase refina la Home existente sin reemplazar el sistema visual de la Fase 1. Mantiene los datos, imágenes y flujos comerciales actuales; no incorpora contenido comercial no confirmado.

## Dirección visual aplicada

- La paleta se organiza mediante tokens semánticos basados en Charcoal, Stone, Off White y Soft Gray. El naranja queda reservado para el logotipo original y para su presencia natural en las fotografías.
- El hero conserva la composición dividida y reduce el peso de los recursos decorativos: CTA Charcoal, fondo Off White y etiqueta integrada en la nueva paleta.
- La sección “Acerca de Rehabex” desarrolla el propósito de la tienda sin sumar antecedentes, cifras ni credenciales no verificadas. Incluye una grilla editorial estática con recursos ya presentes en el proyecto, sin carrusel ni desplazamiento interno.
- Las entradas de contenido y microinteracciones usan CSS e `IntersectionObserver`; con `prefers-reduced-motion` el contenido permanece visible y el movimiento se desactiva.
- El footer utiliza fondo Charcoal. Los medios de pago, Instagram y WhatsApp no se publican hasta contar con marcas y enlaces comerciales confirmados.

## Producción fotográfica pendiente

La fotografía actual del hero permite una composición segura, pero no tiene el formato ni la producción ideales para una pieza principal definitiva. Se recomienda reemplazarla, cuando exista material aprobado por el cliente, por una toma:

- horizontal y de alta resolución, con margen suficiente para recortes 6:5 y 16:9;
- con fondo controlado, iluminación profesional y contraste moderado;
- centrada en un equipo real de rehabilitación, sin utilería innecesaria;
- sin textos, sellos ni marcas incrustadas que compitan con la interfaz;
- con una zona visualmente tranquila que permita superponer una etiqueta breve;
- coherente en temperatura de color con el resto del catálogo.

Para el catálogo se recomienda una producción consistente por producto: mismo fondo, distancia, altura de cámara, iluminación y encuadre 4:5. Hasta contar con esa producción, la interfaz conserva las imágenes reales disponibles y aplica proporciones y recortes uniformes sin deformarlas.

## Contenido pendiente de confirmación

- Páginas legales y sus enlaces (términos, privacidad y cambios/devoluciones, si correspondieran).
- Datos de contacto, redes, cobertura, plazos y condiciones comerciales. No se muestran hasta contar con información confirmada.
- Backend de newsletter. El formulario permanece deshabilitado y explica su estado.
- Texto institucional definitivo para “Acerca de Rehabex”. La versión actual es deliberadamente general y debe ser validada por el cliente.
- Marcas de tarjetas o métodos específicos aceptados por Mercado Pago. Hasta su confirmación, solo se comunica el procesador de pagos.
- Logo Charcoal aislado en SVG o PNG transparente. El repositorio contiene únicamente `src/assets/logo.png`, correspondiente al logo naranja anterior.
- URL comercial real de Instagram y número internacional comercial de WhatsApp. El número `5491100000000` retirado del código era un placeholder y no debe publicarse.

## Evidencia local

Las capturas y los reportes automatizados de la corrección se generan en `.temp/visual-audit/phase-1b-correction/`. La carpeta está ignorada por Git y no forma parte de los commits.
