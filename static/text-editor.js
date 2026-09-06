import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js?v=__PLUGIN_VERSION__-sync2";
import { editIndent, offsetForLine } from "./text-editor-core.js?v=__PLUGIN_VERSION__-text15";
import { createEditorSession, createOperationNotice, downloadBytes, showLeaseState, showStoreOpenError } from "./editor-session.js?v=__PLUGIN_VERSION__-session2";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const RECOVERY_LIMIT = 1024 * 1024;
const PREFERENCES_KEY = "siyuan-text-editor:preferences-v1";
const LINE_HEIGHT = 20.8;
const EDITOR_PADDING_TOP = 14;
const params = new URLSearchParams(location.search);
const asset = params.get("asset") || "";
const requestedName = params.get("name") || "";
const fileName = requestedName || (() => {
  try { return decodeURIComponent(asset.split("/").pop() || "文本文件.txt"); }
  catch { return asset.split("/").pop() || "文本文件.txt"; }
})();
const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "txt";
const htmlFile = extension === "html" || extension === "htm";

const editor = document.querySelector("#editor");
const gutter = document.querySelector("#gutter");
const status = document.querySelector("#status");
const workspace = document.querySelector("#workspace");
const preview = document.querySelector("#preview");
const previewToggle = document.querySelector("#preview-toggle");
const currentLine = document.querySelector("#current-line");
const findInput = document.querySelector("#find");
const replaceInput = document.querySelector("#replace");
const matchCount = document.querySelector("#match-count");
const searchPanel = document.querySelector("#search");
const saveButton = document.querySelector("#save");
const reloadButton = document.querySelector("#reload");
const indentButton = document.querySelector("#indent");
const lineNumberInput = document.querySelector("#line-number");
const retrySaveButton = document.querySelector("#retry-save");
const recoveryButton = document.querySelector("#download-recovery");
const replaceAllButton = document.querySelector("#replace-all");
const savedAt = document.querySelector("#saved-at");
const fullscreenButton = document.querySelector("#fullscreen");
const encoder = new TextEncoder();
const store = new SiyuanFileStore(asset, `siyuan-text-editor:${asset}`, { rawApi: true });
const viewSession = createEditorSession("text", asset);
const notice = createOperationNotice();
document.body.dataset.fileReadTransport = store.rawApi ? "api" : "asset";

document.querySelector("#file-name").textContent = fileName;
document.querySelector("#kind").textContent = extension;
previewToggle.hidden = !htmlFile;

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  }
  catch { return {}; }
}

const preferences = readPreferences();

let newline = "\n";
let hasBom = false;
let dirty = false;
let saveTimer = 0;
let saving = false;
let saveAgain = false;
let editRevision = 0;
let lastLineCount = 0;
let indentWidth = preferences.indentWidth === 4 ? 4 : 2;
let previewVisible = htmlFile && preferences.previewVisible === true;
let previewTimer = 0;
let lastSaveError = "";
let viewTimer = 0;

function saveViewState() {
  window.clearTimeout(viewTimer);
  viewSession.write({
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    scrollTop: editor.scrollTop,
    scrollLeft: editor.scrollLeft
  });
}

function scheduleViewState() {
  window.clearTimeout(viewTimer);
  viewTimer = window.setTimeout(saveViewState, 180);
}

function savePreferences() {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
      indentWidth,
      wrap: editor.classList.contains("wrap"),
      previewVisible
    }));
  } catch (error) {
    console.warn("[Cloud Document Suite] Cannot save text editor preferences", error);
  }
}

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.classList.toggle("error", state === "error");
  status.dataset.state = state;
  status.title = message;
  retrySaveButton.hidden = state !== "error" || editor.readOnly || !dirty;
  recoveryButton.hidden = state !== "error" || !editor.value;
}

function displaySize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function detectNewline(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}

function serializedBytes() {
  const normalized = newline === "\r\n" ? editor.value.replace(/\n/g, "\r\n") : editor.value;
  const bytes = encoder.encode(normalized);
  if (!hasBom) return bytes;
  const result = new Uint8Array(bytes.length + 3);
  result.set([0xef, 0xbb, 0xbf]);
  result.set(bytes, 3);
  return result;
}

