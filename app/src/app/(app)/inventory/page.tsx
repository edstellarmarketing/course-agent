import Link from "next/link";

import { InventoryUploadButton } from "@/components/inventory-upload-modal";
import { PageHeader } from "@/components/page-header";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createSessionClient } from "@/lib/supabase/server-with-session";

export const metadata = {
  title: "Course Inventory · Course Agent",
};

const PAGE_SIZE = 50;

interface InventoryPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    page?: string;
  }>;
}

type CourseRow = {
  id: string;
  num: number | null;
  name: string;
  category: string;
  subcategory: string | null;
  link: string | null;
  updated_at: string;
};

type CategoryRow = { name: string };

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const category = params.category ?? "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [profile, supabase] = await Promise.all([
    getCurrentReviewer(),
    createSessionClient(),
  ]);
  const isAdmin = profile?.role === "admin";

  // Categories for the dropdown — small list (43 rows), pulled once.
  const categoriesQuery = supabase
    .from("categories")
    .select("name")
    .order("name");

  // Paginated rows. PostgREST returns an exact total count when we ask
  // for `count: "exact"`; that drives the result footer + page-count.
  let rowsQuery = supabase
    .from("courses")
    .select("id,num,name,category,subcategory,link,updated_at", {
      count: "exact",
    })
    .order("num", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (category !== "all") {
    rowsQuery = rowsQuery.eq("category", category);
  }
  if (q) {
    // ilike-OR across name + subcategory + category. The pattern needs
    // to be PostgREST-safe (no commas inside) — escape any commas.
    const safe = q.replace(/,/g, " ");
    rowsQuery = rowsQuery.or(
      `name.ilike.%${safe}%,subcategory.ilike.%${safe}%,category.ilike.%${safe}%`,
    );
  }

  const [categoriesRes, rowsRes] = await Promise.all([
    categoriesQuery,
    rowsQuery,
  ]);

  const categories = (categoriesRes.data ?? []) as CategoryRow[];
  const rows = (rowsRes.data ?? []) as CourseRow[];
  const total = rowsRes.count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(q) || category !== "all";

  // Build pagination URLs that preserve current filters.
  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category !== "all") sp.set("category", category);
    sp.set("page", String(n));
    return `/inventory?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Course Inventory"
        description={`${total.toLocaleString()} ${
          hasFilters ? "matching " : ""
        }courses in the catalogue.`}
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        {isAdmin && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-4 py-3">
            <div className="text-sm text-gray-600">
              <span className="font-display text-[11px] font-semibold uppercase tracking-widest text-orange">
                Admin
              </span>{" "}
              · keep the agent&apos;s view of the catalogue current after partnership imports or website edits.
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/internal/sample-courses-csv"
                className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Download sample CSV
              </a>
              <InventoryUploadButton />
            </div>
          </div>
        )}

        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4"
        >
          <div className="flex-1 min-w-[240px]">
            <label
              htmlFor="q"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Search
            </label>
            <input
              id="q"
              name="q"
              type="text"
              defaultValue={q}
              placeholder="Course name, category, or subcategory"
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            />
          </div>

          <div className="min-w-[200px]">
            <label
              htmlFor="category"
              className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
            >
              Category
            </label>
            <select
              id="category"
              name="category"
              defaultValue={category}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
          >
            Filter
          </button>
          {hasFilters && (
            <Link
              href="/inventory"
              className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="rounded-lg border border-gray-100 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-6 py-4">
            <div className="text-sm text-gray-500">
              <span className="font-display text-base font-semibold text-navy-deep">
                {total.toLocaleString()}
              </span>{" "}
              courses{q && ` matching “${q}”`}
              {category !== "all" && ` in ${category}`}
            </div>
            <div className="font-mono text-xs text-gray-500">
              Page {page} of {totalPages}
            </div>
          </header>

          {rows.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-gray-500">
              No courses match. Try a broader search or clear the filter.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
                  <th className="px-6 py-3 font-display font-semibold">#</th>
                  <th className="px-6 py-3 font-display font-semibold">Name</th>
                  <th className="px-6 py-3 font-display font-semibold">Category</th>
                  <th className="px-6 py-3 font-display font-semibold">Subcategory</th>
                  <th className="px-6 py-3 font-display font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-gray-100 hover:bg-off-white"
                  >
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {c.num ?? "—"}
                    </td>
                    <td className="px-6 py-3">
                      {c.link ? (
                        <a
                          href={c.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-navy-deep hover:text-navy"
                        >
                          {c.name}
                        </a>
                      ) : (
                        <span className="font-medium text-navy-deep">{c.name}</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-700">{c.category}</td>
                    <td className="px-6 py-3 text-gray-500">
                      {c.subcategory ?? "—"}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {new Date(c.updated_at).toLocaleDateString([], {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {totalPages > 1 && (
            <footer className="flex items-center justify-between border-t border-gray-100 px-6 py-3 text-sm">
              <div className="text-gray-500">
                Showing rows {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="rounded-md border border-gray-100 px-3 py-1.5 text-sm font-medium text-gray-300">
                    ← Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="rounded-md border border-gray-100 px-3 py-1.5 text-sm font-medium text-gray-300">
                    Next →
                  </span>
                )}
              </div>
            </footer>
          )}
        </div>
      </div>
    </>
  );
}
