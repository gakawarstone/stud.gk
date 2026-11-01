export interface ArchiveContents {
  entries: { name: string; size: number; directory: boolean }[];
  total: number;
  truncated: boolean;
}
