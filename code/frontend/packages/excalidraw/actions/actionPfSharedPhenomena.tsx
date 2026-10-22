import { useEffect, useMemo, useRef, useState } from "react";
import { arrayToMap } from "../utils";
import { newTextElement } from "../element/newElement";
import { newElementWith } from "../element/mutateElement";
import {
  redrawTextBoundingBox,
  getBoundTextElement,
} from "../element/textElement";
import { isLinearElement, isTextElement } from "../element/typeChecks";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "../element/types";
import { CaptureUpdateAction } from "../store";
import { ColorPicker } from "../components/ColorPicker/ColorPicker";
import { ButtonIcon } from "../components/ButtonIcon";
import { EraserIcon } from "../components/icons";
import {
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_PICKS,
} from "../colors";
import { register } from "./register";
import type { AppState } from "../types";

type DisplayMode = "detailed" | "compact";

export type PfSharedPhenomena = {
  displayMode: DisplayMode;
  compactCode: string;
  sourcePhenomena: string[];
  targetPhenomena: string[];
  labelWidth?: number;
  fontColor?: string;
  backgroundColor?: string;
  resetStyle?: boolean;
  openPopup?: AppState["openPopup"];
};

type PfCustomData = {
  pfName?: string;
  pfSharedPhenomena?: PfSharedPhenomena;
  pfSharedPhenomenaLabel?: boolean;
  pfSharedInterfaceId?: string;
  pfRequirementId?: string;
  pfRequirementRelationId?: string;
  pfRequirementRelationType?: string;
  pfRequirementLabel?: boolean;
};

const EMPTY_CONFIG: PfSharedPhenomena = {
  displayMode: "detailed",
  compactCode: "",
  sourcePhenomena: [],
  targetPhenomena: [],
  labelWidth: 240,
  fontColor: "#1e1e1e",
  backgroundColor: "transparent",
};

const dataOf = (element: ExcalidrawElement): PfCustomData =>
  element.customData ?? {};

/**
 * 问题框架中承载领域间关系的线：共享现象用 line，需求引用/约束用 arrow。
 * 两者的绑定文本、端点刷新与损坏数据修复逻辑完全一致。
 */
export const isPfRelationLink = (element: ExcalidrawElement): boolean =>
  isLinearElement(element) &&
  Boolean(
    element.customData?.pfSharedInterfaceId ||
      element.customData?.pfRequirementRelationId,
  );

const normalizeCompactCode = (value: string) => value.trim().slice(0, 8);

export const isPfCompactCodeInUse = (
  elements: readonly ExcalidrawElement[],
  lineId: ExcalidrawElement["id"],
  code: string,
) => {
  const normalized = normalizeCompactCode(code).toLocaleLowerCase();
  return (
    normalized.length > 0 &&
    elements.some(
      (element) =>
        element.id !== lineId &&
        element.type === "line" &&
        dataOf(element)
          .pfSharedPhenomena?.compactCode.trim()
          .toLocaleLowerCase() === normalized,
    )
  );
};

export const getNextPfCompactCode = (
  elements: readonly ExcalidrawElement[],
) => {
  const used = new Set(
    elements
      .filter((element) => element.type === "line")
      .map((element) =>
        dataOf(element)
          .pfSharedPhenomena?.compactCode.trim()
          .toLocaleLowerCase(),
      )
      .filter(Boolean),
  );
  let index = 1;
  while (used.has(`c${index}`)) index++;
  return `C${index}`;
};

// 绑定标签会被 Excalidraw 一并加入选择结果；编辑器只以实际选中的线条为准。
const selectedLine = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
) => {
  const lines: ExcalidrawLinearElement[] = [];
  elements.forEach((element) => {
    if (selectedElementIds[element.id] && isLinearElement(element)) {
      lines.push(element);
    }
  });
  return lines.length === 1 ? lines[0] : null;
};

const cleanItems = (items: readonly string[]) =>
  items.map((item) => item.trim()).filter(Boolean);

