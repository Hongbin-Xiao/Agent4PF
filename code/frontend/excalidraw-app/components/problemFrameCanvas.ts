import {
  newArrowElement,
  newElement,
  newLinearElement,
  newTextElement,
} from "@excalidraw/excalidraw/element";
import { fitPfShapeWithText } from "@excalidraw/excalidraw/element/pfTextLayout";
import {
  getBoundTextElement,
  redrawTextBoundingBox,
} from "@excalidraw/excalidraw/element/textElement";
import { measureText } from "@excalidraw/excalidraw/element/textMeasurements";
import { newElementWith } from "@excalidraw/excalidraw";
import { isPfRelationLink } from "@excalidraw/excalidraw/actions/actionPfSharedPhenomena";
import { arrayToMap, getFontString } from "@excalidraw/excalidraw/utils";
import { pointFrom } from "@excalidraw/math";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type ProblemDomainType =
  | "machine"
  | "causal"
  | "biddable"
  | "lexical"
  | "given"
  | "design";

export type ProblemDomain = {
  id: string;
  name: string;
  type: ProblemDomainType;
  rationale: string;
};

export type DomainProposal = {
  proposalId: string;
  summary: string;
  machine: Omit<ProblemDomain, "type">;
  domains: ProblemDomain[];
};

export type SharedPhenomenaInterface = {
  id: string;
  sourceDomainId: string;
  targetDomainId: string;
  sourcePhenomena: string[];
  targetPhenomena: string[];
  evidence: string;
};

export type SharedPhenomenaProposal = {
  proposalId: string;
  summary: string;
  interfaces: SharedPhenomenaInterface[];
};

/**
 * 需求对领域的两种引用：引用（无箭头虚线）与约束（带三角箭头虚线）。
 * 约束箭头指向被约束的领域，因此起点固定为需求、终点固定为领域。
 */
export type PfRequirementRelationType = "reference" | "constraint";

export type RequirementRelation = {
  id: string;
  type: PfRequirementRelationType;
  requirementId: string;
  requirementText: string;
  domainId: string;
  rationale: string;
};

export type RequirementRelationProposal = {
  proposalId: string;
  summary: string;
  relations: RequirementRelation[];
};

/** 画布上的需求图形尺寸，与领域图形保持同一网格节奏。 */
const REQUIREMENT_WIDTH = 240;
const REQUIREMENT_HEIGHT = 96;
const REQUIREMENT_MAX_WIDTH = 320;
const REQUIREMENT_SHAPE_GAP = 56;

/** 候选阶段统一用紫色；确认后引用与约束都变成黑色虚线，仅靠箭头区分。 */
const PF_REQUIREMENT_LINK_COLOR = "#1b1b1f";

const isRequirementRelationType = (
  value: unknown,
): value is PfRequirementRelationType =>
  value === "reference" || value === "constraint";

export const isRequirementShape = (element: ExcalidrawElement): boolean =>
  element.type === "pf-requirement" ||
  Boolean(element.customData?.pfRequirementId);

type DomainElementType =
  | "pf-machine"
  | "pf-design"
  | "pf-given"
  | "pf-causal"
  | "pf-biddable"
  | "pf-lexical";

const elementTypeByDomain: Record<ProblemDomainType, DomainElementType> = {
  machine: "pf-machine",
  causal: "pf-causal",
  biddable: "pf-biddable",
  lexical: "pf-lexical",
  given: "pf-given",
  design: "pf-design",
};

const isProposalElement = (element: ExcalidrawElement, proposalId: string) =>
  element.customData?.pfAiProposalId === proposalId;

/** 领域图形与需求图形的正文居中计算需要按 id 查找元素。 */
const toElementsMap = (elements: readonly ExcalidrawElement[]) =>
  new Map(elements.map((element) => [element.id, element])) as ElementsMap;

const boundTextOf = (
  shape: ExcalidrawElement,
  elements: readonly ExcalidrawElement[],
  map: ElementsMap = toElementsMap(elements),
) => getBoundTextElement(shape, map) as ExcalidrawTextElement | null;

const getDomainShape = (
  elements: readonly ExcalidrawElement[],
  semanticId: string,
) =>
  elements.find(
    (element) =>
      element.type !== "text" &&
      element.customData?.pfSemanticId === semanticId &&
      element.customData?.pfAiStatus === "confirmed",
  );

const boundaryPoint = (
  element: ExcalidrawElement,
  towardX: number,
  towardY: number,
) => {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const dx = towardX - centerX;
  const dy = towardY - centerY;
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? element.width / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.001 ? element.height / 2 / Math.abs(dy) : Infinity,
  );
  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
  };
};

const interfaceLabel = (
  item: SharedPhenomenaInterface,
  sourceName: string,
  targetName: string,
) => {
  const lines: string[] = [];
  if (item.sourcePhenomena.length) {
    lines.push(`${sourceName}!{${item.sourcePhenomena.join(",")}}`);
  }
  if (item.targetPhenomena.length) {
    lines.push(`${targetName}!{${item.targetPhenomena.join(",")}}`);
  }
  return lines.join("\n");
};

