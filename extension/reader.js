// This function is serialized by chrome.scripting; keep all helpers inside it.
export function readPublicSearch() {
  const url = new URL(location.href);
  if (url.origin !== 'https://www.korail.com' || url.pathname !== '/ticket/search/list') {
    return {ok: false, code: 'wrong_page'};
  }
  const root = document.querySelector('.tckWrap');
  if (!root) return {ok: false, code: 'missing_list'};
  const rendered = element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && Number(style.opacity) !== 0 && style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' && (element.getClientRects().length > 0 || style.display === 'contents');
  };
  if (!rendered(root)) return {ok: false, code: 'missing_list'};
  const compact = text => text.replace(/\s+/g, ' ').trim();
  // These are the public search conditions already observed on the site.
  const field = selector => {
    const el = document.querySelector(selector);
    return el && rendered(el) ? String(el.value || '').slice(0, 100) : '';
  };
  const conditions = {date: field('#startDate'), departure: field('#labelstart'),
    arrival: field('#labelend'), passengers: field('#labelple')};
  if (!conditions.date || !conditions.departure || !conditions.arrival) {
    return {ok: false, code: 'missing_conditions'};
  }
  let budget = 5000;
  let textBudget = 60000;
  let truncated = false;
  const excluded = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'SVG']);
  function structure(element, depth = 0) {
    if (excluded.has(element.tagName) || !rendered(element)) return null;
    if (depth > 12 || --budget < 0 || textBudget <= 0) {truncated = true; return null;}
    const ownText = compact([...element.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' '));
    const text = ownText.slice(0, Math.min(1000, textBudget));
    if (text.length < ownText.length) truncated = true;
    textBudget -= text.length;
    // Deliberately omit URLs, IDs, data attributes, form values and event handlers.
    const classes = [...element.classList].filter(c => /^[a-zA-Z_][a-zA-Z0-9_-]{0,48}$/.test(c)).slice(0, 12);
    return {tag: element.tagName.toLowerCase(), classes, text,
      children: [...element.children].map(child => structure(child, depth + 1)).filter(Boolean)};
  }
  const tree = structure(root);
  const textOf = node => [node.text, ...node.children.map(textOf)].filter(Boolean).join(' ');
  const text = tree ? textOf(tree) : '';
  const list = tree?.children.find(child => child.tag === 'ul');
  const rows = (list?.children || []).map(textOf).filter(Boolean).slice(0, 100);
  const timedRows = rows.filter(row => /\b\d{2}:\d{2}\b/.test(row));
  if ((list?.children.length || 0) > 100) truncated = true;
  return {ok: true, schemaVersion: 1, capturedAt: new Date().toISOString(),
    source: url.origin + url.pathname, conditions,
    status: text.includes('해당 스케줄에 운행하는 열차가 없습니다.') ? 'empty' :
      timedRows.length ? 'readable' : 'unrecognized',
    rows: timedRows, publicText: text, structure: tree, truncated};
}
