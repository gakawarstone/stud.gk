import { File, FileArchive, FileImage, FileText } from "lucide-solid";
import { createMemo } from "solid-js";
import { Dynamic } from "solid-js/web";
import { fileIcon } from "./file-icon";
const assets = import.meta.glob<string>("./assets/file-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
export function RepositoryFileIcon(props: { name: string }) {
  const kind = createMemo(() => fileIcon(props.name));
  const url = createMemo(
    () => kind() && assets[`./assets/file-icons/${kind()}.svg`],
  );
  const view = () => {
    if (url())
      return (
        <img
          class="gitlab-file-icon"
          src={url() || undefined}
          alt=""
          aria-hidden="true"
          data-file-icon={kind()}
        />
      );
    const Icon = createMemo(() =>
      /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i.test(props.name)
        ? FileImage
        : /\.(zip|tar|gz|7z|rar)$/i.test(props.name)
          ? FileArchive
          : /\.(txt|pdf|rst)$/i.test(props.name)
            ? FileText
            : File,
    );
    return (
      <Dynamic
        component={Icon()}
        size={15}
        stroke-width={1.6}
        aria-hidden="true"
      />
    );
  };
  return <>{view()}</>;
}