export const renderDomainProposal = (
  api: ExcalidrawImperativeAPI,
  proposal: DomainProposal,
  status: "proposed" | "confirmed",
) => {
  const allElements = api.getSceneElementsIncludingDeleted();
  const appState = api.getAppState();
  const zoom = appState.zoom.value || 1;
  const centerX = -appState.scrollX + appState.width / zoom / 2;
  const topY = -appState.scrollY + 130 / zoom;
  const items: ProblemDomain[] = [
    { ...proposal.machine, type: "machine" },
    ...proposal.domains,
  ];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const obsoleteProposalIds = new Set(
    allElements
      .filter(
        (element) =>
          isProposalElement(element, proposal.proposalId) &&
          !itemById.has(String(element.customData?.pfSemanticId || "")),
      )
      .map((element) => element.id),
  );
  const created: ExcalidrawElement[] = [];
  const shapeUpdates = new Map<string, ExcalidrawElement>();
  const textUpdates = new Map<string, ExcalidrawElement>();
  let existing: ExcalidrawElement[] = allElements.filter(
    (element) => !obsoleteProposalIds.has(element.id),
  );
  const confirmedShapes = existing.filter(
    (element) =>
      element.type !== "text" &&
      element.customData?.pfSemanticId &&
      element.customData?.pfAiStatus === "confirmed",
  );
  const shapeFor = (semanticId: string) =>
    existing.find(
      (element) =>
        element.type !== "text" &&
        element.customData?.pfSemanticId === semanticId &&
        (isProposalElement(element, proposal.proposalId) ||
          element.customData?.pfAiStatus === "confirmed"),
    );
  const missingItems = items.filter((item) => !shapeFor(item.id));
  const columns = Math.min(3, Math.max(1, missingItems.length));
  const shapeWidth = 180;
  const shapeHeight = 92;
  const gapX = 48;
  const gapY = 72;
  const totalWidth = columns * shapeWidth + (columns - 1) * gapX;
  const existingRight = confirmedShapes.length
    ? Math.max(...confirmedShapes.map((element) => element.x + element.width))
    : undefined;
  const startX =
    existingRight === undefined
      ? centerX - totalWidth / 2
      : existingRight + gapX;

  missingItems.forEach((domain, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (shapeWidth + gapX);
    const y = topY + row * (shapeHeight + gapY);
    const commonCustomData = {
      pfAiProposalId: proposal.proposalId,
      pfSemanticId: domain.id,
      pfDomainType: domain.type,
      pfAiStatus: status,
      pfRationale: domain.rationale,
      pfName: domain.name,
    };
    const shape = newElement({
      type: elementTypeByDomain[domain.type],
      x,
      y,
      width: shapeWidth,
      height: shapeHeight,
      strokeColor: status === "proposed" ? "#7950f2" : "#1b1b1f",
      backgroundColor: status === "proposed" ? "#f3f0ff" : "transparent",
      fillStyle: "solid",
      strokeStyle: status === "proposed" ? "dashed" : "solid",
      opacity: status === "proposed" ? 72 : 100,
      customData: commonCustomData,
    });
    const text = newTextElement({
      text: domain.name,
      x: x + shapeWidth / 2,
      y: y + shapeHeight / 2,
      fontSize: 20,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: shape.id,
      strokeColor: "#1b1b1f",
      opacity: status === "proposed" ? 82 : 100,
      customData: commonCustomData,
    });
    created.push(
      newElementWith(shape, {
        boundElements: [{ id: text.id, type: "text" }],
      }),
      text,
    );
  });

  // 新建领域先按正文换行、再缩放到刚好装下正文，避免正文溢出边框。
  if (created.length) {
    const sceneWithCreated = [...existing, ...created];
    const createdMap = toElementsMap(sceneWithCreated);
    created.forEach((element, index) => {
      if (element.type === "text") {
        return;
      }
      const label = boundTextOf(element, sceneWithCreated, createdMap);
      if (!label) {
        return;
      }
      const fitted = fitPfShapeWithText(element, label, createdMap);
      if (fitted.shape === element && fitted.text === label) {
        return;
      }
      created[index] = fitted.shape;
      const labelIndex = created.findIndex((item) => item.id === label.id);
      if (labelIndex >= 0 && fitted.text) {
        created[labelIndex] = fitted.text;
      }
      createdMap.set(fitted.shape.id, fitted.shape);
      if (fitted.text) {
        createdMap.set(fitted.text.id, fitted.text);
      }
    });
  }

  existing = existing.map((element) => {
    const semanticId = String(element.customData?.pfSemanticId || "");
    const domain = itemById.get(semanticId);
    const belongsToCurrentProposal = isProposalElement(
      element,
      proposal.proposalId,
    );
    const shouldUpdateConfirmed =
      status === "confirmed" && element.customData?.pfAiStatus === "confirmed";
    if (!domain || (!belongsToCurrentProposal && !shouldUpdateConfirmed)) {
      return element;
    }
    const commonCustomData = {
      ...element.customData,
      pfAiProposalId: proposal.proposalId,
      pfSemanticId: domain.id,
      pfDomainType: domain.type,
      pfAiStatus: status,
      pfRationale: domain.rationale,
      pfName: domain.name,
    };
    if (element.type === "text") {
      const renamed =
        element.text === domain.name
          ? element
          : newElementWith(element, {
              text: domain.name,
              originalText: domain.name,
              opacity: status === "proposed" ? 82 : 100,
              customData: commonCustomData,
            });
      textUpdates.set(element.id, renamed);
      return renamed;
    }
    const updated = newElementWith(element, {
      strokeColor: status === "proposed" ? "#7950f2" : "#1b1b1f",
      backgroundColor: status === "proposed" ? "#f3f0ff" : "transparent",
      strokeStyle: status === "proposed" ? "dashed" : "solid",
      opacity: status === "proposed" ? 72 : 100,
      customData: {
        ...commonCustomData,
      },
    });
    const nextShape = {
      ...updated,
      type: elementTypeByDomain[domain.type],
    } as unknown as ExcalidrawElement;
    shapeUpdates.set(element.id, nextShape);
    return nextShape;
  });

  // 名称变化后重新排版正文：正文变长就放大图形，变短则回收多余空间。
  const renamedShapes = existing.filter((element) =>
    shapeUpdates.has(element.id),
  );
  if (renamedShapes.length) {
    const sceneWithCreated = [...existing, ...created];
    const sceneMap = toElementsMap(sceneWithCreated);
    renamedShapes.forEach((shape) => {
      const label = boundTextOf(shape, sceneWithCreated, sceneMap);
      if (!label) {
        return;
      }
      // 只在提案带来新名称、且与用户当前正文不一致时才重排，保留手动尺寸。
      const nextName = String(shape.customData?.pfName ?? "").trim();
      if (!nextName || label.text.trim() === nextName) {
        return;
      }
      const fitted = fitPfShapeWithText(shape, label, sceneMap, {
        allowShrink: true,
      });
      if (fitted.shape !== shape) {
        shapeUpdates.set(shape.id, fitted.shape);
        sceneMap.set(fitted.shape.id, fitted.shape);
      }
      if (fitted.text && fitted.text !== label) {
        textUpdates.set(label.id, fitted.text);
        sceneMap.set(fitted.text.id, fitted.text);
      }
    });
  }
  existing = existing.map(
    (element) =>
      textUpdates.get(element.id) ?? shapeUpdates.get(element.id) ?? element,
  );

  api.updateScene({ elements: [...existing, ...created] });
  if (created.length) {
    api.scrollToContent(created, { animate: true, fitToContent: true });
  }
};

