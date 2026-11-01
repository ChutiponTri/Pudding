import { redirect } from "next/navigation";
import { connection } from "next/server";

/**
 * No 404 page: a mistyped or stale URL (and any `notFound()` call, e.g. a
 * non-admin opening /admin) sends the visitor to the home route instead.
 * "/" shows the dashboard to signed-in teachers and the landing page otherwise;
 * the proxy still routes unapproved teachers to /pending-approval from there.
 * Student URLs under /liff are caught earlier by app/liff/[...rest]/page.tsx.
 */
export default async function NotFound() {
  // Render per request (not prerendered) so this is a real server-side redirect.
  await connection();
  redirect("/");
}
