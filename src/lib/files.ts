/**
 * A short, readable name for a stored document link: the file name at the end
 * of its URL ("E881-Siddik-2026-11-01.pdf") rather than the whole address,
 * which is long enough to push a layout wider than the screen.
 */
export function documentName(link: string): string {
  try {
    const last = new URL(link).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : link;
  } catch {
    return link;
  }
}
