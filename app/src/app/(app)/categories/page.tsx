import { CategoriesView } from "@/components/categories-view";
import { getCurrentReviewer } from "@/lib/auth/current-user";
import { mockCategories } from "@/lib/mock/categories";

export const metadata = {
  title: "Categories · Course Agent",
};

export default async function CategoriesPage() {
  const profile = await getCurrentReviewer();
  const canEdit = profile?.role === "admin";
  return <CategoriesView seedCategories={mockCategories} canEdit={canEdit} />;
}
