import { redirect } from "next/navigation";

/**
 * No 404 page: a `notFound()` call (e.g. a non-admin opening /admin) sends the
 * visitor to the home route instead. Unknown URLs are redirected earlier by
 * app/[...rest]/page.tsx.
 *
 * Do not add connection() / headers() / cookies() here: this component is in
 * every page's tree, so a dynamic API here makes every page server-rendered on
 * each visit (billed Vercel CPU) instead of prerendered.
 */
export default function NotFound() {
  redirect("/");
}
