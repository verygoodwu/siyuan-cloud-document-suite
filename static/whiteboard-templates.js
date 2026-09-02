import { createWhiteboardNode } from "./whiteboard-model.js?v=__PLUGIN_VERSION__";

const shape = (type, x, y, text, style = {}) => createWhiteboardNode(type, { x, y, text, style });
const link = (from, to) => createWhiteboardNode("connector", {
  from: { nodeId: from.id, anchor: "right" },
  to: { nodeId: to.id, anchor: "left" }
});

export const WHITEBOARD_TEMPLATES = [
  { id: "flow", name: "流程图", description: "开始、处理、判断与结束" },
  { id: "brainstorm", name: "头脑风暴", description: "中心主题与四个方向" },
  { id: "plan", name: "项目计划", description: "待办、进行中与已完成" }
];

export function instantiateWhiteboardTemplate(id, origin = { x: 0, y: 0 }) {
  const x = origin.x;
  const y = origin.y;
  if (id === "brainstorm") {
    const center = shape("ellipse", x, y, "中心主题", { fill: "#3370ff", stroke: "#3370ff", textColor: "#ffffff", fontWeight: "bold" });
    const leaves = [
      shape("rect", x + 280, y - 150, "想法一"), shape("rect", x + 280, y + 10, "想法二"),
      shape("rect", x - 280, y - 150, "想法三"), shape("rect", x - 280, y + 10, "想法四")
    ];
    const connectors = leaves.map((leaf) => createWhiteboardNode("connector", {
      from: { nodeId: center.id, anchor: leaf.x > x ? "right" : "left" },
      to: { nodeId: leaf.id, anchor: leaf.x > x ? "left" : "right" }, lineShape: "curve"
    }));
    return [center, ...connectors, ...leaves];
  }
  if (id === "plan") {
    const cards = ["待办", "进行中", "已完成"].flatMap((title, column) => {
      const frame = createWhiteboardNode("frame", { x: x + column * 260, y, width: 220, height: 330, text: title, childIds: [] });
      const items = [0, 1].map((row) => shape("sticky", x + 25 + column * 260, y + 62 + row * 125, `${title}任务 ${row + 1}`, { fill: column === 2 ? "#d9f7be" : "#fff1b8" }));
      frame.childIds = items.map((item) => item.id);
      return [frame, ...items];
    });
    return cards;
  }
  const start = shape("ellipse", x, y, "开始", { fill: "#e8f3ff" });
  const process = shape("rect", x + 250, y, "处理任务");
  const decision = shape("diamond", x + 500, y - 8, "是否完成？", { fill: "#fff1b8" });
  const end = shape("ellipse", x + 770, y, "结束", { fill: "#d9f7be" });
  return [start, link(start, process), process, link(process, decision), decision, link(decision, end), end];
}