function updateGutter() {
  const count = editor.value.split("\n").length;
  if (count === lastLineCount) return;
  lastLineCount = count;
  gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
}

function updatePosition() {
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  document.querySelector("#position").textContent = `行 ${line}，列 ${before.length - lastBreak}`;
}

function updateCurrentLine() {
  if (editor.classList.contains("wrap")) {
    currentLine.hidden = true;
    return;
  }
  const line = editor.value.slice(0, editor.selectionStart).split("\n").length - 1;
  const top = EDITOR_PADDING_TOP + line * LINE_HEIGHT - editor.scrollTop;
  currentLine.hidden = top + LINE_HEIGHT < 0 || top > editor.clientHeight;
  currentLine.style.transform = `translateY(${top}px)`;
}

function updateSize() {
  document.querySelector("#size").textContent = displaySize(serializedBytes().byteLength);
}

function updateStatistics() {
  const lines = editor.value.split("\n").length;
  const selected = Math.max(0, editor.selectionEnd - editor.selectionStart);
  document.querySelector("#statistics").textContent = selected
    ? `${lines} 行 · ${editor.value.length} 字符 · 已选 ${selected}`
    : `${lines} 行 · ${editor.value.length} 字符`;
}

function updateUi() {
  updateGutter();
  updatePosition();
  updateCurrentLine();
  updateSize();
  updateStatistics();
}

function cacheRecovery() {
  const bytes = serializedBytes();
  if (bytes.byteLength > RECOVERY_LIMIT) return;
  try {
    store.cacheRecovery({ text: editor.value, newline, hasBom });
  } catch (error) {
    console.warn("[Cloud Document Suite] Cannot cache text recovery", error);
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 800);
}

async function saveNow(notify = false) {
  window.clearTimeout(saveTimer);
  if (!dirty || editor.readOnly) {
    if (notify && !editor.readOnly) notice.show("内容已保存，无需重复写入");
    return;
  }
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  const savingRevision = editRevision;
  const bytes = serializedBytes();
  saveButton.disabled = true;
  reloadButton.disabled = true;
  setStatus("正在保存…", "working");
  try {
    await store.save(bytes);
    if (savingRevision === editRevision) {
      dirty = false;
      lastSaveError = "";
      setStatus("已保存", "saved");
      savedAt.textContent = `保存于 ${new Date().toLocaleTimeString()}`;
      if (notify) notice.show("已保存到思源附件");
    } else {
      dirty = true;
      saveAgain = true;
      setStatus("有新修改，继续保存…", "working");
    }
  } catch (error) {
    if (error instanceof SaveConflictError || error?.code === "SAVE_CONFLICT") {
      editor.readOnly = true;
      setStatus("保存冲突：文件已在别处修改，为防止覆盖已暂停编辑", "error");
      notice.show("保存冲突：已暂停编辑并保留本机恢复内容", {
        tone: "error",
        duration: 0,
        actions: [{ label: "下载恢复副本", run: downloadCurrent }]
      });
    } else {
      lastSaveError = error instanceof Error ? error.message : String(error);
      setStatus(`保存失败：${lastSaveError}`, "error");
      notice.show(`保存失败：${lastSaveError}`, {
        tone: "error",
        duration: 0,
        actions: [
          { label: "重试", run: () => void saveNow(true) },
          { label: "下载恢复副本", run: downloadCurrent }
        ]
      });
    }
  } finally {
    saving = false;
    saveButton.disabled = editor.readOnly;
    reloadButton.disabled = false;
    if (saveAgain) {
      saveAgain = false;
      if (dirty) void saveNow();
    }
  }
}

function changeIndent(outdent) {
  const result = editIndent(editor.value, editor.selectionStart, editor.selectionEnd, indentWidth, outdent);
  if (!result.changed) return;
  editor.setRangeText(result.replacement, result.replaceStart, result.replaceEnd, "preserve");
  editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  recordEdit();
}

