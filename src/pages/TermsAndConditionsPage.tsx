import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Footer } from '../components/Footer';

const sections = [
  {
    title: '1. Información general',
    paragraphs: [
      'Estos términos y condiciones regulan las compras realizadas a través de la tienda online Rehabex (“la tienda”). Rehabex comercializa equipamiento y accesorios orientados al bienestar, el entrenamiento y la recuperación deportiva.',
    ],
  },
  {
    title: '2. Productos, características y disponibilidad',
    paragraphs: [
      'Las características, materiales, medidas, funciones, contenido de cada paquete y demás especificaciones se informan en la publicación correspondiente. Las imágenes son ilustrativas y pueden existir variaciones menores que no alteren sustancialmente las características anunciadas. La disponibilidad está sujeta al stock. Si surgiera un inconveniente que impida cumplir una compra confirmada, Rehabex se comunicará con el cliente y ofrecerá una solución conforme a la normativa aplicable.',
    ],
  },
  {
    title: '3. Finalidad y uso de los productos',
    paragraphs: [
      'Los productos se ofrecen para bienestar, entrenamiento y recuperación deportiva, de acuerdo con la descripción de cada artículo. No se anuncian de manera general como productos médicos ni se promete que diagnostiquen, prevengan, traten o curen enfermedades. La clasificación regulatoria de un producto depende de sus características y finalidad prevista, por lo que esta aclaración no reemplaza las obligaciones legales que pudieran corresponder a artículos específicos. El cliente debe leer y respetar las instrucciones del fabricante, las advertencias y las limitaciones de uso. La información comercial no sustituye la evaluación ni el asesoramiento individual de un profesional de la salud.',
    ],
  },
  {
    title: '4. Precios y medios de pago',
    paragraphs: [
      'Los precios se publican en la moneda indicada en la tienda. Antes de confirmar la compra se informarán el precio final, los descuentos vigentes, los costos de envío y las condiciones de financiación aplicables. La operación queda sujeta a la aprobación o acreditación del medio de pago elegido. Los errores o inconvenientes de una plataforma de pago se gestionarán de acuerdo con las circunstancias y la normativa vigente, sin excluir las obligaciones que correspondan a Rehabex como vendedor.',
    ],
  },
  {
    title: '5. Envíos y entrega',
    paragraphs: [
      'Los productos se enviarán a la dirección indicada por el cliente. Los plazos comunicados son estimativos y pueden depender del destino y del operador logístico. El cliente debe revisar que los datos de entrega sean correctos. Si el paquete llega visiblemente dañado, faltan artículos o el producto recibido no coincide con el pedido, se recomienda contactar a Rehabex cuanto antes y adjuntar el número de pedido y, si es posible, fotografías. Esta recomendación facilita la gestión, pero no limita los derechos legales del consumidor.',
    ],
  },
  {
    title: '6. Derecho de arrepentimiento en compras a distancia',
    paragraphs: [
      'En las compras realizadas a distancia, el consumidor podrá revocar la aceptación dentro del plazo legal aplicable —como regla general, diez (10) días corridos desde la entrega del bien o la celebración del contrato, lo que ocurra último— de acuerdo con el artículo 34 de la Ley 24.240 y la normativa vigente. Cuando corresponda legalmente, el ejercicio del derecho no tendrá costo para el consumidor. Se respetarán las excepciones, formalidades y obligaciones de información que establezca la normativa aplicable. Ninguna política comercial de Rehabex limita este derecho.',
    ],
  },
  {
    id: 'cambios-devoluciones-y-garantia',
    title: '7. Cambios voluntarios',
    paragraphs: [
      'Además de los derechos legales, Rehabex podrá ofrecer una política comercial de cambios voluntarios de hasta catorce (14) días corridos desde la recepción, siempre que las condiciones particulares se informen claramente antes de la compra. Salvo que la ley disponga otra cosa, para un cambio voluntario el producto deberá entregarse con sus accesorios y embalaje, sin daños atribuibles al cliente y en condiciones razonables de revisión. Estas condiciones no se aplican para restringir el derecho de arrepentimiento, la garantía legal ni otros derechos irrenunciables del consumidor.',
    ],
  },
  {
    title: '8. Comunicación inicial de fallas y garantía legal',
    paragraphs: [
      'Para facilitar una atención rápida, se solicita al cliente que, si advierte una posible falla, se comunique con Rehabex dentro de los primeros siete (7) días corridos desde la recepción, indicando el número de pedido y describiendo el inconveniente. Este plazo es únicamente una pauta de comunicación inicial: no reduce ni reemplaza los plazos de garantía ni los derechos reconocidos por la ley. Para bienes muebles no consumibles nuevos alcanzados por la garantía legal, la Ley 24.240 establece, como regla general, un plazo mínimo de seis (6) meses desde la entrega; se aplicará el régimen que corresponda según el producto y la normativa vigente. Si se detecta un posible defecto, Rehabex indicará cómo continuar y aplicará las soluciones y responsabilidades legalmente exigibles.',
    ],
  },
  {
    title: '9. Daños por uso indebido',
    paragraphs: [
      'La garantía por defectos de fabricación no cubre daños que se demuestre que fueron causados por golpes, caídas, manipulación incorrecta, modificaciones no autorizadas, uso fuera de las especificaciones o incumplimiento de las instrucciones. Cada reclamo se evaluará según sus circunstancias. No se rechazará automáticamente una solicitud por el solo hecho de que el producto haya sido utilizado; deberá distinguirse, cuando corresponda, entre un defecto de fabricación y un daño atribuible al uso.',
    ],
  },
  {
    title: '10. Solicitudes de cambio, devolución o garantía',
    paragraphs: [
      'El cliente deberá contactar a Rehabex mediante los canales oficiales indicados en la tienda, proporcionando el número de pedido y una descripción de la solicitud. Rehabex comunicará los pasos para coordinar la devolución, revisión, reparación, sustitución o reintegro que corresponda. No se exigirá al consumidor asumir costos cuando la normativa aplicable establezca que deben ser soportados por el vendedor.',
    ],
  },
  {
    title: '11. Datos personales',
    paragraphs: [
      'Los datos personales se utilizarán para procesar compras y pagos, coordinar entregas, brindar atención posventa y cumplir obligaciones legales. Cuando sea necesario, podrán compartirse con proveedores de pago, operadores logísticos y prestadores vinculados con la operación. El tratamiento se realizará conforme a la Ley 25.326 y demás normativa aplicable. El cliente podrá ejercer los derechos que le reconozca la legislación vigente a través de los canales de contacto de la tienda.',
    ],
  },
  {
    title: '12. Atención al cliente y reclamos',
    paragraphs: [
      'Para consultas, cambios, devoluciones, garantías o reclamos, el cliente podrá utilizar los canales oficiales publicados en la tienda. Se recomienda conservar el comprobante de compra y el número de pedido. Los reclamos se atenderán conforme a las circunstancias del caso y a la legislación aplicable. El consumidor podrá acudir a los organismos oficiales de defensa del consumidor cuando corresponda.',
    ],
  },
  {
    title: '13. Legislación aplicable y derechos del consumidor',
    paragraphs: [
      'Estos términos se interpretarán de acuerdo con la legislación argentina vigente, incluida la normativa de defensa del consumidor, comercio electrónico y protección de datos personales que resulte aplicable. Ninguna cláusula debe interpretarse como renuncia o limitación de derechos irrenunciables reconocidos por la ley.',
    ],
  },
  {
    title: '14. Actualizaciones',
    paragraphs: [
      'Rehabex podrá actualizar este documento para reflejar cambios operativos, comerciales o normativos. La versión publicada indicará su fecha de actualización. Las condiciones aplicables a cada operación se determinarán conforme a la normativa vigente y las circunstancias de la compra.',
    ],
  },
] as const;

