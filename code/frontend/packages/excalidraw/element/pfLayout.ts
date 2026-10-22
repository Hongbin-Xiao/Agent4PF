import type { ExcalidrawElement } from "./types";

type PfDividerElement = Pick<ExcalidrawElement, "type" | "width">;

/**
 * 返回机器域、设计域内部竖向分隔线相对主体左边缘的位置。
 * 文本布局与 Canvas、SVG 渲染必须共用此处，避免缩放或导出后发生偏移。
 */
export const getPfDividerOffsets = (element: PfDividerElement) => {
  const width = Math.abs(element.width);
  const firstDivider = Math.min(18, width * 0.15);

  if (element.type === "pf-machine") {
    return [firstDivider, Math.min(36, width * 0.3)];
  }
  if (element.type === "pf-design") {
    return [firstDivider];
  }
  return [];
};

/** 返回问题框架图形中可放置正文的左侧偏移。 */
export const getPfTextAreaOffset = (element: PfDividerElement) =>
  getPfDividerOffsets(element).at(-1) ?? 0;
