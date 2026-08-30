function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

export function flattenMindNodes(root) {
  if (!root) return [];
  const rows = [];
  const visit = (node, depth, parentId, ancestorIds, visible) => {
    if (!node) return;
    const id = String(node.id ?? "");
    const topic = String(node.topic ?? "").trim() || "输入文字";
    const children = Array.isArray(node.children) ? node.children : [];
    const row = {
      id,
      topic,
      depth,
      parentId,
      ancestorIds,
      hasChildren: children.length > 0,
      expanded: node.expanded !== false,
      visible,
      node
    };
    rows.push(row);
    const childVisible = visible && row.expanded;
    for (const child of children) {
      visit(child, depth + 1, id, [...ancestorIds, id], childVisible);
    }
  };
  visit(root, 0, null, [], true);
  return rows;
}

export function searchMindNodes(root, query) {
  const tokens = normalizedText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return flattenMindNodes(root).filter((row) => {
    const topic = normalizedText(row.topic);
    return tokens.every((token) => topic.includes(token));
  });
}

export function buildOutlineRows(root, query = "") {
  const rows = flattenMindNodes(root);
  const matches = searchMindNodes(root, query);
  if (!normalizedText(query)) return rows.filter((row) => row.visible);
  const included = new Set();
  for (const match of matches) {
    included.add(match.id);
    for (const ancestorId of match.ancestorIds) included.add(ancestorId);
  }
  const matchedIds = new Set(matches.map((row) => row.id));
  return rows
    .filter((row) => included.has(row.id))
    .map((row) => ({ ...row, matched: matchedIds.has(row.id) }));
}

export function nextSearchResultId(results, currentId, step = 1) {
  if (!results.length) return undefined;
  const direction = step < 0 ? -1 : 1;
  const currentIndex = results.findIndex((row) => row.id === currentId);
  const nextIndex = currentIndex < 0
    ? direction > 0 ? 0 : results.length - 1
    : (currentIndex + direction + results.length) % results.length;
  return results[nextIndex]?.id;
}

export function expandNodeAncestors(root, nodeId) {
  const row = flattenMindNodes(root).find((candidate) => candidate.id === nodeId);
  if (!row) return false;
  const ancestors = new Set(row.ancestorIds);
  let changed = false;
  for (const candidate of flattenMindNodes(root)) {
    if (ancestors.has(candidate.id) && candidate.node.expanded === false) {
      candidate.node.expanded = true;
      changed = true;
    }
  }
  return changed;
}

export function captureMindExpansion(root) {
  return Object.fromEntries(
    flattenMindNodes(root)
      .filter((row) => row.hasChildren)
      .map((row) => [row.id, row.expanded])
  );
}

export function restoreMindExpansion(root, snapshot, excludedIds = []) {
  if (!root || !snapshot) return 0;
  const excluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
  let changed = 0;
  for (const row of flattenMindNodes(root)) {
    if (excluded.has(row.id) || !Object.hasOwn(snapshot, row.id)) continue;
    const expanded = snapshot[row.id] !== false;
    if ((row.node.expanded !== false) === expanded) continue;
    row.node.expanded = expanded;
    changed += 1;
  }
  return changed;
}

export function resolveMindShortcut(event, context = {}) {
  const key = String(event?.key ?? "");
  const ctrl = Boolean(event?.ctrlKey || event?.metaKey);
  const alt = Boolean(event?.altKey);
  const shift = Boolean(event?.shiftKey);
  if (context.editing) return undefined;
  if (context.helpOpen && key === "Escape") return "close-help";
  if (context.workspaceOpen && key === "Escape") return "close-workspace";
  if (context.focusMode && key === "Escape") return "exit-focus";
  if (!ctrl && !alt && key === "?") return "toggle-help";
  if (ctrl && !alt && key === "Home") return "focus-root";
  if (ctrl && !alt && !shift && key === "/" && context.hasSelection && context.hasChildren) {
    return "toggle-branch";
  }
  return undefined;
}
