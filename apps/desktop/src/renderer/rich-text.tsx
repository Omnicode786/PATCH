import { Fragment, type ReactNode } from "react";

function inlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g).filter(Boolean);
  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("`") && token.endsWith("`")) return <code key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith("*") && token.endsWith("*")) return <em key={index}>{token.slice(1, -1)}</em>;
    return <Fragment key={index}>{token}</Fragment>;
  });
}

export function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }

    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test((lines[index] ?? "").trim())) code.push(lines[index++] ?? "");
      if (index < lines.length) index += 1;
      blocks.push(<pre key={key++}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const value = heading[2] ?? "";
      blocks.push(level === 1 ? <h2 key={key++}>{inlineMarkdown(value)}</h2> : level === 2 ? <h3 key={key++}>{inlineMarkdown(value)}</h3> : <h4 key={key++}>{inlineMarkdown(value)}</h4>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) items.push((lines[index++] ?? "").replace(/^[-*]\s+/, ""));
      blocks.push(<ul key={key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index] ?? "")) items.push((lines[index++] ?? "").replace(/^\d+[.)]\s+/, ""));
      blocks.push(<ol key={key++}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) quote.push((lines[index++] ?? "").replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key++}>{inlineMarkdown(quote.join(" "))}</blockquote>);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!next.trim() || /^```|^#{1,3}\s+|^[-*]\s+|^\d+[.)]\s+|^>\s?/.test(next)) break;
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push(<p key={key++}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }

  return <div className="rich-text">{blocks}</div>;
}