export const highlightProblemDomain = (
  api: ExcalidrawImperativeAPI,
  proposalId: string,
  semanticId: string,
) => {
  const matches = api
    .getSceneElements()
    .filter(
      (element) =>
        isProposalElement(element, proposalId) &&
        element.customData?.pfSemanticId === semanticId,
    );
  if (!matches.length) {
    return;
  }
  api.updateScene({
    appState: {
      selectedElementIds: Object.fromEntries(
        matches.map((element) => [element.id, true]),
      ),
    },
  });
  api.scrollToContent(matches, { animate: true, fitToContent: true });
};

export const renderSharedPhenomenaProposal = (
  api: ExcalidrawImperativeAPI,
  proposal: SharedPhenomenaProposal,
  status: "proposed" | "confirmed",
) => {
  const allElements = api.getSceneElementsIncludingDeleted();
  const interfaceIds = new Set(proposal.interfaces.map((item) => item.id));
  const removedProposalIds = new Set(
    allElements
      .filter(
        (element) =>
          isProposalElement(element, proposal.proposalId) &&
          element.customData?.pfSharedInterfaceId &&
          !interfaceIds.has(String(element.customData.pfSharedInterfaceId)),
      )
      .map((element) => element.id),
  );
  let existing = allElements.filter(
    (element) => !removedProposalIds.has(element.id),
  );
  const created: ExcalidrawElement[] = [];
  const lineIdsByDomain = new Map<string, string[]>();
  const lineUpdates = new Map<string, typeof existing[number]>();
  const labelUpdates = new Map<string, typeof existing[number]>();

  proposal.interfaces.forEach((item) => {
    const source = getDomainShape(existing, item.sourceDomainId);
    const target = getDomainShape(existing, item.targetDomainId);
    if (!source || !target || source.id === target.id) {
      return;
    }
    const sourceCenter = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const targetCenter = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };
    const start = boundaryPoint(source, targetCenter.x, targetCenter.y);
    const end = boundaryPoint(target, sourceCenter.x, sourceCenter.y);
    const sharedPhenomena = {
      displayMode: "detailed" as const,
      compactCode: "",
      sourcePhenomena: item.sourcePhenomena,
      targetPhenomena: item.targetPhenomena,
      labelWidth: 240,
      fontColor: status === "proposed" ? "#6741d9" : "#1e1e1e",
      backgroundColor: "transparent",
    };
    const customData = {
      pfAiProposalId: proposal.proposalId,
      pfAiStatus: status,
      pfSharedInterfaceId: item.id,
      pfEvidence: item.evidence,
      pfSharedPhenomena: sharedPhenomena,
    };
    const currentLine = existing.find(
      (element) =>
        element.type === "line" &&
        element.customData?.pfSharedInterfaceId === item.id &&
        (isProposalElement(element, proposal.proposalId) ||
          element.customData?.pfAiStatus === "confirmed"),
    ) as ExcalidrawLinearElement | undefined;
    const shouldUpdateLine =
      currentLine &&
      (isProposalElement(currentLine, proposal.proposalId) ||
        status === "confirmed");
    const line = currentLine
      ? shouldUpdateLine
        ? newElementWith(currentLine, {
            startBinding: { elementId: source.id, focus: 0, gap: 1 },
            endBinding: { elementId: target.id, focus: 0, gap: 1 },
            strokeColor: status === "proposed" ? "#7950f2" : "#1b1b1f",
            strokeStyle: status === "proposed" ? "dashed" : "solid",
            opacity: status === "proposed" ? 72 : 100,
            customData: {
              ...currentLine.customData,
              ...customData,
            },
          })
        : currentLine
      : newLinearElement({
          type: "line",
          x: start.x,
          y: start.y,
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
          points: [
            pointFrom(0, 0),
            pointFrom(end.x - start.x, end.y - start.y),
          ],
          strokeColor: status === "proposed" ? "#7950f2" : "#1b1b1f",
          strokeStyle: status === "proposed" ? "dashed" : "solid",
          opacity: status === "proposed" ? 72 : 100,
          roughness: 0,
          customData,
        });
    const labelText = interfaceLabel(
      item,
      String(source.customData?.pfName || item.sourceDomainId),
      String(target.customData?.pfName || item.targetDomainId),
    );
    const currentLabel = existing.find(
      (element) => element.type === "text" && element.containerId === line.id,
    ) as ExcalidrawTextElement | undefined;
    const baseLabel = currentLabel
      ? newElementWith(currentLabel, {
          text: labelText,
          originalText: labelText,
          strokeColor: status === "proposed" ? "#6741d9" : "#1e1e1e",
          opacity: status === "proposed" ? 82 : 100,
          customData: {
            ...currentLabel.customData,
            ...customData,
            pfSharedPhenomenaLabel: true,
            pfSharedPhenomenaLabelWidth: sharedPhenomena.labelWidth,
          },
        })
      : newTextElement({
          text: labelText,
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
          fontSize: 16,
          textAlign: "center",
          verticalAlign: "middle",
          containerId: line.id,
          strokeColor: status === "proposed" ? "#6741d9" : "#1e1e1e",
          backgroundColor: "#ffffff",
          opacity: status === "proposed" ? 82 : 100,
          customData: {
            ...customData,
            pfSharedPhenomenaLabel: true,
            pfSharedPhenomenaLabelWidth: sharedPhenomena.labelWidth,
          },
        });
    const naturalLabelWidth = Math.max(
      80,
      Math.ceil(
        measureText(labelText, getFontString(baseLabel), baseLabel.lineHeight)
          .width,
      ),
    );
    const autoSizedCustomData = {
      ...customData,
      pfSharedPhenomena: {
        ...sharedPhenomena,
        labelWidth: naturalLabelWidth,
      },
    };
    const label = newElementWith(baseLabel, {
      customData: {
        ...baseLabel.customData,
        ...autoSizedCustomData,
        pfSharedPhenomenaLabel: true,
        pfSharedPhenomenaLabelWidth: naturalLabelWidth,
      },
    });
    const boundLine = newElementWith(line, {
      startBinding: { elementId: source.id, focus: 0, gap: 1 },
      endBinding: { elementId: target.id, focus: 0, gap: 1 },
      boundElements: [{ id: label.id, type: "text" }],
      customData: {
        ...line.customData,
        ...autoSizedCustomData,
      },
    });
    const labelLayoutMap = arrayToMap([
      ...existing.filter(
        (element) => element.id !== boundLine.id && element.id !== label.id,
      ),
      ...created.filter(
        (element) => element.id !== boundLine.id && element.id !== label.id,
      ),
      boundLine,
      label,
    ]);
    redrawTextBoundingBox(label, boundLine, labelLayoutMap, false);
    if (currentLine) {
      lineUpdates.set(currentLine.id, boundLine as typeof existing[number]);
      if (currentLabel) {
        labelUpdates.set(currentLabel.id, label as typeof existing[number]);
      } else {
        created.push(label);
      }
    } else {
      created.push(boundLine, label);
    }
    lineIdsByDomain.set(item.sourceDomainId, [
      ...(lineIdsByDomain.get(item.sourceDomainId) || []),
      line.id,
    ]);
    lineIdsByDomain.set(item.targetDomainId, [
      ...(lineIdsByDomain.get(item.targetDomainId) || []),
      line.id,
    ]);
  });

  existing = existing.map((element) => {
    const lineUpdate = lineUpdates.get(element.id);
    if (lineUpdate) {
      return lineUpdate;
    }
    const labelUpdate = labelUpdates.get(element.id);
    if (labelUpdate) {
      return labelUpdate;
    }
    const semanticId = element.customData?.pfSemanticId;
    const lineIds = semanticId
      ? lineIdsByDomain.get(String(semanticId))
      : undefined;
    if (!lineIds || element.type === "text") {
      return element;
    }
    return newElementWith(element, {
      boundElements: [
        // 只回收本提案要重画的共享现象线，保留用户手绘的普通连线与需求引用/约束虚线。
        ...(element.boundElements || []).filter(
          (binding) =>
            !removedProposalIds.has(binding.id) &&
            !created.some((item) => item.id === binding.id) &&
            !existing.some(
              (item) => item.id === binding.id && isPfRelationLink(item),
            ),
        ),
        ...lineIds.map((id) => ({ id, type: "arrow" as const })),
      ],
    });
  });
  api.updateScene({ elements: [...existing, ...created] });
};

