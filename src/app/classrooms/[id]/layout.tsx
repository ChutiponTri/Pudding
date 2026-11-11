/**
 * The page under this segment is a client component that loads its data in
 * the browser, so the server HTML is the same shell for every id. An empty
 * generateStaticParams lets Next render that shell once per id and serve it
 * from cache afterwards, instead of a server render (billed CPU) per visit.
 * Don't read cookies/headers or user data on the server under this segment.
 */
export async function generateStaticParams() {
  return [];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