const endpointName = (
  line: ExcalidrawLinearElement,
  elements: readonly ExcalidrawElement[],
  side: "source" | "target",
) => {
  const binding = side === "source" ? line.startBinding : line.endBinding;
  const endpoint = binding
    ? elements.find((element) => element.id === binding.elementId)
    : undefined;
  if (!endpoint) return undefined;

  // 优先使用领域图形中用户输入的文字；没有文字时才回退到领域类型名称。
  const endpointText = getBoundTextElement(endpoint, arrayToMap(elements));
  return (
    endpointText?.text.trim() || dataOf(endpoint).pfName?.trim() || undefined
  );
};

/** 按问题框架记法生成线条中部的共享现象标签。 */
export const formatPfSharedPhenomenaLabel = (
  line: ExcalidrawLinearElement,
  elements: readonly ExcalidrawElement[],
  config: PfSharedPhenomena,
) => {
  if (config.displayMode === "compact") return config.compactCode.trim();
  const lines: string[] = [];
  const sourceItems = cleanItems(config.sourcePhenomena);
  const targetItems = cleanItems(config.targetPhenomena);
  if (sourceItems.length > 0) {
    lines.push(
      `${endpointName(line, elements, "source") || "源端"}!{${sourceItems.join(
        ",",
      )}}`,
    );
  }
  if (targetItems.length > 0) {
    lines.push(
      `${
        endpointName(line, elements, "target") || "目标端"
      }!{${targetItems.join(",")}}`,
    );
  }
  return lines.join("\n");
};

const updateManagedLabel = (
  elements: readonly ExcalidrawElement[],
  line: ExcalidrawLinearElement,
  label: string,
) => {
  const elementsMap = arrayToMap(elements);
  const currentText = getBoundTextElement(line, elementsMap);
  const managedText =
    currentText && dataOf(currentText).pfSharedPhenomenaLabel
      ? currentText
      : null;
  const config = dataOf(line).pfSharedPhenomena;
  const fontColor = config?.fontColor || line.strokeColor;
  const backgroundColor = config?.backgroundColor || "transparent";

  if (!label) {
    if (!managedText) return elements;
    return elements
      .filter((element) => element.id !== managedText.id)
      .map((element) =>
        element.id === line.id
          ? newElementWith(line, {
              boundElements:
                line.boundElements?.filter(
                  (binding) => binding.id !== managedText.id,
                ) ?? null,
            })
          : element,
      );
  }

  const text = currentText
    ? newElementWith(currentText, {
        text: label,
        originalText: label,
        strokeColor: fontColor,
        backgroundColor,
        customData: {
          ...currentText.customData,
          pfSharedPhenomenaLabel: true,
          pfSharedPhenomenaLabelWidth: configLabelWidth(line),
        },
      })
    : newTextElement({
        x: line.x + line.width / 2,
        y: line.y + line.height / 2,
        text: label,
        fontSize: 16,
        strokeColor: fontColor,
        backgroundColor,
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: line.opacity,
        angle: line.angle,
        groupIds: [],
        frameId: line.frameId,
        index: null,
        roundness: null,
        seed: Math.floor(Math.random() * 2_147_483_647),
        version: 1,
        versionNonce: Math.floor(Math.random() * 2_147_483_647),
        boundElements: null,
        link: null,
        locked: false,
        containerId: line.id,
        textAlign: "center",
        verticalAlign: "middle",
        customData: {
          pfSharedPhenomenaLabel: true,
          pfSharedPhenomenaLabelWidth: configLabelWidth(line),
        },
      });
  const nextLine = currentText
    ? line
    : newElementWith(line, {
        boundElements: [
          ...(line.boundElements ?? []).filter(
            (binding) => binding.type !== "text",
          ),
          { id: text.id, type: "text" as const },
        ],
      });
  const nextMap = arrayToMap([
    ...elements.filter(
      (element) => element.id !== line.id && element.id !== text.id,
    ),
    nextLine,
    text,
  ]);
  redrawTextBoundingBox(
    text as ExcalidrawTextElement,
    nextLine,
    nextMap,
    false,
  );

  const result = elements.filter(
    (element) => element.id !== line.id && element.id !== text.id,
  );
  const lineIndex = elements.findIndex((element) => element.id === line.id);
  result.splice(lineIndex, 0, nextLine, text);
  return result;
};