export const highlightSharedPhenomena = (
  api: ExcalidrawImperativeAPI,
  proposalId: string,
  interfaceId: string,
) => {
  const matches = api
    .getSceneElements()
    .filter(
      (element) =>
        isProposalElement(element, proposalId) &&
        element.customData?.pfSharedInterfaceId === interfaceId,
    );
  if (!matches.length) {
    return;
  }
  api.updateScene({
    appState: {
      selectedElementIds: Object.fromEntries(
        matches.map((element) => [element.id, true]),
      ),
    },
  });
};

/** 需求图形按语义 id 复用，用户手动创建并命名的需求也会被接续使用。 */
const getRequirementShape = (
  elements: readonly ExcalidrawElement[],
  semanticId: string,
) =>
  elements.find(
    (element) =>
      isRequirementShape(element) &&
      (element.customData?.pfRequirementId === semanticId ||
        element.customData?.pfSemanticId === semanticId),
  );

/**
 * 新需求排成一列放在现有图形左侧，避开宽领域之间的空隙被误判成空位。
 * 已经存在的需求保持用户位置不动，新需求接在需求列末尾。
 */
const requirementLayout = (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
  count: number,
) => {
  const appState = api.getAppState();
  const zoom = appState.zoom?.value || 1;
  const viewportLeft = -(appState.scrollX ?? 0) + 40 / zoom;
  const occupied = elements.filter(
    (element) => element.type !== "text" && !isRequirementShape(element),
  );
  const left = occupied.length
    ? Math.min(
        viewportLeft,
        Math.min(...occupied.map((element) => element.x)) -
          REQUIREMENT_WIDTH -
          REQUIREMENT_SHAPE_GAP,
      )
    : viewportLeft;
  const column = elements.filter(
    (element): element is ExcalidrawElement =>
      element.type !== "text" &&
      isRequirementShape(element) &&
      Math.abs(element.x - left) < REQUIREMENT_WIDTH,
  );
  const startY = column.length
    ? Math.max(...column.map((element) => element.y + element.height)) +
      REQUIREMENT_SHAPE_GAP
    : occupied.length
    ? Math.min(...occupied.map((element) => element.y))
    : -(appState.scrollY ?? 0) + 130 / zoom;
  return Array.from({ length: count }, (_, index) => ({
    x: left,
    y: startY + index * (REQUIREMENT_HEIGHT + REQUIREMENT_SHAPE_GAP),
  }));
};

