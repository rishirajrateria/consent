import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import type { Metadata } from "next";

const ALLOWED = ["faq", "terms", "privacy", "contact"];

export async function generateMetadata({ params }: PageProps<"/[page]">): Promise<Metadata> {
  const { page } = await params;
  const cms = await db.cmsPage.findUnique({ where: { slug: page } });
  return { title: cms?.title ?? "Page" };
}

export default async function CmsPublicPage({ params }: PageProps<"/[page]">) {
  const { page } = await params;
  if (!ALLOWED.includes(page)) notFound();
  const cms = await db.cmsPage.findUnique({ where: { slug: page } });
  if (!cms) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader kicker="consent." title={cms.title} />
      <Card className="p-7">
        <Markdown source={cms.body} />
      </Card>
    </div>
  );
}
