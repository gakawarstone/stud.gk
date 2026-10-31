import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import type { Root } from "hast";

// Raw HTML never enters the HAST. Sanitize the generated tree as well, including
// attributes, protocols, task-list inputs and footnote IDs.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize);
export function parseMarkdown(content: string): Root {
  return parser.runSync(parser.parse(content)) as Root;
}
export function sourceLink(value: string | undefined, base: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
