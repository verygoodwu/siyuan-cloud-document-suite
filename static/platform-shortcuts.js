export function isMacPlatform(platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || "") {
  return /mac/i.test(platform);
}

export function formatShortcutHint(text, mac = isMacPlatform()) {
  if (!mac) return text;
  return text
    .replace(/Ctrl\s*\+\s*Y\s*\/\s*Ctrl\s*\+\s*Shift\s*\+\s*Z/g, "⌘⇧Z")
    .replace(/Ctrl\s*\+\s*Z\s*\/\s*Y/g, "⌘Z / ⌘⇧Z")
    .replace(/Ctrl\s*\+\s*Y/g, "⌘⇧Z")
    .replace(/Ctrl\s*\+\s*Shift\s*\+/g, "⌘⇧")
    .replace(/Ctrl\s*\+\s*/g, "⌘")
    .replace(/Alt\s*\+/g, "⌥");
}

export function applyPlatformShortcutHints(root) {
  if (!isMacPlatform()) return;
  for (const element of root.querySelectorAll("[title], [placeholder], kbd, #help")) {
    for (const attribute of ["title", "placeholder"]) {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, formatShortcutHint(element.getAttribute(attribute)));
      }
    }
    if (element.matches("kbd, #help")) element.textContent = formatShortcutHint(element.textContent);
  }
}
