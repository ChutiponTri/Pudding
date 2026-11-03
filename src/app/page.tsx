import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import DashboardPage from "./dashboard/page";
import { TeacherLoggedOutView } from "@/components/TeacherLoggedOutView";
import { appUrl } from "@/lib/server/adminNotify";

const SITE_URL = appUrl() || "https://www.pudding-p.com";

// Only the landing page declares itself canonical (inner pages would otherwise inherit "/").
export const metadata: Metadata = { alternates: { canonical: "/" } };

/** Tells Google which logo and name belong to the site (schema.org Organization). */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Pudding",
      url: `${SITE_URL}/`,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png`, width: 580, height: 580 },
      image: `${SITE_URL}/image.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Pudding",
      url: `${SITE_URL}/`,
      inLanguage: "th-TH",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    return <DashboardPage />;
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c") }}
      />
      <TeacherLoggedOutView />
    </>
  );
}
