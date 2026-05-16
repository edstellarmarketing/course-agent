import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { mockCategories } from "@/lib/mock/categories";
import { mockCourseCount, mockCourses } from "@/lib/mock/courses";

export const metadata = {
  title: "Course Inventory · Course Agent",
};

interface InventoryPageProps {
  searchParams: Promise<{ q?: string; category?: string }>;
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const { q = "", category = "all" } = await searchParams;
  const normalisedQ = q.trim().toLowerCase();

  const filtered = mockCourses.filter((c) => {
    if (category !== "all" && c.category !== category) return false;
    if (!normalisedQ) return true;
    return (
      c.name.toLowerCase().includes(normalisedQ) ||
      (c.subcategory ?? "").toLowerCase().includes(normalisedQ) ||
      c.category.toLowerCase().includes(normalisedQ)
    );
  });

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Course Inventory"
        description={`${mockCourseCount.toLocaleString()} courses live in the catalogue. ${mockCourses.length} loaded in this Phase 1 mock slice.`}
      />

      <div className="flex-1 space-y-4 px-8 py-8">
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4">
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
              {mockCategories.map((c) => (
                <option key={c.id} value={c.name}>
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
          {(q || category !== "all") && (
            <Link
              href="/inventory"
              className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="rounded-lg border border-gray-100 bg-white">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="text-sm text-gray-500">
              <span className="font-display text-base font-semibold text-navy-deep">
                {filtered.length}
              </span>{" "}
              of {mockCourses.length} courses{q && ` matching “${q}”`}
              {category !== "all" && ` in ${category}`}
            </div>
            <div className="font-display text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              read-only · admin edit comes in Phase 4
            </div>
          </header>

          {filtered.length === 0 ? (
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
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-gray-100 hover:bg-off-white"
                  >
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">{c.num}</td>
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
                    <td className="px-6 py-3 text-gray-500">{c.subcategory ?? "—"}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {new Date(c.updatedAt).toLocaleDateString([], {
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
        </div>
      </div>
    </>
  );
}