const PF_REQUIREMENT_LABEL_FONT_SIZE = 16;

/** 需求图形上的绑定文字即需求正文，引用/约束虚线没有标签。 */
const formatPfRequirementLabel = (
  shape: ExcalidrawElement,
  elements: readonly ExcalidrawElement[],
) => {
  const boundText = getBoundTextElement(shape, arrayToMap(elements));
  return boundText?.text.trim() || dataOf(shape).pfName?.trim() || "需求";
};

/**
 * 领域或需求文字变化后，刷新关联图形上的名称。
 * 共享现象的绑定文本和需求图形上的需求正文都记录在 customData 中，
 * 领域更名后必须同步，否则画布会保留旧名称。
 */
export const refreshPfSharedPhenomenaLabelsForEndpoint = (
  elements: readonly ExcalidrawElement[],
  endpointId: ExcalidrawElement["id"],
) => {
  let nextElements = [...elements];
  const affectedLineIds = nextElements
    .filter(
      (element): element is NonDeletedExcalidrawElement =>
        isLinearElement(element) &&
        isPfRelationLink(element) &&
        Boolean(dataOf(element).pfSharedPhenomena) &&
        (element.startBinding?.elementId === endpointId ||
          element.endBinding?.elementId === endpointId),
    )
    .map((element) => element.id);

  affectedLineIds.forEach((lineId) => {
    const line = nextElements.find(
      (element): element is ExcalidrawLinearElement =>
        element.id === lineId && element.type === "line",
    );
    const config = line ? dataOf(line).pfSharedPhenomena : undefined;
    if (line && config) {
      nextElements = [
        ...updateManagedLabel(
          nextElements,
          line,
          formatPfSharedPhenomenaLabel(line, nextElements, config),
        ),
      ];
    }
  });

  // 需求正文由需求图形承载；虚线本身没有标签，因此只需同步正文。
  const requirement = nextElements.find(
    (element) =>
      element.id === endpointId &&
      (element.type === "pf-requirement" ||
        Boolean(dataOf(element).pfRequirementId)),
  );
  if (requirement) {
    const label = formatPfRequirementLabel(requirement, nextElements);
    const currentText = getBoundTextElement(
      requirement,
      arrayToMap(nextElements),
    );
    if (
      currentText &&
      isTextElement(currentText) &&
      (currentText.text !== label ||
        dataOf(currentText).pfRequirementLabel !== true)
    ) {
      nextElements = nextElements.map((element) =>
        element.id === currentText.id
          ? newElementWith(element as ExcalidrawTextElement, {
              text: label,
              originalText: label,
              fontSize: PF_REQUIREMENT_LABEL_FONT_SIZE,
              customData: {
                ...element.customData,
                pfRequirementLabel: true,
              },
            })
          : element,
      );
    }
  }

  return nextElements;
};

const parseList = (value: string) =>
  value.split(/[，,\n]/).map((item) => item.trim());

const PhenomenaTextarea = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) => {
  const [draft, setDraft] = useState(() => value.join(","));
  const composing = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current && !composing.current) {
      setDraft(value.join(","));
    }
  }, [value]);

  const commit = (nextValue: string) => {
    setDraft(nextValue);
    onChange(parseList(nextValue));
  };

  return (
    <textarea
      rows={2}
      value={draft}
      placeholder="多个现象用逗号分隔"
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(event) => {
        focused.current = false;
        commit(event.currentTarget.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        commit(event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);
        if (!composing.current) {
          onChange(parseList(nextValue));
        }
      }}
    />
  );
};

