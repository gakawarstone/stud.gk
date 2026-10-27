import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, GitBranch, Search } from "lucide-react";
import type { GitlabBranch } from "./gitlab-api";

export function GitlabBranchPicker({ branches, value, loading, onChange }: {
  branches: GitlabBranch[]; value: string; loading: boolean; onChange: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null);
  const id = useId();
  const matches = branches.filter((branch) => branch.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    const options = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index >= 0 && ["Enter", " "].includes(event.key)) {
      event.preventDefault(); options[index].click(); return;
    }
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(options.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = index < 0 ? options.length - 1 : index - 1;
    else if (index >= 0 && event.key === "Home") next = 0;
    else if (index >= 0 && event.key === "End") next = options.length - 1;
    if (next !== null) { event.preventDefault(); if (next < 0) search.current?.focus(); else options[next]?.focus(); }
  }
  return <div className="gitlab-branch-picker" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} className="gitlab-branch-trigger" type="button" aria-label={`Ветка GitLab: ${value || "нет веток"}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={loading || !branches.length}
      onClick={() => { setQuery(""); setOpen(!open); }} onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setQuery(""); setOpen(true); }
      }}><GitBranch size={16} aria-hidden="true" /><span>{value || (loading ? "Загрузка…" : "Нет веток")}</span><ChevronDown size={13} aria-hidden="true" /></button>
    {open && <div id={id} className="gitlab-branch-popover" role="dialog" aria-label="Сменить ветку" onKeyDown={navigate}>
      <label className="gitlab-branch-search"><Search size={15} aria-hidden="true" />
        <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Найти ветку" placeholder="Найти ветку…" autoComplete="off" />
      </label>
      <div className="gitlab-branch-options" role="listbox" aria-label="Ветки GitLab">
        {matches.map((branch) => <button key={branch.name} type="button" role="option" aria-selected={branch.name === value} title={branch.name}
          onClick={() => { close(); if (branch.name !== value) onChange(branch.name); }}>
          <GitBranch size={14} aria-hidden="true" /><span>{branch.name}</span>{branch.name === value && <Check size={15} aria-hidden="true" />}
        </button>)}
        {!matches.length && <p role="status">Ветки не найдены</p>}
      </div>
    </div>}
  </div>;
}
