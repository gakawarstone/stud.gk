export function nextcloudUrl(value: string): string | null {
  const input = value.trim();
  if (!/^https?:\/\//i.test(input)) return null;
  try {
    const url = new URL(input);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
