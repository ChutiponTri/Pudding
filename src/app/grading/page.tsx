import { redirect } from 'next/navigation';

/**
 * The old grading hub. Its job (pick work, then grade it) is now the work
 * list at /works, which grades from each row, so this only forwards old links
 * and bookmarks: ?assignmentId= to that assignment's grading page, anything
 * else to /works.
 */
export default async function GradingHubRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : '');
  const assignmentId = one('assignmentId');
  if (assignmentId) redirect(`/assignments/${encodeURIComponent(assignmentId)}/grading?from=works`);
  const term = one('term');
  redirect(term ? `/works?term=${encodeURIComponent(term)}` : '/works');
}