/**
 * 把“需求”引用/约束到涉及的领域上，构成问题图。
 * 引用为无箭头虚线，约束为指向被约束领域的三角箭头虚线；两者端点均绑定到图形上。
 */
export const renderRequirementRelationProposal = (
  api: ExcalidrawImperativeAPI,
  proposal: RequirementRelationProposal,
  status: "proposed" | "confirmed",
) => {
  const allElements = api.getSceneElementsIncludingDeleted();
  const relationIds = new Set(proposal.relations.map((item) => item.id));
  const requirementIds = new Set(
    proposal.relations.map((item) => item.requirementId),
  );
  // 本次提案不再包含的连线与需求需要一并清理，避免留下悬空虚线。
  const removedProposalIds = new Set(
    allElements
      .filter((element) => {
        if (!isProposalElement(element, proposal.proposalId)) {
          return false;
        }
        if (element.customData?.pfRequirementRelationId) {
          return !relationIds.has(
            String(element.customData.pfRequirementRelationId),
          );
        }
        if (element.customData?.pfRequirementId && element.type !== "text") {
          return !requirementIds.has(
            String(element.customData.pfRequirementId),
          );
        }
        return false;
      })
      .map((element) => element.id),
  );
  let existing: ExcalidrawElement[] = allElements.filter(
    (element) => !removedProposalIds.has(element.id),
  );
  const created: ExcalidrawElement[] = [];
  const shapeUpdates = new Map<string, ExcalidrawElement>();
  const linkUpdates = new Map<string, ExcalidrawElement>();
  const linkIdsByShape = new Map<string, string[]>();

  // 1. 先复用画布上已有的需求，缺少的按列排布补建。
  // 需求正文以 relations 中首次出现的写法为准，一个需求只对应一个图形。
  const requirementTextById: Record<string, string> = {};
  const missingRequirementIds: string[] = [];
  proposal.relations.forEach((item) => {
    const requirementId = String(item.requirementId);
    const known = requirementId in requirementTextById;
    if (!known) {
      requirementTextById[requirementId] = item.requirementText;
    }
    if (known || getRequirementShape(existing, requirementId)) {
      return;
    }
    missingRequirementIds.push(requirementId);
  });
  const layouts = requirementLayout(
    api,
    existing,
    missingRequirementIds.length,
  );
  const createdByRequirement: Record<string, ExcalidrawElement> = {};

  // 缺少的需求按列补建，每个需求只建一次。
  missingRequirementIds.forEach((requirementId, index) => {
    const position = layouts[index];
    if (!position) {
      return;
    }
    const customData = {
      pfAiProposalId: proposal.proposalId,
      pfAiStatus: status,
      pfRequirementId: requirementId,
      pfName: requirementTextById[requirementId],
    };
    const shape = newElement({
      type: "pf-requirement",
      x: position.x,
      y: position.y,
      width: REQUIREMENT_WIDTH,
      height: REQUIREMENT_HEIGHT,
      strokeColor: status === "proposed" ? "#7950f2" : "#1b1b1f",
      backgroundColor: status === "proposed" ? "#f3f0ff" : "transparent",
      fillStyle: "solid",
      // 需求是问题框架中的虚线椭圆，与实线领域图形区分。
      strokeStyle: "dashed",
      opacity: status === "proposed" ? 72 : 100,
      customData,
    });
    const label = newTextElement({
      text: requirementTextById[requirementId],
      x: position.x + REQUIREMENT_WIDTH / 2,
      y: position.y + REQUIREMENT_HEIGHT / 2,
      fontSize: 18,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: shape.id,
      strokeColor: "#1b1b1f",
      opacity: status === "proposed" ? 82 : 100,
      customData: { ...customData, pfRequirementLabel: true },
    });
    const createdShape = newElementWith(shape, {
      boundElements: [{ id: label.id, type: "text" }],
    });
    createdByRequirement[requirementId] = createdShape;
    created.push(createdShape, label);
  });

  // 需求椭圆保持适中的宽度；绑定文本会由 Excalidraw 原生逻辑自动换行，
  // 这里只根据换行后的高度增加椭圆高度，避免把长需求拉成一行超宽图形。
  if (created.length) {
    const sceneWithCreated = [...existing, ...created];
    const createdMap = toElementsMap(sceneWithCreated);
    created.forEach((element, index) => {
      if (element.type === "text") {
        return;
      }
      const label = boundTextOf(element, sceneWithCreated, createdMap);
      if (!label) {
        return;
      }
      const fitted = fitPfShapeWithText(element, label, createdMap, {
        maxWidth: REQUIREMENT_MAX_WIDTH,
      });
      if (fitted.shape === element && fitted.text === label) {
        return;
      }
      created[index] = fitted.shape;
      const labelIndex = created.findIndex((item) => item.id === label.id);
      if (labelIndex >= 0 && fitted.text) {
        created[labelIndex] = fitted.text;
      }
      createdMap.set(fitted.shape.id, fitted.shape);
      if (fitted.text) {
        createdMap.set(fitted.text.id, fitted.text);
      }
      const requirementId = String(fitted.shape.customData?.pfRequirementId);
      if (createdByRequirement[requirementId]?.id === element.id) {
        createdByRequirement[requirementId] = fitted.shape;
      }
    });
  }

  // 已有需求按提案更新名称与样式；正文变化时重新排版。
  const requirementTextUpdates = new Map<string, ExcalidrawElement>();
  Object.keys(requirementTextById).forEach((requirementId) => {
    const shape =
      createdByRequirement[requirementId] ??
      getRequirementShape(existing, requirementId);
    if (!shape) {
      return;
    }
    if (
      isProposalElement(shape, proposal.proposalId) ||
      status === "confirmed"
    ) {
      const updated = newElementWith(shape, {
        strokeColor: status === "proposed" ? "#7950f2" : "#1b1b1f",
        backgroundColor: status === "proposed" ? "#f3f0ff" : "transparent",
        // 需求始终是虚线椭圆，确认后也只改颜色。
        strokeStyle: "dashed",
        opacity: status === "proposed" ? 72 : 100,
        customData: {
          ...shape.customData,
          pfAiProposalId: proposal.proposalId,
          pfAiStatus: status,
          pfRequirementId: requirementId,
          pfName: requirementTextById[requirementId],
        },
      });
      createdByRequirement[requirementId] = updated;
      if (!created.some((element) => element.id === shape.id)) {
        shapeUpdates.set(shape.id, updated);
      }
    }
  });

  // 提案改了需求正文：重新换行并调整椭圆大小，避免正文溢出虚线边框。
  const sceneWithCreated = [...existing, ...created];
  const sceneMap = toElementsMap(sceneWithCreated);
  Object.keys(requirementTextById).forEach((requirementId) => {
    const shape = createdByRequirement[requirementId];
    if (!shape || created.some((element) => element.id === shape.id)) {
      return;
    }
    const label = boundTextOf(shape, sceneWithCreated, sceneMap);
    if (!label) {
      return;
    }
    const nextText = requirementTextById[requirementId].trim();
    // label.text 可能已经是画布根据宽度生成的换行版本；只要 originalText
    // 没变，就说明用户没有改需求正文，也不应在确认时覆盖手动尺寸。
    if (!nextText || label.originalText.trim() === nextText) {
      return;
    }
    const updatedLabel = newElementWith(label, {
      text: nextText,
      originalText: nextText,
      customData: {
        ...label.customData,
        pfName: nextText,
      },
    });
    sceneMap.set(updatedLabel.id, updatedLabel);
    const fitted = fitPfShapeWithText(shape, updatedLabel, sceneMap, {
      allowShrink: true,
      maxWidth: REQUIREMENT_MAX_WIDTH,
    });
    if (fitted.shape !== shape) {
      createdByRequirement[requirementId] = fitted.shape;
      shapeUpdates.set(fitted.shape.id, fitted.shape);
      sceneMap.set(fitted.shape.id, fitted.shape);
    }
    if (fitted.text) {
      requirementTextUpdates.set(label.id, fitted.text);
      sceneMap.set(fitted.text.id, fitted.text);
    }
  });

  // 2. 需求与领域之间按语义 id 连线：端点绑定让图形移动时虚线跟随。
  proposal.relations.forEach((item) => {
    if (!isRequirementRelationType(item.type)) {
      return;
    }
    const requirementShape =
      createdByRequirement[String(item.requirementId)] ??
      getRequirementShape(existing, String(item.requirementId));
    const domainShape = getDomainShape(existing, item.domainId);
    if (
      !requirementShape ||
      !domainShape ||
      requirementShape.id === domainShape.id
    ) {
      return;
    }
    const requirement = requirementShape;
    if (requirement.type === "text" || domainShape.type === "text") {
      return;
    }
    const requirementCenter = {
      x: requirement.x + requirement.width / 2,
      y: requirement.y + requirement.height / 2,
    };
    const domainCenter = {
      x: domainShape.x + domainShape.width / 2,
      y: domainShape.y + domainShape.height / 2,
    };
    const start = boundaryPoint(requirement, domainCenter.x, domainCenter.y);
    const end = boundaryPoint(
      domainShape,
      requirementCenter.x,
      requirementCenter.y,
    );
    const customData = {
      pfAiProposalId: proposal.proposalId,
      pfAiStatus: status,
      pfRequirementRelationId: item.id,
      pfRequirementRelationType: item.type,
      pfRequirementId: item.requirementId,
      pfSemanticId: item.domainId,
      pfRationale: item.rationale,
    };
    const currentLink = existing.find(
      (element) =>
        element.type === "arrow" &&
        element.customData?.pfRequirementRelationId === item.id &&
        (isProposalElement(element, proposal.proposalId) ||
          element.customData?.pfAiStatus === "confirmed"),
    ) as ExcalidrawLinearElement | undefined;
    const shouldUpdateLink =
      currentLink &&
      (isProposalElement(currentLink, proposal.proposalId) ||
        status === "confirmed");
    const link = currentLink
      ? shouldUpdateLink
        ? newElementWith(currentLink, {
            startBinding: { elementId: requirement.id, focus: 0, gap: 1 },
            endBinding: { elementId: domainShape.id, focus: 0, gap: 1 },
            strokeColor:
              status === "proposed" ? "#7950f2" : PF_REQUIREMENT_LINK_COLOR,
            strokeStyle: "dashed" as const,
            // 引用无箭头；约束使用三角箭头并指向被约束的领域。
            startArrowhead: null,
            endArrowhead: item.type === "constraint" ? "triangle" : null,
            opacity: status === "proposed" ? 72 : 100,
            customData: { ...currentLink.customData, ...customData },
          })
        : currentLink
      : newArrowElement({
          type: "arrow",
          x: start.x,
          y: start.y,
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
          points: [
            pointFrom(0, 0),
            pointFrom(end.x - start.x, end.y - start.y),
          ],
          strokeColor:
            status === "proposed" ? "#7950f2" : PF_REQUIREMENT_LINK_COLOR,
          strokeStyle: "dashed",
          startArrowhead: null,
          endArrowhead: item.type === "constraint" ? "triangle" : null,
          opacity: status === "proposed" ? 72 : 100,
          roughness: 0,
          customData,
        });
    const boundLink = newElementWith(link, {
      startBinding: { elementId: requirement.id, focus: 0, gap: 1 },
      endBinding: { elementId: domainShape.id, focus: 0, gap: 1 },
    });
    if (!currentLink) {
      created.push(boundLink);
    } else {
      // 已有连线只在提案内改样式（颜色、箭头），必须替换回画布。
      linkUpdates.set(boundLink.id, boundLink);
    }
    linkIdsByShape.set(requirement.id, [
      ...(linkIdsByShape.get(requirement.id) || []),
      link.id,
    ]);
    linkIdsByShape.set(domainShape.id, [
      ...(linkIdsByShape.get(domainShape.id) || []),
      link.id,
    ]);
  });

  // 3. 图形记下自己承载的连线，删除图形时才能一并清理虚线。
  //    刚创建的需求图形已带上 boundElements 的文本绑定，这里只追加连线并保留文本。
  const boundElementsOf = (shape: ExcalidrawElement) =>
    shape.type === "text" ? null : shape.boundElements;
  linkIdsByShape.forEach((ids, shapeId) => {
    const shape =
      created.find((item) => item.id === shapeId) ??
      shapeUpdates.get(shapeId) ??
      existing.find((item) => item.id === shapeId);
    if (!shape || shape.type === "text") {
      return;
    }
    linkUpdates.set(
      shapeId,
      newElementWith(shape, {
        boundElements: [
          ...(boundElementsOf(shape) || []).filter(
            (binding) =>
              !removedProposalIds.has(binding.id) &&
              !created.some((item) => item.id === binding.id) &&
              !ids.includes(binding.id),
          ),
          ...ids.map((id) => ({ id, type: "arrow" as const })),
        ],
      }),
    );
  });

  existing = existing.map(
    (element) =>
      requirementTextUpdates.get(element.id) ??
      linkUpdates.get(element.id) ??
      shapeUpdates.get(element.id) ??
      element,
  );
  api.updateScene({
    elements: [...existing, ...created] as ExcalidrawElement[],
  });
};

