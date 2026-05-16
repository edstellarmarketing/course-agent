export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-mid px-6 py-24 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-[480px] w-[480px] rounded-full bg-orange/15 blur-3xl"
      />

      <main className="relative z-10 mx-auto w-full max-w-3xl">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange/40 bg-orange/15 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-light">
          <span className="h-1.5 w-1.5 rounded-full bg-orange" />
          Phase 0 · Project Init
        </span>

        <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Edstellar <em className="not-italic text-orange-light">Course Discovery</em> Agent
        </h1>

        <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/75">
          The reviewer dashboard. From here we&apos;ll build the seven screens
          from the mockup, wire up Supabase, and let the Python agent feed
          nightly suggestions into the queue.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <div className="font-display text-xs font-semibold uppercase tracking-widest text-orange-light">
              Next step
            </div>
            <div className="mt-2 text-base text-white/90">
              Phase 1 — render all 7 routes with mock data conforming to the
              eventual Supabase schema.
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
            <div className="font-display text-xs font-semibold uppercase tracking-widest text-orange-light">
              Stack
            </div>
            <div className="mt-2 font-mono text-sm text-white/80">
              Next.js 16 · React 19 · Tailwind v4 · shadcn/ui
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
