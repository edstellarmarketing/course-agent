import Link from "next/link";

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
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold text-navy-deep">
            Sign in to your reviewer account
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Use your Edstellar Google Workspace account, or get a one-time link
            by email.
          </p>

          <Link
            href="/dashboard"
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-navy-deep transition-colors hover:border-navy hover:bg-navy-soft"
          >
            <GoogleMark />
            Continue with Google
          </Link>

          <div className="mt-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-widest text-gray-400">
            <span className="h-px flex-1 bg-gray-100" /> or <span className="h-px flex-1 bg-gray-100" />
          </div>

          <form action="/dashboard" className="mt-6 space-y-3">
            <div>
              <label
                htmlFor="email"
                className="block font-display text-[11px] font-semibold uppercase tracking-widest text-gray-500"
              >
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@edstellar.com"
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
            >
              Send magic link
            </button>
          </form>

          <p className="mt-6 text-[11px] leading-relaxed text-gray-400">
            Phase 1 build — auth is not wired yet. Submitting either option
            takes you straight to the dashboard so the screens are clickable.
          </p>
        </div>
      </section>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.63z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