export const highlightRequirementRelation = (
  api: ExcalidrawImperativeAPI,
  proposalId: string,
  relationId: string,
) => {
  const matches = api
    .getSceneElements()
    .filter(
      (element) =>
        isProposalElement(element, proposalId) &&
        element.customData?.pfRequirementRelationId === relationId,
    );
  if (!matches.length) {
    return;
  }
  api.updateScene({
    appState: {
      selectedElementIds: Object.fromEntries(
        matches.map((element) => [element.id, true]),
      ),
    },
  });
  api.scrollToContent(matches, { animate: true, fitToContent: true });
};

export const repairLegacyProblemFrameConnections = (
  api: ExcalidrawImperativeAPI,
) => {
  const elements = api.getSceneElementsIncludingDeleted();
  let changed = false;
  const repaired = elements.map((element) => {
    if (
      (element.type === "line" || element.type === "arrow") &&
      isPfRelationLink(element) &&
      element.points.length > 1 &&
      (element.points[0][0] !== 0 || element.points[0][1] !== 0)
    ) {
      const [offsetX, offsetY] = element.points[0];
      changed = true;
      return newElementWith(element, {
        x: element.x + offsetX,
        y: element.y + offsetY,
        points: element.points.map((point) =>
          pointFrom(point[0] - offsetX, point[1] - offsetY),
        ),
      });
    }
    if (element.type === "text" && element.customData?.pfSharedPhenomenaLabel) {
      const position = element.customData.pfSharedPhenomenaLabelPosition as
        | { positionRatio?: number; normalOffset?: number }
        | undefined;
      if (
        position?.positionRatio === 0.5 &&
        Math.abs(position.normalOffset || 0) === 22
      ) {
        const customData = { ...element.customData };
        delete customData.pfSharedPhenomenaLabelPosition;
        changed = true;
        return newElementWith(element, { customData });
      }
    }
    return element;
  });
  if (changed) {
    api.updateScene({ elements: repaired });
  }
};

