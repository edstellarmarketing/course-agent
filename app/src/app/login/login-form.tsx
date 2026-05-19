"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Client-side login UI: magic-link form + password fallback.
 *
 * The magic-link flow redirects to `/auth/callback` (a Route Handler)
 * which exchanges the code for a session and lands the user on
 * `/dashboard`. The password flow signs in directly via
 * signInWithPassword. The actual `@edstellar.com` domain check is
 * server-side — the Supabase Auth Hook rejects non-Workspace emails
 * before a session is issued.
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
        Get a one-time sign-in link by email, or use your password if an admin
        has set one for you.
      </p>

      <form
        onSubmit={mode === "password" ? handlePassword : handleMagicLink}
        className="mt-8 space-y-3"
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
