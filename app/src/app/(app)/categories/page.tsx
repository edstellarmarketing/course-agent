import { CategoriesView } from "@/components/categories-view";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { createSessionClient } from "@/lib/supabase/server-with-session";
import type { Category } from "@/lib/types";

export const metadata = {
  title: "Categories · Course Agent",
};

// While reviewer pinning/editing is the active surface, opt out of
// any cached page render so changes show up on the very next nav.
// Phase 5+ can re-enable ISR once write traffic settles.
export const dynamic = "force-dynamic";

interface CategoryRow {
  id: string;
  name: string;
  course_count: number | null;
  target_count: number | null;
  demand_score: number | null;
  is_pinned: boolean | null;
  notes: string | null;
}

export default async function CategoriesPage() {
  const [profile, supabase] = await Promise.all([
    getCurrentReviewer(),
    createSessionClient(),
  ]);
  const canEdit = profile?.role === "admin";

  const { data, error } = await supabase
    .from("categories_with_counts")
    .select("id,name,course_count,target_count,demand_score,is_pinned,notes")
    .order("name");

  if (error) {
    // Surface the underlying error to the dev console; the page still
    // renders empty so we don't break the layout.
    console.error("[categories] query failed:", error);
  }

  const rows = (data ?? []) as CategoryRow[];
  const categories: Category[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    courseCount: c.course_count ?? 0,
    targetCount: c.target_count,
    demandScore: c.demand_score,
    isPinned: c.is_pinned ?? false,
    notes: c.notes,
  }));

  return <CategoriesView seedCategories={categories} canEdit={canEdit} />;
}
