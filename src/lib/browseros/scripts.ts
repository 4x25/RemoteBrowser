/**
 * The BrowserOS `run` tool has no separate arguments object, so the script is
 * deliberately constant. It reads only serializable page metadata and CDP
 * state and catches per-tab CDP failures (for example a tab closing mid-read).
 */
export const LIST_TABS_SCRIPT = `const pages = await browser.pages.list();
const result = [];
for (const page of pages) {
  let metrics = null;
  let history = null;
  try {
    metrics = await browser.cdpJsonForPage(page.pageId, "Page.getLayoutMetrics", "{}");
  } catch {}
  try {
    history = await browser.cdpJsonForPage(page.pageId, "Page.getNavigationHistory", "{}");
  } catch {}
  result.push({ ...page, metrics, history });
}
return result;`

export function activatePageScript(pageId: number): string {
  return `await browser.cdpJsonForPage(${pageId}, "Page.bringToFront", "{}");\nreturn { pageId: ${pageId} };`
}
