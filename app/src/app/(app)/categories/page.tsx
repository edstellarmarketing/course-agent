import { CategoriesView } from "@/components/categories-view";
import { mockCategories } from "@/lib/mock/categories";
import { mockCurrentReviewer } from "@/lib/mock/reviewers";

export const metadata = {
  title: "Categories · Course Agent",
};

export default function CategoriesPage() {
  // Phase 3 replaces this with a Supabase role lookup against the active session.
  const canEdit = mockCurrentReviewer.role === "admin";
  return <CategoriesView seedCategories={mockCategories} canEdit={canEdit} />;
}
