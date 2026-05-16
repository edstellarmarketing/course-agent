import { redirect } from "next/navigation";

export default function RootIndex() {
  // Phase 3 will check the Supabase session and route to /login when absent.
  redirect("/dashboard");
}
