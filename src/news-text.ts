// Preserve full link targets when only their visible text fits in a collapsed post.
export function newsParts(text: string, expanded: boolean) {
  let remaining = expanded || text.length <= 420 ? text.length : 420;
  return text
    .split(/(https?:\/\/[^\s<>"']+)/gi)
    .flatMap<{ visible: string; url: string | null }>((part) => {
      const visible = part.slice(0, Math.max(0, remaining));
      remaining -= part.length;
      if (!visible) return [];
      if (!/^https?:\/\//i.test(part)) return [{ visible, url: null }];
      let url = part.replace(/[.,!?;:]+$/, "");
      for (const [open, close] of [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
      ]) {
        while (
          url.endsWith(close) &&
          url.split(close).length > url.split(open).length
        )
          url = url.slice(0, -1);
      }
      return [{ visible, url }];
    });
}
