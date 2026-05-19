"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";
import type { ReviewerProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavLink = {
  href: string;
  label: string;
  /** Optional sub-section descriptor shown in hover. */
  description?: string;
  /** Gated to admin only — Phase 3 will enforce this server-side. */
  adminOnly?: boolean;
};

type NavSection = {
  heading: string;
  links: NavLink[];
};

const sections: NavSection[] = [
  {
    heading: "Review",
    links: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/suggestions/today", label: "Today's Suggestions" },
      { href: "/history", label: "History" },
    ],
  },
  {
    heading: "Catalogue",
    links: [
      { href: "/inventory", label: "Course Inventory" },
      { href: "/categories", label: "Categories" },
      { href: "/categories/least-supplied", label: "Least Supplied" },
    ],
  },
  {
    heading: "Admin",
    links: [
      { href: "/users", label: "Users", adminOnly: true },
      { href: "/learning", label: "Learning", adminOnly: true },
      { href: "/email-settings", label: "Email Settings", adminOnly: true },
      { href: "/settings", label: "Settings", adminOnly: true },
    ],
  },
];

export function AppNav({ profile }: { profile: ReviewerProfile }) {
  const pathname = usePathname();
  const isAdmin = profile.role === "admin";

  return (
    // Fixed to the viewport so the sidebar stays put even on very
    // long /history or /inventory pages. `inset-y-0 left-0 w-64`
    // pins it to the full-height left strip; the (app) layout adds
    // `ml-64` to <main> so content starts beyond the sidebar.
    <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-gray-100 bg-white">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-navy text-white font-display font-bold text-sm">
          ED
        </div>
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold text-navy-deep">
            Course Agent
          </div>
          <div className="text-[11px] uppercase tracking-widest text-gray-400">
            Edstellar
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {sections.map((section) => (
          <div key={section.heading} className="mb-5">
            <div className="mb-1 px-3 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              {section.heading}
            </div>
            <ul className="space-y-0.5">
              {section.links.map((link) => {
                const active =
                  pathname === link.href ||
                  (link.href !== "/dashboard" && pathname.startsWith(link.href));
                const restricted = link.adminOnly && !isAdmin;
                return (
                  <li key={link.href}>
                    <Link
                      href={restricted ? "#" : link.href}
                      aria-disabled={restricted}
                      tabIndex={restricted ? -1 : undefined}
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-navy-soft font-medium text-navy-deep"
                          : "text-gray-600 hover:bg-gray-50 hover:text-navy-deep",
                        restricted && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span>{link.label}</span>
                      {link.adminOnly && (
                        <span className="rounded-full bg-orange-pale px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-wider text-orange">
                          Admin
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <ProfileMenu profile={profile} />
    </aside>
  );
}

/**
 * Click the profile row to open a small popover with a Sign out
 * action. Closes on outside-click or Escape. Uses the browser
 * Supabase client to clear the session cookie, then does a hard
 * navigation to /login so the next request's server components see
 * the cleared cookie (router.push alone wouldn't refetch
 * `getCurrentReviewer()`).
 */
function ProfileMenu({ profile }: { profile: ReviewerProfile }) {
  const [open, setOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSignOut() {
    setError(null);
    startSignOut(async () => {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signOut();
      if (err) {
        setError(err.message);
        return;
      }
      // Hard navigation — guarantees the server picks up the cleared
      // cookie on the next request (router.push would replay with
      // stale auth and bounce around the redirect chain).
      window.location.href = "/login";
    });
  }

  const initials = profile.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      ref={wrapperRef}
      className="relative border-t border-gray-100 px-4 py-4"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-gray-50"
      >
        <div className="grid h-9 w-9 place-items-center rounded-full bg-navy-soft font-display text-sm font-semibold text-navy-deep">
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-gray-800">
            {profile.name}
          </div>
          <div className="truncate text-xs capitalize text-gray-500">
            {profile.role}
          </div>
        </div>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={cn(
            "h-3 w-3 text-gray-400 transition-transform",
            open && "rotate-180",
          )}
        >
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%-0.5rem)] left-4 right-4 z-30 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 px-3 py-2 text-[11px] text-gray-500">
            Signed in as{" "}
            <span className="font-medium text-gray-700">{profile.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-red-700 transition-colors hover:bg-red-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            <span aria-hidden className="text-[11px] text-red-400">
              ⎋
            </span>
          </button>
          {error && (
            <div className="border-t border-red-200 bg-red-soft px-3 py-2 text-[11px] text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
