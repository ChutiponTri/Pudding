import { redirect } from "next/navigation";

/** Query params the student portal reads; anything else is dropped. */
const KEPT_PARAMS = ["code", "classId", "assignmentId", "view"] as const;

/**
 * Students inside LINE who hit an unknown /liff/... path go back to the student
 * portal (not the teacher site). Invite/deep-link params survive so a mistyped
 * link like /liff/join?code=ABC still opens the class. `liff.state` is dropped
 * on purpose: keeping it would make the LIFF SDK navigate back to the bad path.
 */
export default async function LiffFallback({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first) kept.set(key, first);
  }
  const query = kept.toString();
  redirect(query ? `/liff?${query}` : "/liff");
}
