import { BOUND_TEXT_PADDING } from "../constants";
import { newElementWith } from "./mutateElement";
import { getPfTextAreaOffset } from "./pfLayout";
import {
  getBoundTextMaxWidth,
  getContainerElement,
  redrawTextBoundingBox,
} from "./textElement";
import { measureText } from "./textMeasurements";
import { wrapText } from "./textWrapping";
import { getFontString } from "../utils";
import { isLinearElement, isTextElement } from "./typeChecks";
import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "./types";

/**
 * 领域图形的最小尺寸。候选领域由提案生成，正文短时也应保持可读的块面，
 * 因此宽高分别设下限。
 */
const PF_SHAPE_MIN_WIDTH = 96;
const PF_SHAPE_MIN_HEIGHT = 56;

/** 椭圆类图形内接矩形的换算系数：内接矩形宽高都是容器的 1/√2。 */
const isPfEllipse = (shape: ExcalidrawElement) =>
  shape.type === "ellipse" || shape.type === "pf-requirement";

/** 正文所需的最小容器宽度（含椭圆内接矩形与机器域/设计域的正文偏移）。 */
const requiredWidthForText = (
  shape: ExcalidrawElement,
  text: ExcalidrawTextElement,
  wrappedText: string,
) => {
  const metrics = measureText(
    wrappedText,
    getFontString(text),
    text.lineHeight,
  );
  const textWidth = metrics.width + BOUND_TEXT_PADDING * 2;
  if (isPfEllipse(shape)) {
    // 椭圆内能放下的最大矩形是 width/√2，因此容器宽度要按 √2 放大。
    return Math.round(textWidth * Math.SQRT2);
  }
  return textWidth + getPfTextAreaOffset(shape);
};

/** 正文所需的最小容器高度。 */
const requiredHeightForText = (
  shape: ExcalidrawElement,
  text: ExcalidrawTextElement,
  wrappedText: string,
) => {
  const metrics = measureText(
    wrappedText,
    getFontString(text),
    text.lineHeight,
  );
  const textHeight = metrics.height + BOUND_TEXT_PADDING * 2;
  return isPfEllipse(shape) ? Math.round(textHeight * Math.SQRT2) : textHeight;
};

/**
 * 让领域/需求图形的尺寸与正文匹配，避免正文溢出边框，也避免空图形过大。
 *
 * 默认情况下，正文放不下会把图形扩大到单行宽度；设置 maxWidth 的图形则
 * 保持在该宽度内并使用绑定文本的自动换行，只根据换行结果增加高度。
 * 只有由提案接管的图形
 * （明确传 allowShrink）才会在正文变短时回缩，避免覆盖用户手动调整的尺寸。
 * 所有调整以图形中心为锚点，因此正文始终保持居中。
 */
