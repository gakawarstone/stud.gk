import { createEffect, createSignal, on, onCleanup } from "solid-js";
export function HighlightedCode(props: { content: string; language: string }) {
  const [html, setHtml] = createSignal<{
    content: string;
    language: string;
    value: string;
  } | null>(null);
  createEffect(
    on(
      () => [props.content, props.language],
      () => {
        let cancelled = false;
        void import("./code-highlight")
          .then(({ highlightCode }) => {
            const value = highlightCode(props.content, props.language);
            if (!cancelled)
              setHtml(value === null ? null : { content: props.content, language: props.language, value });
          })
          .catch(() => {});
        onCleanup(() => {
          cancelled = true;
        });
      },
    ),
  );
  // highlight.js escapes source text before adding its own token spans.
  return (
    <>
      {html()?.content === props.content && html()!.language === props.language ? (
        <code class="gitlab-code hljs" innerHTML={html()!.value} />
      ) : (
        <code class="gitlab-code">{props.content}</code>
      )}
    </>
  );
}
