export function Footer() {
  return (
    <footer id="contacto" className="border-t border-slate-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-md">
          <p className="text-lg font-semibold tracking-[0.16em] text-slate-900">REHABEX</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Soluciones para rehabilitacion, fisioterapia y recuperacion funcional con asesoramiento claro y cercano.
          </p>
        </div>

        <div className="text-sm text-slate-600">
          <p>contacto@rehabex.com</p>
          <p className="mt-1">+54 11 5555 5555</p>
          <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">© 2026 REHABEX</p>
        </div>
      </div>
    </footer>
  );
}
