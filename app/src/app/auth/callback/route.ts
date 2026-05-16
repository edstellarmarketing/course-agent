import { NextResponse, type NextRequest } from "next/server";

import { createSessionClient } from "@/lib/supabase/server-with-session";

/**
 * OAuth + magic-link callback. Supabase Auth sends the user here with
 * a `?code=...` query string after they finish the Google flow or
 * click the magic-link email. We swap the code for a session cookie
 * via `exchangeCodeForSession`, then redirect to `/dashboard` (or to
 * a caller-supplied `next` path when present).
 *
 * If the exchange fails (link expired, code reused, etc.) we land the
 * user back on `/login` with `?error=...` so the form can show it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const reason = encodeURIComponent(error.message);
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
