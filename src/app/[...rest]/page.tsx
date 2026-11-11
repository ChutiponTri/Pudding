import { redirect } from "next/navigation";

/**
 * Any URL no route matches lands here and gets a real server-side redirect to
 * "/" (the dashboard for signed-in teachers, the landing page otherwise).
 * Kept apart from not-found.tsx on purpose: not-found is part of every page's
 * tree, so making it per-request (connection()) turned every page into a
 * server render on each visit. Student URLs under /liff are caught earlier by
 * app/liff/[...rest]/page.tsx.
 */
export default function UnknownRoute() {
  redirect("/");
}
