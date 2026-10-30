import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedCode } from "./HighlightedCode";

function sourceLink(value: string | undefined, base: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function GitlabMarkdown({ content, webUrl }: { content: string; webUrl: string }) {
  return <div className="gitlab-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={sourceLink(href, webUrl)} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => <a href={sourceLink(typeof src === "string" ? src : undefined, webUrl.replace("/-/blob/", "/-/raw/"))}
      target="_blank" rel="noopener noreferrer">{alt || "Open image"}</a>,
    code: ({ className, children }) => {
      const language = className?.match(/language-([\w+-]+)/)?.[1];
      return language ? <HighlightedCode content={String(children)} language={language} /> : <code>{children}</code>;
    },
  }}>{content}</Markdown></div>;
}