export const summarizeProblemFrameScene = (api: ExcalidrawImperativeAPI) => {
  const elements = api.getSceneElements();
  return {
    domains: elements
      .filter(
        (element) =>
          element.type !== "text" &&
          !isRequirementShape(element) &&
          Boolean(element.customData?.pfSemanticId),
      )
      .map((element) => ({
        elementId: element.id,
        semanticId: element.customData?.pfSemanticId,
        name: element.customData?.pfName,
        rationale: element.customData?.pfRationale,
        domainType: element.customData?.pfDomainType,
        status: element.customData?.pfAiStatus,
        position: { x: element.x, y: element.y },
      })),
    interfaces: elements
      .filter(
        (element) =>
          element.type === "line" &&
          Boolean(element.customData?.pfSharedInterfaceId),
      )
      .map((element) => ({
        elementId: element.id,
        interfaceId: element.customData?.pfSharedInterfaceId,
        status: element.customData?.pfAiStatus,
        phenomena: element.customData?.pfSharedPhenomena,
      })),
    // 需求图形由需求正文与它引用/约束的领域共同定义，两者都要交给模型复用。
    requirements: elements
      .filter(
        (element) =>
          element.type === "pf-requirement" &&
          !element.isDeleted &&
          Boolean(element.customData?.pfRequirementId),
      )
      .map((element) => ({
        elementId: element.id,
        requirementId: element.customData?.pfRequirementId,
        text: element.customData?.pfName,
        status: element.customData?.pfAiStatus,
        position: { x: element.x, y: element.y },
      })),
    requirementRelations: elements
      .filter(
        (element) =>
          element.type === "arrow" &&
          Boolean(element.customData?.pfRequirementRelationId) &&
          !element.isDeleted,
      )
      .map((element) => ({
        elementId: element.id,
        relationId: element.customData?.pfRequirementRelationId,
        relationType: element.customData?.pfRequirementRelationType,
        requirementId: element.customData?.pfRequirementId,
        domainId: element.customData?.pfSemanticId,
        rationale: element.customData?.pfRationale,
        status: element.customData?.pfAiStatus,
      })),
  };
};
