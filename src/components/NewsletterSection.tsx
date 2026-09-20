import { Mail } from 'lucide-react';

export function NewsletterSection() {
  return (
    <section className="bg-surface pb-[var(--space-section)]">
      <div className="site-container">
        <div className="grid gap-8 overflow-hidden rounded-card bg-dark px-6 py-10 text-white sm:px-10 sm:py-12 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:px-14">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-control bg-white/10 text-brand">
              <Mail className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-6 text-balance text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-4xl">Novedades Rehabex, sin ruido.</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/65 sm:text-base">Estamos preparando un canal para compartir nuevos productos y contenido útil.</p>
          </div>

          <form className="lg:justify-self-end" aria-label="Suscripción a novedades" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="newsletter-email" className="text-sm font-semibold text-white">Correo electrónico</label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row lg:min-w-[27rem]">
              <input id="newsletter-email" type="email" disabled placeholder="tu@email.com" className="min-h-12 flex-1 rounded-control border border-white/20 bg-white/10 px-4 text-sm text-white placeholder:text-white/40 disabled:cursor-not-allowed" />
              <button type="submit" disabled className="min-h-12 rounded-control bg-white/15 px-5 text-sm font-bold text-white/65 disabled:cursor-not-allowed">Próximamente</button>
            </div>
            <p className="mt-3 text-xs leading-5 text-white/45">La suscripción todavía no está habilitada.</p>
          </form>
        </div>
      </div>
    </section>
  );
}