function goToLine() {
  const requested = Number.parseInt(lineNumberInput.value, 10);
  if (!Number.isFinite(requested)) return;
  const target = offsetForLine(editor.value, requested);
  editor.focus();
  editor.setSelectionRange(target.offset, target.offset);
  if (!editor.classList.contains("wrap")) {
    editor.scrollTop = Math.max(0, (target.line - 1) * LINE_HEIGHT - editor.clientHeight / 2);
  }
  lineNumberInput.value = String(target.line);
  updateUi();
}

function renderPreview() {
  if (!htmlFile || !previewVisible) return;
  const policy = "default-src 'none'; img-src data: blob: http: https:; style-src 'unsafe-inline'; font-src data:;";
  preview.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${policy}">${editor.value}`;
}

function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(renderPreview, 250);
}

function recordEdit() {
  editRevision += 1;
  dirty = true;
  setStatus("等待自动保存…", "working");
  cacheRecovery();
  updateUi();
  scheduleSave();
  schedulePreview();
}

function openSearch() {
  searchPanel.hidden = false;
  findInput.focus();
  findInput.select();
  updateMatchCount();
}

function matches() {
  const query = findInput.value;
  if (!query) return [];
  const result = [];
  let offset = 0;
  while (offset <= editor.value.length) {
    const index = editor.value.indexOf(query, offset);
    if (index < 0) break;
    result.push(index);
    offset = index + Math.max(query.length, 1);
  }
  return result;
}

function updateMatchCount() {
  const found = matches();
  const current = found.findIndex((offset) => (
    editor.selectionStart === offset && editor.selectionEnd === offset + findInput.value.length
  ));
  matchCount.textContent = found.length
    ? current >= 0 ? `${current + 1}/${found.length}` : `${found.length} 项`
    : "0 项";
  replaceAllButton.textContent = `全部替换（${found.length}）`;
  return found;
}

function findNext(direction = 1) {
  const found = updateMatchCount();
  if (!found.length) return;
  const position = direction > 0 ? editor.selectionEnd : editor.selectionStart;
  let index = direction > 0
    ? found.find((value) => value >= position)
    : [...found].reverse().find((value) => value < position);
  if (index === undefined) index = direction > 0 ? found[0] : found[found.length - 1];
  editor.focus();
  editor.setSelectionRange(index, index + findInput.value.length);
  updateUi();
  updateMatchCount();
}

function replaceOne() {
  const query = findInput.value;
  if (!query) return;
  if (editor.value.slice(editor.selectionStart, editor.selectionEnd) !== query) findNext(1);
  if (editor.value.slice(editor.selectionStart, editor.selectionEnd) !== query) return;
  editor.setRangeText(replaceInput.value, editor.selectionStart, editor.selectionEnd, "select");
  recordEdit();
  updateMatchCount();
}

function replaceAll() {
  const query = findInput.value;
  if (!query) return;
  const count = matches().length;
  if (!count) return;
  if (count > 1 && !window.confirm(`将替换 ${count} 处内容，是否继续？`)) return;
  const previous = {
    value: editor.value,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
    scrollTop: editor.scrollTop,
    scrollLeft: editor.scrollLeft
  };
  editor.value = editor.value.split(query).join(replaceInput.value);
  recordEdit();
  updateMatchCount();
  notice.show(`已替换 ${count} 处内容`, {
    actions: [{
      label: "撤销",
      run: () => {
        editor.value = previous.value;
        editor.setSelectionRange(previous.selectionStart, previous.selectionEnd);
        editor.scrollTop = previous.scrollTop;
        editor.scrollLeft = previous.scrollLeft;
        recordEdit();
        updateMatchCount();
        editor.focus();
      }
    }]
  });
}

function downloadCurrent() {
  downloadBytes(serializedBytes(), fileName, htmlFile ? "text/html;charset=utf-8" : "text/plain;charset=utf-8");
  notice.show(`已导出 ${fileName}`);
}

function openOriginal() {
  window.open(asset, "_blank", "noopener,noreferrer");
}

