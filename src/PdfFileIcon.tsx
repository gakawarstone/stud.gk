import { splitProps, type JSX } from "solid-js";
export function PdfFileIcon(
  props: JSX.SvgSVGAttributes<SVGSVGElement> & {
    size?: number;
    strokeWidth?: number;
    class?: string;
  },
) {
  const [local, rest] = splitProps(props, ["size", "strokeWidth", "class"]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={local.size ?? 20}
      height={local.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={local.strokeWidth ?? 1.6}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`pdf-file-icon ${local.class ?? ""}`}
      aria-hidden="true"
      {...rest}
    >
      <path d="M5 11V4a2 2 0 0 1 2-2h7l5 5v4M14 2v5h5M5 21a2 2 0 0 0 2 1h10a2 2 0 0 0 2-1" />
      <rect x="1" y="12" width="22" height="8" rx="1.5" fill="currentColor" stroke="none" />
      <path
        d="M5 18v-4h1.5a1 1 0 0 1 0 2H5m5-2v4h1a2 2 0 0 0 0-4h-1Zm6 4v-4h3m-3 2h2"
        stroke="var(--base)"
        stroke-width="1.1"
        stroke-linecap="square"
      />
    </svg>
  );
}
