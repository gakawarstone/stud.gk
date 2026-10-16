import { useEffect, useState } from "react";

export function HighlightedCode({ content, language }: { content: string; language: string }) {
  const [html, setHtml] = useState<{ content: string; language: string; value: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("./code-highlight").then(({ highlightCode }) => {
      const value = highlightCode(content, language);
      if (!cancelled) setHtml(value === null ? null : { content, language, value });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [content, language]);
  // highlight.js escapes source text before adding its own token spans.
  return html?.content === content && html.language === language
    ? <code className="gitlab-code hljs" dangerouslySetInnerHTML={{ __html: html.value }} />
    : <code className="gitlab-code">{content}</code>;
}