const CompactCodeInput = ({
  value,
  line,
  elements,
  onChange,
}: {
  value: string;
  line: ExcalidrawLinearElement;
  elements: readonly ExcalidrawElement[];
  onChange: (value: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const duplicated = isPfCompactCodeInUse(elements, line.id, draft);

  return (
    <>
      <input
        value={draft}
        maxLength={8}
        aria-invalid={duplicated}
        onChange={(event) => {
          const nextValue = normalizeCompactCode(event.target.value);
          setDraft(nextValue);
          if (!isPfCompactCodeInUse(elements, line.id, nextValue)) {
            onChange(nextValue);
          }
        }}
      />
      {duplicated && (
        <small className="pf-shared-phenomena__error">
          该简写已被当前画布中的其他共享现象使用
        </small>
      )}
    </>
  );
};

const configLabelWidth = (line: ExcalidrawLinearElement) =>
  Math.max(80, dataOf(line).pfSharedPhenomena?.labelWidth ?? 240);

const resetManagedLabelStyle = (
  elements: readonly ExcalidrawElement[],
  line: ExcalidrawLinearElement,
) =>
  elements.map((element) => {
    if (
      element.type !== "text" ||
      element.containerId !== line.id ||
      !dataOf(element).pfSharedPhenomenaLabel
    ) {
      return element;
    }
    const customData = { ...element.customData };
    delete customData.pfSharedPhenomenaLabelPosition;
    return newElementWith(element, {
      strokeColor: line.strokeColor,
      backgroundColor: "transparent",
      customData,
    });
  });

export const actionChangePfSharedPhenomena = register({
  name: "changePfSharedPhenomena",
  label: "共享现象",
  trackEvent: false,
  predicate: (elements, appState) => {
    return selectedLine(elements, appState.selectedElementIds)?.type === "line";
  },
  perform: (elements, appState, formData: PfSharedPhenomena) => {
    const line = selectedLine(elements, appState.selectedElementIds);
    if (!line || line.type !== "line") return false;
    const config: PfSharedPhenomena = {
      ...formData,
      compactCode: normalizeCompactCode(formData.compactCode),
      // 编辑过程中保留逗号后的空项，否则受控输入框会立即吞掉逗号。
      sourcePhenomena: formData.sourcePhenomena,
      targetPhenomena: formData.targetPhenomena,
      labelWidth: Math.max(80, formData.labelWidth || 240),
      fontColor: formData.fontColor || line.strokeColor,
      backgroundColor: formData.backgroundColor || "transparent",
    };
    delete config.resetStyle;
    delete config.openPopup;
    const updatedLine = newElementWith(line, {
      customData: { ...line.customData, pfSharedPhenomena: config },
    });
    const withLine = elements.map((element) =>
      element.id === line.id ? updatedLine : element,
    );
    const updatedElements = updateManagedLabel(
      withLine,
      updatedLine,
      formatPfSharedPhenomenaLabel(updatedLine, withLine, config),
    );
    return {
      elements: formData.resetStyle
        ? resetManagedLabelStyle(updatedElements, updatedLine)
        : updatedElements,
      appState: {
        ...appState,
        ...(formData.openPopup !== undefined
          ? { openPopup: formData.openPopup }
          : {}),
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, updateData }) => {
    const line = selectedLine(elements, appState.selectedElementIds);
    const config = useMemo(
      () =>
        line ? dataOf(line).pfSharedPhenomena ?? EMPTY_CONFIG : EMPTY_CONFIG,
      [line],
    );

    // 端点被连到领域图形后，画布上的共享现象标签仍是旧的“源端/目标端”。
    // 只在“端点绑定发生变化”时刷新一次：用 useRef 记录上次绑定，且只处理带
    // pfSharedPhenomena 配置的线。避免对普通线触发 updateData，否则会无限重渲染
    // （React error #185: Maximum update depth exceeded）。
    const prevSourceBinding = useRef<string | null>(null);
    const prevTargetBinding = useRef<string | null>(null);
    useEffect(() => {
      if (!line || line.type !== "line") return;
      if (!dataOf(line).pfSharedPhenomena) return;
      const sourceBinding = line.startBinding?.elementId ?? null;
      const targetBinding = line.endBinding?.elementId ?? null;
      const bindingChanged =
        prevSourceBinding.current !== sourceBinding ||
        prevTargetBinding.current !== targetBinding;
      prevSourceBinding.current = sourceBinding;
      prevTargetBinding.current = targetBinding;
      if (!bindingChanged) return;
      const elementsMap = arrayToMap(elements);
      const currentText = getBoundTextElement(line, elementsMap);
      const label = formatPfSharedPhenomenaLabel(line, elements, config);
      if (currentText?.text !== label && (currentText || label)) {
        updateData(config);
      }
    }, [line, elements, config, updateData]);

    if (!line || line.type !== "line") return null;

    const update = (next: Partial<PfSharedPhenomena>) =>
      updateData({ ...config, ...next });

    return (
      <fieldset className="pf-shared-phenomena">
        <legend>共享现象</legend>
        <label>
          显示方式
          <select
            value={config.displayMode}
            onChange={(event) => {
              const displayMode = event.target.value as DisplayMode;
              update({
                displayMode,
                compactCode:
                  displayMode === "compact" && !config.compactCode
                    ? getNextPfCompactCode(elements)
                    : config.compactCode,
              });
            }}
          >
            <option value="detailed">详细</option>
            <option value="compact">简写</option>
          </select>
        </label>
        {config.displayMode === "compact" ? (
          <label>
            简写字母
            <CompactCodeInput
              value={config.compactCode}
              line={line}
              elements={elements}
              onChange={(value) => update({ compactCode: value })}
            />
          </label>
        ) : (
          <>
            <label>
              {endpointName(line, elements, "source") || "源端"}发起
              <PhenomenaTextarea
                value={config.sourcePhenomena}
                onChange={(value) => update({ sourcePhenomena: value })}
              />
            </label>
            <label>
              {endpointName(line, elements, "target") || "目标端"}发起
              <PhenomenaTextarea
                value={config.targetPhenomena}
                onChange={(value) => update({ targetPhenomena: value })}
              />
            </label>
          </>
        )}
        <label>
          标签宽度
          <input
            type="number"
            min={80}
            step={10}
            value={config.labelWidth ?? 240}
            onChange={(event) =>
              update({ labelWidth: Number(event.target.value) })
            }
          />
        </label>
        <div className="pf-shared-phenomena__colors">
          <div>
            <span>字体颜色</span>
            <ColorPicker
              topPicks={DEFAULT_ELEMENT_STROKE_PICKS}
              palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
              type="elementStroke"
              popupType="pfLabelFontColor"
              label="字体颜色"
              color={config.fontColor || line.strokeColor}
              onChange={(fontColor) => update({ fontColor })}
              elements={elements}
              appState={appState}
              updateData={(popupState) =>
                updateData({ ...config, ...popupState })
              }
            />
          </div>
          <div>
            <span>标签背景</span>
            <ColorPicker
              topPicks={DEFAULT_ELEMENT_BACKGROUND_PICKS}
              palette={DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE}
              type="elementBackground"
              popupType="pfLabelBackgroundColor"
              label="标签背景"
              color={config.backgroundColor || "transparent"}
              onChange={(backgroundColor) => update({ backgroundColor })}
              elements={elements}
              appState={appState}
              updateData={(popupState) =>
                updateData({ ...config, ...popupState })
              }
            />
          </div>
        </div>
        <div className="pf-shared-phenomena__operations">
          <ButtonIcon
            standalone
            icon={EraserIcon}
            title="重置当前标签样式"
            onClick={() =>
              updateData({
                ...config,
                labelWidth: 240,
                fontColor: line.strokeColor,
                backgroundColor: "transparent",
                resetStyle: true,
              })
            }
          />
        </div>
      </fieldset>
    );
  },
});
