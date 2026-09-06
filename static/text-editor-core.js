export function lineBlockRange(value, selectionStart, selectionEnd) {
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const blockStart = value.lastIndexOf("\n", start - 1) + 1;
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", effectiveEnd);
  return { start, end, blockStart, blockEnd: nextBreak < 0 ? value.length : nextBreak };
}

export function editIndent(value, selectionStart, selectionEnd, width, outdent = false) {
  const indentWidth = width === 4 ? 4 : 2;
  const range = lineBlockRange(value, selectionStart, selectionEnd);
  const indent = " ".repeat(indentWidth);

  if (!outdent && range.start === range.end) {
    return {
      value: value.slice(0, range.start) + indent + value.slice(range.end),
      selectionStart: range.start + indent.length,
      selectionEnd: range.start + indent.length,
      replaceStart: range.start,
      replaceEnd: range.end,
      replacement: indent,
      changed: true
    };
  }

  if (outdent && range.start === range.end) {
    const line = value.slice(range.blockStart, range.blockEnd);
    const remove = line.startsWith("\t") ? 1 : Math.min(indentWidth, line.match(/^ */)?.[0].length || 0);
    if (!remove) return { value, selectionStart: range.start, selectionEnd: range.end, changed: false };
    return {
      value: value.slice(0, range.blockStart) + value.slice(range.blockStart + remove),
      selectionStart: Math.max(range.blockStart, range.start - remove),
      selectionEnd: Math.max(range.blockStart, range.end - remove),
      replaceStart: range.blockStart,
      replaceEnd: range.blockStart + remove,
      replacement: "",
      changed: true
    };
  }

  const source = value.slice(range.blockStart, range.blockEnd);
  const replacement = source.split("\n").map((line) => {
    if (!outdent) return indent + line;
    if (line.startsWith("\t")) return line.slice(1);
    const remove = Math.min(indentWidth, line.match(/^ */)?.[0].length || 0);
    return line.slice(remove);
  }).join("\n");
  if (replacement === source) {
    return { value, selectionStart: range.start, selectionEnd: range.end, changed: false };
  }
  return {
    value: value.slice(0, range.blockStart) + replacement + value.slice(range.blockEnd),
    selectionStart: range.blockStart,
    selectionEnd: range.blockStart + replacement.length,
    replaceStart: range.blockStart,
    replaceEnd: range.blockEnd,
    replacement,
    changed: true
  };
}

export function offsetForLine(value, requestedLine) {
  const total = value.split("\n").length;
  const line = Math.max(1, Math.min(total, Number.isFinite(requestedLine) ? Math.trunc(requestedLine) : 1));
  let offset = 0;
  for (let current = 1; current < line; current += 1) offset = value.indexOf("\n", offset) + 1;
  return { line, offset, total };
}
