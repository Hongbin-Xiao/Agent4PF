import { BuiltInAgent } from "@copilotkit/runtime/v2";

// AG-UI stores reasoning separately, while BuiltInAgent drops it from history.
export function prepareHistory(input) {
  const messages = [];
  const reasoning = [];
  const pending = new Map();
  const resumed = new Map((input.resume ?? []).map((entry) => [entry.interruptId, entry]));
  let currentReasoning = "";

  const resolvePending = (cancelled) => {
    for (const [id, entry] of pending) {
      const resume = resumed.get(id);
      if (!resume && !cancelled) continue;
      messages.push({
        id: `result_${id}`,
        role: "tool",
        toolCallId: id,
        content: JSON.stringify(resume
          ? resume.status === "cancelled"
            ? { status: "cancelled" }
            : resume.payload ?? { status: "resolved" }
          : {
              status: "cancelled",
              confirmed: false,
              reason: "A new user message superseded this unanswered tool call. Inspect the canvas before continuing; do not assume confirmation or execution.",
              tool: entry.function.name,
            }),
      });
      pending.delete(id);
    }
  };

  for (const message of input.messages) {
    if (message.role === "reasoning") {
      currentReasoning += typeof message.content === "string" ? message.content : "";
      messages.push(message);
      continue;
    }
    if (message.role === "user") {
      resolvePending(true);
      currentReasoning = "";
    } else if (message.role === "tool") {
      pending.delete(message.toolCallId);
      currentReasoning = "";
    } else if (message.role === "assistant") {
      reasoning.push(currentReasoning);
      for (const call of message.toolCalls ?? []) pending.set(call.id, call);
      currentReasoning = "";
    }
    messages.push(message);
  }
  resolvePending(false);
  return { input: { ...input, messages, resume: [] }, reasoning };
}

export function withDeepSeekReasoning(model, historyReasoning) {
  const prepare = (options) => {
    let assistantIndex = 0;
    let missingCurrentReasoning = false;
    const lastUserIndex = options.prompt.findLastIndex((message) => message.role === "user");
    const prompt = options.prompt.map((message, index) => {
      if (message.role !== "assistant") return message;
      const inline = message.content.filter((part) => part.type === "reasoning")
        .map((part) => part.text).join("");
      const reasoning = inline || historyReasoning[assistantIndex++] ||
        message.providerOptions?.openaiCompatible?.reasoning_content;
      if (!reasoning) {
        if (message.content.some((part) => part.type === "tool-call")) {
          missingCurrentReasoning = true;
        }
        return message;
      }
      return {
        ...message,
        providerOptions: {
          ...message.providerOptions,
          openaiCompatible: {
            ...message.providerOptions?.openaiCompatible,
            reasoning_content: reasoning,
          },
        },
      };
    });
    // Legacy/interrupted histories can lack the original reasoning. Do not invent it.
    return {
      ...options,
      prompt,
      ...(missingCurrentReasoning ? {
        providerOptions: {
          ...options.providerOptions,
          deepseek: { ...options.providerOptions?.deepseek, thinking: { type: "disabled" } },
        },
      } : {}),
    };
  };
  return new Proxy(model, {
    get(target, property) {
      if (property === "doStream" || property === "doGenerate") {
        return (options) => target[property](prepare(options));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class DeepSeekAgent extends BuiltInAgent {
  run(input) {
    const prepared = prepareHistory(input);
    // Runtime clones agents per request; the wrapper captures only this run's history.
    const runAgent = new BuiltInAgent({
      ...this.config,
      model: withDeepSeekReasoning(this.config.model, prepared.reasoning),
    });
    runAgent.middlewares = [...this.middlewares];
    return runAgent.run(prepared.input);
  }

  clone() {
    const cloned = new DeepSeekAgent(this.config);
    cloned.middlewares = [...this.middlewares];
    return cloned;
  }
}
