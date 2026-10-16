import { File, FileImage, FileArchive, FileText } from "lucide-react";
import { fileIcon } from "./file-icon";
const assets = import.meta.glob<string>("./assets/file-icons/*.svg", { eager: true, query: "?url", import: "default" });
export function RepositoryFileIcon({ name }: { name: string }) {
  const kind = fileIcon(name);
  const url = kind && assets[`./assets/file-icons/${kind}.svg`];
  if (url) return <img className="gitlab-file-icon" src={url} alt="" aria-hidden="true" data-file-icon={kind} />;
  const Icon = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i.test(name) ? FileImage
    : /\.(zip|tar|gz|7z|rar)$/i.test(name) ? FileArchive : /\.(txt|pdf|rst)$/i.test(name) ? FileText : File;
  return <Icon size={15} strokeWidth={1.6} aria-hidden="true" />;
}
