import type { Element, RootContent } from "hast";
import { createMemo, For, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { HighlightedCode } from "./HighlightedCode";
import { parseMarkdown, sourceLink } from "./markdown";
export function GitlabMarkdown(props: { content: string; webUrl: string }) {
  const tree = createMemo(() => parseMarkdown(props.content));
  function children(nodes: RootContent[]): JSX.Element {
    return (
      <For each={nodes}>
        {(node) => {
          if (node.type === "text") return node.value;
          if (node.type !== "element") return null;
          return <MarkdownElement node={node} webUrl={props.webUrl} />;
        }}
      </For>
    );
  }
  function MarkdownElement(local: {
    node: Element;
    webUrl: string;
  }): JSX.Element {
    const node = local.node;
    if (node.tagName === "a")
      return (
        <a
          href={sourceLink(String(node.properties.href || ""), local.webUrl)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children(node.children)}
        </a>
      );
    if (node.tagName === "img")
      return (
        <a
          href={sourceLink(
            String(node.properties.src || ""),
            local.webUrl.replace("/-/blob/", "/-/raw/"),
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          {String(node.properties.alt || "Открыть изображение")}
        </a>
      );
    if (node.tagName === "code") {
      const language = String(node.properties.className || "").match(
        /language-([\w+-]+)/,
      )?.[1];
      const content = node.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("");
      return language ? (
        <HighlightedCode content={content} language={language} />
      ) : (
        <code>{content}</code>
      );
    }
    const attributes = Object.fromEntries(
      Object.entries(node.properties).map(([key, value]) => [
        key === "className" ? "class" : key === "htmlFor" ? "for" : key,
        Array.isArray(value) ? value.join(" ") : value,
      ]),
    );
    return (
      <Dynamic
        component={node.tagName as keyof JSX.IntrinsicElements}
        {...attributes}
      >
        {children(node.children)}
      </Dynamic>
    );
  }
  return <div class="gitlab-markdown">{children(tree().children)}</div>;
}
