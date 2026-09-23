import type { ReactNode } from "react";

/**
 * Renders the small Markdown subset the policy documents use (headings,
 * numbered/bulleted lists, **bold**, *italic*, paragraphs) as real HTML.
 * The old version dumped raw Markdown inside a <pre>, so buyers read
 * literal "# Terms of Sale" and "**All sales final**" on the legal pages.
 *
 * Builds React elements only (no dangerouslySetInnerHTML), so policy text
 * can never inject markup.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${keyPrefix}-b${i++}`}>{m[1]}</strong>);
    else out.push(<em key={`${keyPrefix}-i${i++}`}>{m[2]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "p"; text: string };

function parse(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk.split("\n");
    const first = lines[0]?.trim() ?? "";
    const heading = /^(#{1,3})\s+(.*)$/.exec(first);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      const rest = lines.slice(1).join(" ").trim();
      if (rest) blocks.push({ kind: "p", text: rest });
      continue;
    }
    const isOl = /^\d+\.\s/.test(first);
    const isUl = /^[-*]\s/.test(first) && !/^\*[^*\s]/.test(first);
    if (isOl || isUl) {
      const items: string[] = [];
      for (const raw of lines) {
        const line = raw.trim();
        const start = isOl ? /^\d+\.\s+(.*)$/.exec(line) : /^[-*]\s+(.*)$/.exec(line);
        if (start) items.push(start[1]!);
        else if (items.length) items[items.length - 1] += ` ${line}`;
      }
      blocks.push(isOl ? { kind: "ol", items } : { kind: "ul", items });
      continue;
    }
    const text = lines.map((l) => l.trim()).join(" ").trim();
    if (text) blocks.push({ kind: "p", text });
  }
  return blocks;
}

export function PolicyPage({ title, body }: { title: string; body: string }) {
  const blocks = parse(body);
  const hasH1 = blocks.some((b) => b.kind === "h" && b.level === 1);
  return (
    <main className="container" style={{ maxWidth: "760px" }}>
      <article className="card" style={{ lineHeight: 1.65 }}>
        {!hasH1 && <h1>{title}</h1>}
        {blocks.map((b, i) => {
          const k = `blk${i}`;
          if (b.kind === "h") {
            const Tag = (`h${b.level}` as "h1" | "h2" | "h3");
            return <Tag key={k}>{inline(b.text, k)}</Tag>;
          }
          if (b.kind === "ol" || b.kind === "ul") {
            const List = b.kind;
            return (
              <List key={k} style={{ paddingLeft: "1.25rem" }}>
                {b.items.map((it, j) => (
                  <li key={`${k}-${j}`} style={{ marginBottom: "0.6rem" }}>
                    {inline(it, `${k}-${j}`)}
                  </li>
                ))}
              </List>
            );
          }
          return <p key={k}>{inline(b.text, k)}</p>;
        })}
      </article>
    </main>
  );
}
