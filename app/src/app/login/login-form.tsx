"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side login UI: Google OAuth button + magic-link form.
 *
 * Both flows redirect to `/auth/callback` (a Route Handler) which
 * exchanges the code for a session and lands the user on `/dashboard`.
 * The actual `@edstellar.com` domain check is server-side — Supabase
 * Auth Hook (configured in Studio in Step 7) rejects non-Workspace
 * emails before a session is issued.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const inboundError = searchParams.get("error");

  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(
    inboundError ? humanizeError(inboundError) : null,
  );

  async function handleGoogle() {
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setSubmitting(false);
    }
    // On success, the browser navigates to Google — no further state needed.
  }

  async function handleMagicLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    if (otpError) {
      setError(otpError.message);
    } else {
      setMagicLinkSent(true);
    }
    setSubmitting(false);
  }

  async function handlePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();
    const { error: pwError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (pwError) {
      setError(pwError.message);
      setSubmitting(false);
      return;
    }
    // Full reload so the proxy + Server Components see the new session
    // cookie. router.push wouldn't refresh server-rendered nav state.
    window.location.href = "/dashboard";
  }

  if (magicLinkSent) {
    return (
      <div className="w-full max-w-sm">
        <h2 className="font-display text-2xl font-semibold text-navy-deep">
          Check your inbox
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          We sent a one-time sign-in link to{" "}
          <span className="font-mono text-gray-800">{email}</span>. Open it on
          this device — the link signs you in and takes you to the dashboard.
        </p>
        <button
          type="button"
          onClick={() => {
            setMagicLinkSent(false);
            setEmail("");
          }}
          className="mt-6 text-sm font-medium text-navy hover:text-navy-deep"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h2 className="font-display text-2xl font-semibold text-navy-deep">
        Sign in to your reviewer account
      </h2>
      <p className="mt-2 text-sm text-gray-500">
        Use your Edstellar Google Workspace account, or get a one-time link by
        email.
      </p>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={submitting}
        className="mt-8 flex w-full items-center justify-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-navy-deep transition-colors hover:border-navy hover:bg-navy-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleMark />
        Continue with Google
      </button>

      <div className="mt-6 flex items-center gap-3 text-[11px] font-medium uppercase tracking-widest text-gray-400">
        <span className="h-px flex-1 bg-gray-100" /> or{" "}
        <span className="h-px flex-1 bg-gray-100" />
      </div>

      <form
        onSubmit={mode === "password" ? handlePassword : handleMagicLink}
        className="mt-6 space-y-3"
      >
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@edstellar.com"
            className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
        </div>

        {mode === "password" && (
          <div>
            <label
              htmlFor="password"
              className="block font-display text-[11px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={
            submitting || !email || (mode === "password" && !password)
          }
          className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting
            ? mode === "password"
              ? "Signing in…"
              : "Sending…"
            : mode === "password"
              ? "Sign in"
              : "Send magic link"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "password" ? "magic" : "password");
            setError(null);
            setPassword("");
          }}
          className="block w-full text-center text-xs font-medium text-navy hover:text-navy-deep"
        >
          {mode === "password"
            ? "Use a magic link instead"
            : "I have a password"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function humanizeError(code: string): string {
  if (code === "missing_code") {
    return "Sign-in link is missing a code — try requesting a new magic link.";
  }
  return decodeURIComponent(code);
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
