"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { mockCurrentReviewer } from "@/lib/mock/reviewers";
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
      { href: "/learning", label: "Learning", adminOnly: true },
      { href: "/settings", label: "Settings", adminOnly: true },
    ],
  },
];

export function AppNav() {
  const pathname = usePathname();
  const isAdmin = mockCurrentReviewer.role === "admin";

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-gray-100 bg-white">
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

      <div className="border-t border-gray-100 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-navy-soft font-display text-sm font-semibold text-navy-deep">
            {mockCurrentReviewer.name
              .split(" ")
              .map((p) => p[0])
              .join("")}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium text-gray-800">
              {mockCurrentReviewer.name}
            </div>
            <div className="truncate text-xs capitalize text-gray-500">
              {mockCurrentReviewer.role}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