async function copyAssetPath() {
  try {
    await navigator.clipboard.writeText(asset);
    setStatus("已复制附件路径", dirty ? "working" : "saved");
  } catch {
    setStatus("无法访问剪贴板，请从文档附件复制路径", "error");
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    setStatus(`无法切换全屏：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

editor.addEventListener("input", () => { recordEdit(); scheduleViewState(); });
editor.addEventListener("scroll", () => { gutter.scrollTop = editor.scrollTop; updateCurrentLine(); scheduleViewState(); });
editor.addEventListener("click", () => { updateUi(); scheduleViewState(); });
editor.addEventListener("select", scheduleViewState);
editor.addEventListener("keyup", () => { updatePosition(); updateCurrentLine(); scheduleViewState(); });
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    changeIndent(event.shiftKey);
  }
});

document.querySelector("#undo").addEventListener("click", () => { editor.focus(); document.execCommand("undo"); updateUi(); });
document.querySelector("#redo").addEventListener("click", () => { editor.focus(); document.execCommand("redo"); updateUi(); });
document.querySelector("#save").addEventListener("click", () => void saveNow(true));
document.querySelector("#download").addEventListener("click", downloadCurrent);
fullscreenButton.addEventListener("click", () => void toggleFullscreen());
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.textContent = active ? "退出全屏" : "全屏";
  fullscreenButton.title = active ? "退出全屏" : "全屏查看";
  fullscreenButton.setAttribute("aria-pressed", String(active));
});
document.querySelector("#search-toggle").addEventListener("click", openSearch);
reloadButton.addEventListener("click", () => void reloadRemote());
document.querySelector("#search-close").addEventListener("click", () => { searchPanel.hidden = true; editor.focus(); });
document.querySelector("#next").addEventListener("click", () => findNext(1));
document.querySelector("#previous").addEventListener("click", () => findNext(-1));
document.querySelector("#replace-one").addEventListener("click", replaceOne);
document.querySelector("#replace-all").addEventListener("click", replaceAll);
findInput.addEventListener("input", updateMatchCount);
findInput.addEventListener("keydown", (event) => { if (event.key === "Enter") findNext(event.shiftKey ? -1 : 1); });
document.querySelector("#wrap").addEventListener("click", (event) => {
  editor.classList.toggle("wrap");
  event.currentTarget.classList.toggle("active", editor.classList.contains("wrap"));
  savePreferences();
  updateCurrentLine();
});
indentButton.addEventListener("click", () => {
  indentWidth = indentWidth === 2 ? 4 : 2;
  indentButton.textContent = `缩进 ${indentWidth}`;
  editor.style.tabSize = String(indentWidth);
  savePreferences();
});
previewToggle.addEventListener("click", () => {
  previewVisible = !previewVisible;
  preview.hidden = !previewVisible;
  previewToggle.classList.toggle("active", previewVisible);
  savePreferences();
  if (previewVisible) renderPreview();
});
document.querySelector("#goto-line").addEventListener("click", (event) => {
  event.preventDefault();
  goToLine();
});
lineNumberInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); goToLine(); }
});
document.querySelector("#open-original").addEventListener("click", openOriginal);
document.querySelector("#copy-path").addEventListener("click", () => void copyAssetPath());
retrySaveButton.addEventListener("click", () => {
  if (!dirty || editor.readOnly) return;
  setStatus(lastSaveError ? `正在重试：${lastSaveError}` : "正在重试保存…", "working");
  void saveNow();
});
recoveryButton.addEventListener("click", downloadCurrent);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !searchPanel.hidden) {
    event.preventDefault();
    searchPanel.hidden = true;
    editor.focus();
    return;
  }
  if (event.key === "F2") {
    event.preventDefault();
    editor.focus();
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") { event.preventDefault(); void saveNow(true); }
  else if (key === "f") { event.preventDefault(); openSearch(); }
  else if (key === "h") { event.preventDefault(); openSearch(); replaceInput.focus(); }
  else if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    editor.focus();
    document.execCommand("redo");
    updateUi();
  }
  else if (key === "z") {
    event.preventDefault();
    editor.focus();
    document.execCommand("undo");
    updateUi();
  }
});
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === "siyuan-cloud-document-export" && event.data?.format === "text") downloadCurrent();
});
window.addEventListener("beforeunload", (event) => {
  if (!dirty && !saving) return;
  event.preventDefault();
  event.returnValue = "文本仍在保存，确定离开吗？";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && dirty && !saving) void saveNow();
});
window.addEventListener("pagehide", saveViewState);

async function load({ restoreRecovery = true, reloaded = false } = {}) {
  try {
    editor.readOnly = false;
    saveButton.disabled = false;
    setStatus(reloaded ? "正在重新加载…" : "正在加载…", "working");
    const bytes = await store.openRemote();
    const tooLarge = bytes.byteLength > MAX_FILE_BYTES;
    hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const source = hasBom ? bytes.subarray(3) : bytes;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(source);
      if (text.includes("\0")) throw new Error("binary-content");
    } catch {
      text = new TextDecoder("utf-8").decode(source);
      editor.readOnly = true;
      setStatus("检测到非 UTF-8 编码；为防止损坏，仅允许只读查看", "error");
    }
    if (!store.canEdit()) {
      editor.readOnly = true;
    }
    if (tooLarge) {
      editor.readOnly = true;
      setStatus(`文件为 ${displaySize(bytes.byteLength)}，超过 5 MB 轻量编辑范围，已切换为只读`, "error");
    }
    newline = detectNewline(text);
    editor.value = text.replace(/\r\n?/g, "\n");
    dirty = false;
    const recovery = restoreRecovery ? store.readRecovery() : null;
    if (!editor.readOnly && recovery?.payload?.text != null && (!recovery.baseHash || recovery.baseHash === store.baseHash)) {
      editor.value = String(recovery.payload.text);
      newline = recovery.payload.newline === "\r\n" ? "\r\n" : "\n";
      hasBom = Boolean(recovery.payload.hasBom);
      dirty = true;
      editRevision += 1;
      setStatus("已恢复上次未完成的编辑，正在保存…", "working");
      scheduleSave();
    } else if (!editor.readOnly) {
      setStatus(reloaded ? "已重新加载原文件" : "已加载 · 自动保存已开启", "saved");
    }
    savedAt.textContent = `${reloaded ? "重新读取" : "读取"}于 ${new Date().toLocaleTimeString()}`;
    document.querySelector("#encoding").textContent = hasBom ? "UTF-8 BOM" : "UTF-8";
    document.querySelector("#newline").textContent = newline === "\r\n" ? "CRLF" : "LF";
    updateUi();
    if (!store.canEdit()) showLeaseState(store, notice, setStatus);
    if (previewVisible) renderPreview();
    const view = viewSession.read();
    window.requestAnimationFrame(() => {
      const start = Math.max(0, Math.min(editor.value.length, Number(view.selectionStart) || 0));
      const end = Math.max(start, Math.min(editor.value.length, Number(view.selectionEnd) || start));
      editor.setSelectionRange(start, end);
      editor.scrollTop = Math.max(0, Number(view.scrollTop) || 0);
      editor.scrollLeft = Math.max(0, Number(view.scrollLeft) || 0);
      gutter.scrollTop = editor.scrollTop;
      updateUi();
      editor.focus();
    });
  } catch (error) {
    editor.readOnly = true;
    saveButton.disabled = true;
    if (!showStoreOpenError(error, store, notice, setStatus)) {
      setStatus(`无法打开：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
}

async function reloadRemote() {
  if (saving) {
    setStatus("正在保存，请稍后重新加载", "working");
    return;
  }
  if (dirty && !window.confirm("重新加载会丢弃尚未保存的本地修改，是否继续？")) return;
  window.clearTimeout(saveTimer);
  store.clearRecovery();
  await load({ restoreRecovery: false, reloaded: true });
}

editor.classList.toggle("wrap", preferences.wrap === true);
document.querySelector("#wrap").classList.toggle("active", editor.classList.contains("wrap"));
indentButton.textContent = `缩进 ${indentWidth}`;
editor.style.tabSize = String(indentWidth);
document.querySelector("#download").textContent = `导出 .${extension}`;
recoveryButton.textContent = `下载恢复副本 .${extension}`;
preview.hidden = !previewVisible;
previewToggle.classList.toggle("active", previewVisible);

void load();
