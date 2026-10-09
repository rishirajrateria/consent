import type { ReactNode } from "react";

/** Minimal markdown renderer for CMS pages (headings, bold, paragraphs, lists). */
export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/);
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("### "))
          return <h3 key={i} className="text-lg font-semibold tracking-tight">{inline(trimmed.slice(4))}</h3>;
        if (trimmed.startsWith("## "))
          return <h2 key={i} className="text-xl font-semibold tracking-tight">{inline(trimmed.slice(3))}</h2>;
        if (trimmed.startsWith("# "))
          return <h1 key={i} className="text-2xl font-semibold tracking-tight">{inline(trimmed.slice(2))}</h1>;
        if (/^[-*] /m.test(trimmed)) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
              {trimmed.split("\n").map((line, j) => (
                <li key={j}>{inline(line.replace(/^[-*] /, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="text-sm leading-relaxed text-ink-soft">{inline(trimmed)}</p>;
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}