export function TermsAndConditionsPage() {
  return (
    <div className="min-h-screen bg-primary text-white">
      <main className="px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <article className="mx-auto w-full max-w-3xl">
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/70 transition hover:text-accent-soft">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Volver al inicio
          </Link>

          <header className="mt-8 border-b border-white/15 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent-soft">Rehabex</p>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] text-white sm:text-5xl">Términos y condiciones de compra</h1>
            <p className="mt-5 text-sm text-white/55">Última actualización: 19 de octubre de 2026</p>
          </header>

          <div className="space-y-10 py-10 sm:space-y-12 sm:py-12">
            {sections.map((section) => (
              <section key={section.title} id={'id' in section ? section.id : undefined} className="scroll-mt-28">
                <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-[0.95rem] leading-7 text-white/72 sm:text-base sm:leading-8">{paragraph}</p>
                ))}
              </section>
            ))}

            <section aria-labelledby="seller-data-title" className="rounded-card border border-white/15 bg-white/[0.06] p-6 sm:p-8">
              <h2 id="seller-data-title" className="text-xl font-semibold tracking-tight text-white sm:text-2xl">15. Datos comerciales</h2>
              <dl className="mt-6 grid gap-4 text-sm leading-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <dt className="font-semibold text-white/85">Nombre comercial</dt><dd className="text-white/70">Rehabex</dd>
                <dt className="font-semibold text-white/85">Condición fiscal</dt><dd className="text-white/70">Monotributista</dd>
                <dt className="font-semibold text-white/85">Domicilio</dt><dd className="text-white/70">General Paz 1756</dd>
                <dt className="font-semibold text-white/85">Sitio web</dt><dd><a href="https://rehabex.com.ar/" className="text-accent-soft underline underline-offset-4">https://rehabex.com.ar/</a></dd>
                <dt className="font-semibold text-white/85">WhatsApp oficial</dt><dd><a href="https://wa.me/5491158624811" target="_blank" rel="noreferrer" className="text-accent-soft underline underline-offset-4">+54 9 11 5862-4811</a></dd>
              </dl>
            </section>
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
