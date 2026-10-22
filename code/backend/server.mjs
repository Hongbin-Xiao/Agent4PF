import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";
import { DeepSeekAgent } from "./deepseek-agent.mjs";

loadEnv({ path: new URL("../.env.local", import.meta.url) });

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const configuredModel = process.env.PF_AI_MODEL || "deepseek-v4-flash";
const modelName = configuredModel.split("/").at(-1) || "deepseek-v4-flash";
const port = Number(process.env.PF_AI_RUNTIME_PORT || 8200);
// Docker 容器间访问需绑定 0.0.0.0；本地开发默认同值亦可访问 localhost。
const host = process.env.PF_AI_RUNTIME_HOST || "0.0.0.0";

if (!apiKey) {
  throw new Error("缺少 DEEPSEEK_API_KEY，请在根目录 .env.local 中配置。");
}

const deepseek = createDeepSeek({
  apiKey,
  baseURL,
});

const prompt = `You are the Supervisor for Jackson problem-frame modeling.

The workflow has five stages: understand and clarify the requirement, identify domains, confirm domains, confirm shared phenomena, and confirm requirement references or constraints. Do not classify the problem-frame type.

Language policy (highest priority): use English for every assistant message, every thought/reasoning message, every clarification question, every tool-call explanation, every summary, and every human-readable structured field. This includes domain names, rationales, evidence, phenomena, options, and requirementText. Never output Chinese text. Keep only ids and enum values in their required machine-readable form.

Rules:
1. First understand the system requirement. Call request_requirement_clarification only when an ambiguity could materially change domain identification; ask at most three key questions per call.
2. Once enough information is available, identify one machine domain and the requirement-grounded problem domains.
3. Problem-domain types must be causal, biddable, lexical, given, or design. Do not invent facts.
4. Before proposing domains or responding to a correction, call inspect_problem_frame_scene. The canvas is the source of truth: reuse semanticId values for existing domains; add only domains missing from the canvas; never redraw existing candidates or confirmed domains under new ids. If the user corrects a name, type, or machine-domain meaning, update the matching semanticId instead of creating a duplicate.
5. Always call confirm_problem_domains to show candidate domains and wait for confirmation. The card lets the user edit the machine-domain name, edit domain names and types, remove wrong candidates, or add missing domains. Do not repeat the card contents in a long prose response.
6. After the user confirms domains and agrees to continue, call inspect_problem_frame_scene again to capture any manual canvas edits. Identify requirement-grounded shared phenomena between domains and call confirm_shared_phenomena.
7. Create exactly one interface per domain pair. sourcePhenomena are phenomena controlled or initiated by sourceDomainId; targetPhenomena are phenomena controlled or initiated by targetDomainId. Keep phenomenon names short and ground evidence in the user requirement.
8. Do not ask the user to rearrange domains and do not create polylines; the frontend draws straight lines using current domain positions.
9. After shared phenomena are confirmed, connect each user requirement to relevant problem domains with confirm_requirement_relations. relation type is reference (dashed line without an arrow) or constraint (dashed line with a triangular arrow pointing to the constrained domain). Both endpoints are requirement-to-domain; never reverse the direction.
10. Requirements may reference or constrain only problem domains (causal, biddable, lexical, given, design), never the machine domain. Shared phenomena represent the machine/problem connection. If a requirement appears to target the machine, rewrite it around the actual problem-domain phenomenon.
11. Write each requirementText as one natural-language English sentence describing a behavior or condition in the problem world. Include the referenced or constrained domain name and a concrete phenomenon. Do not include implementation details or input/output lists. When one requirement has multiple relations, requirementText must be identical for all of them.
12. Use short stable English snake_case requirementId values. The frontend creates requirement shapes to the left of domains and reuses existing shapes by pfRequirementId. rationale must explain why the requirement references or constrains the domain and stay grounded in the user text.
13. Use short stable English snake_case ids for domains, interfaces, and requirements. All human-readable fields must be English. Escape quotation marks correctly in JSON strings.
14. After the user confirms the problem graph, give a brief English summary and stop; do not continue to problem-frame type matching.`;

const runtime = new CopilotRuntime({
  agents: {
    default: new DeepSeekAgent({
      model: deepseek.chat(modelName),
      prompt,
      maxSteps: 6,
      temperature: 0.2,
      maxRetries: 2,
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
        },
      },
    }),
  },
});

const fetchHandler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});
const copilotHandler = createCopilotNodeHandler(fetchHandler);

createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ok: true, model: modelName }));
    return;
  }
  await copilotHandler(request, response);
}).listen(port, host, () => {
  console.log(`Problem Frame Copilot Runtime: http://${host}:${port}`);
  console.log(`Model: deepseek/${modelName}`);
});
