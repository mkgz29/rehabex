import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { DiagonalShapeDefs } from '../media/DiagonalShapeDefs';
// Resolved by Vite at build time (hashed, cached); also works when the module is loaded by Node tests.
const loginAthlete = new URL('../../assets/auth/rehabex-login-athlete.png', import.meta.url).href;

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** Stacked on mobile (media, then form); two balanced columns from md up. */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <main className="min-h-[100svh] bg-canvas text-ink md:grid md:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <DiagonalShapeDefs />
      <div
        className="auth-media relative isolate h-[19rem] overflow-hidden bg-dark text-white md:h-auto md:max-h-none md:min-h-[100svh]"
      >
        {/* Decorative photograph: the logo and the copy are separate HTML elements. */}
        <img
          src={loginAthlete}
          alt=""
          width="988"
          height="1592"
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-[50%_28%] md:object-[50%_36%]"
        />
        {/* Soft scrims only where the white logo and copy sit, so the photo stays vivid elsewhere. */}
        <div className="absolute inset-0 bg-gradient-to-b from-dark/55 via-transparent to-dark/80" aria-hidden="true" />

        <div className="relative flex h-full flex-col justify-between p-6 sm:p-8 md:p-9 lg:p-12">
          <Link to="/" aria-label="Rehabex, ir al inicio" className="inline-flex w-fit rounded-sm">
            <img src="/brand/rehabex-logo-light.svg" alt="Rehabex" width="874" height="240" className="h-8 w-auto sm:h-9 md:h-10" />
          </Link>

          <div className="max-w-[16rem] md:max-w-sm">
            <span className="mb-3 block h-0.5 w-8 rounded-full bg-brand" aria-hidden="true" />
            <p className="text-base font-semibold leading-snug tracking-tight text-white sm:text-lg md:text-2xl">
              Equipamiento para rendimiento y recuperación.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-center px-6 pb-10 pt-8 sm:px-10 md:items-center md:px-10 md:py-12 lg:px-16">
        <div className="hero-enter w-full max-w-sm sm:max-w-md">
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}
