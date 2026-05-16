import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in · Edstellar Course Agent",
};

export default function LoginPage() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-mid p-14 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-32 h-[520px] w-[520px] rounded-full bg-orange/20 blur-3xl"
        />
        <div className="relative z-10 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-white/10 backdrop-blur-sm font-display text-sm font-bold">
            ED
          </div>
          <span className="font-display text-sm tracking-wide text-white/85">
            Edstellar
          </span>
        </div>

        <div className="relative z-10 mt-auto max-w-md">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange/40 bg-orange/15 px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-light">
            <span className="h-1.5 w-1.5 rounded-full bg-orange" />
            Course Discovery Agent
          </span>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.1] tracking-tight">
            Every morning, a queue of <em className="not-italic text-orange-light">enterprise-grade</em> training candidates.
          </h1>
          <p className="mt-4 text-base text-white/75">
            The agent scans the global training market overnight, scores
            candidates against ten rules, and surfaces the ones worth your time.
            You decide what lives in the catalogue.
          </p>
        </div>

        <div className="relative z-10 mt-auto pt-12 text-xs text-white/55">
          © {new Date().getFullYear()} Edstellar · Internal tool
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <Suspense fallback={<div className="h-[420px] w-full max-w-sm" />}>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  );
}