export const fitPfShapeWithText = (
  shape: ExcalidrawElement,
  text: ExcalidrawTextElement | null,
  elementsMap: ElementsMap,
  options: { allowShrink?: boolean; maxWidth?: number } = {},
): { shape: ExcalidrawElement; text: ExcalidrawTextElement | null } => {
  if (
    !text ||
    !isTextElement(text) ||
    isLinearElement(shape) ||
    shape.type === "text" ||
    !(text.originalText || text.text).trim()
  ) {
    return { shape, text };
  }

  const font = getFontString(text);
  const originalText = text.originalText || text.text;
  const width = Math.abs(shape.width);
  const height = Math.abs(shape.height);
  const layoutWidth = options.maxWidth
    ? Math.min(width, options.maxWidth)
    : width;
  const layoutShape =
    layoutWidth === width
      ? shape
      : ({ ...shape, width: layoutWidth } as ExcalidrawElement);
  const nextSize = { width: layoutWidth, height };

  const singleLineWidth = requiredWidthForText(shape, text, originalText);
  const fitsOnOneLine = singleLineWidth <= layoutWidth;
  const wrapped = wrapText(
    originalText,
    font,
    Math.max(40, getBoundTextMaxWidth(layoutShape, text)),
  );
  const wrappedMetrics = measureText(wrapped, font, text.lineHeight);
  // 换行后宽度必须仍小于可换行宽度，否则说明现在的图形太窄，挤压了正文。
  const stillSqueezed =
    wrappedMetrics.width > getBoundTextMaxWidth(layoutShape, text);
  const heightRequired = requiredHeightForText(layoutShape, text, wrapped);

  if (!fitsOnOneLine || stillSqueezed) {
    // Bound text already wraps itself through redrawTextBoundingBox. For
    // capped shapes (such as requirements), keep a readable width and let
    // the container grow vertically instead of expanding to one line.
    nextSize.width = options.maxWidth
      ? Math.max(layoutWidth, PF_SHAPE_MIN_WIDTH)
      : Math.max(width, singleLineWidth, PF_SHAPE_MIN_WIDTH);
    nextSize.height = Math.max(height, heightRequired, PF_SHAPE_MIN_HEIGHT);
  } else if (heightRequired > height) {
    nextSize.height = Math.max(heightRequired, PF_SHAPE_MIN_HEIGHT);
  } else if (options.allowShrink) {
    // 正文已经能单行放下，就只占正文所需的块面。
    nextSize.width = Math.max(
      PF_SHAPE_MIN_WIDTH,
      Math.min(layoutWidth, singleLineWidth),
    );
    nextSize.height = Math.max(
      PF_SHAPE_MIN_HEIGHT,
      Math.min(height, heightRequired),
    );
  }

  const sizeChanged =
    Math.abs(nextSize.width - width) >= 0.5 ||
    Math.abs(nextSize.height - height) >= 0.5;
  let nextShape = shape;
  if (sizeChanged) {
    // 以中心为锚点缩放，正文的居中位置才不需要额外补偿。
    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;
    nextShape = newElementWith(shape, {
      x: centerX - nextSize.width / 2,
      y: centerY - nextSize.height / 2,
      width: nextSize.width,
      height: nextSize.height,
    });
  }

  // 正文变化后，即使容器尺寸不变，也必须重新计算换行、边界和居中坐标。
  // redrawTextBoundingBox 会就地微调副本；容器同样使用副本，避免排版时改写输入。
  const layoutContainer = { ...nextShape } as ExcalidrawElement;
  const nextText = { ...text } as ExcalidrawTextElement;
  const shapeVersion = layoutContainer.version;
  const textVersion = nextText.version;
  redrawTextBoundingBox(nextText, layoutContainer, elementsMap, false);
  return {
    shape:
      layoutContainer.version === shapeVersion ? nextShape : layoutContainer,
    text: nextText.version === textVersion ? text : nextText,
  };
};

/** 问题框架自有的图形类型前缀，普通图形不参与这套排版规则。 */
const PF_SHAPE_TYPES = new Set([
  "pf-machine",
  "pf-design",
  "pf-given",
  "pf-causal",
  "pf-biddable",
  "pf-lexical",
  "pf-property",
  "pf-requirement",
]);

const isPfShape = (element: ExcalidrawElement) =>
  PF_SHAPE_TYPES.has(element.type);

/**
 * 用户在内联编辑里改完正文后调用：把承载正文的问题框架图形调整到刚好的大小。
 *
 * 只处理问题框架自己的图形；普通矩形、菱形、椭圆仍走 Excalidraw 原生尺寸
 * 逻辑。返回 null 表示无需调整。
 */
export const fitPfContainerToText = (
  text: ExcalidrawTextElement,
  elementsMap: ElementsMap,
): { shape: ExcalidrawElement; text: ExcalidrawTextElement } | null => {
  const container = getContainerElement(text, elementsMap);
  if (
    !container ||
    !isPfShape(container) ||
    !(text.originalText || text.text).trim()
  ) {
    return null;
  }
  const fitted = fitPfShapeWithText(container, text, elementsMap, {
    allowShrink: true,
  });
  if (!fitted.text || fitted.shape === container) {
    return null;
  }
  return { shape: fitted.shape, text: fitted.text };
};
