import { useEffect, useState } from "react";
import {
  LocateFixed,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
} from "lucide-react";
import {
  CopilotChat,
  CopilotKitProvider,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  highlightProblemDomain,
  highlightRequirementRelation,
  highlightSharedPhenomena,
  repairLegacyProblemFrameConnections,
  renderDomainProposal,
  renderRequirementRelationProposal,
  renderSharedPhenomenaProposal,
  summarizeProblemFrameScene,
} from "./problemFrameCanvas";
import type {
  DomainProposal,
  ProblemDomainType,
  PfRequirementRelationType,
  RequirementRelationProposal,
  SharedPhenomenaProposal,
} from "./problemFrameCanvas";

import "@copilotkit/react-core/v2/styles.css";
import "./ProblemFrameAISidebar.scss";

const domainTypeLabels: Record<ProblemDomainType, string> = {
  machine: "Machine domain",
  causal: "Causal domain",
  biddable: "Biddable domain",
  lexical: "Lexical domain",
  given: "Given domain",
  design: "Design domain",
};

const domainSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["causal", "biddable", "lexical", "given", "design"]),
  rationale: z.string().min(1),
});

const proposalSchema = z.object({
  proposalId: z.string().min(1),
  summary: z.string().min(1),
  machine: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    rationale: z.string().min(1),
  }),
  domains: z.array(domainSchema).min(1).max(12),
});

const clarificationSchema = z.object({
  title: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        reason: z.string().min(1),
        options: z.array(z.string()).max(5).default([]),
      }),
    )
    .min(1)
    .max(3),
});

const sharedPhenomenaSchema = z.object({
  proposalId: z.string().min(1),
  summary: z.string().min(1),
  interfaces: z
    .array(
      z.object({
        id: z.string().min(1),
        sourceDomainId: z.string().min(1),
        targetDomainId: z.string().min(1),
        sourcePhenomena: z.array(z.string()).default([]),
        targetPhenomena: z.array(z.string()).default([]),
        evidence: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

const relationTypeLabels: Record<PfRequirementRelationType, string> = {
  reference: "Reference (no arrow)",
  constraint: "Constraint (arrow to domain)",
};

const requirementRelationSchema = z.object({
  proposalId: z.string().min(1),
  summary: z.string().min(1),
  relations: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.enum(["reference", "constraint"]),
        requirementId: z.string().min(1),
        requirementText: z.string().min(1),
        domainId: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .min(1)
    .max(30),
});

const ClarificationCard = ({
  args,
  onSubmit,
}: {
  args: z.infer<typeof clarificationSchema>;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
}) => {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const complete = args.questions.every((question) =>
    answers[question.id]?.trim(),
  );

  return (
    <section className="pf-ai-card">
      <div className="pf-ai-card__eyebrow">Waiting for your input</div>
      <h3>{args.title}</h3>
      {args.questions.map((question) => (
        <div className="pf-ai-question" key={question.id}>
          <strong>{question.question}</strong>
          <p>{question.reason}</p>
          {question.options.length ? (
            <div className="pf-ai-options">
              {question.options.map((option) => (
                <button
                  className={
                    answers[question.id] === option ? "is-selected" : ""
                  }
                  key={option}
                  onClick={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option,
                    }))
                  }
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
              placeholder="Enter your answer"
              rows={2}
              value={answers[question.id] || ""}
            />
          )}
        </div>
      ))}
      <button
        className="pf-ai-primary"
        disabled={!complete || submitting}
        onClick={async () => {
          setSubmitting(true);
          await onSubmit(answers);
        }}
        type="button"
      >
        {submitting ? "Continuing analysis..." : "Submit and continue"}
      </button>
    </section>
  );
};

const DomainConfirmationCard = ({
  api,
  initialProposal,
  onConfirm,
}: {
  api: ExcalidrawImperativeAPI;
  initialProposal: DomainProposal;
  onConfirm: (proposal: DomainProposal) => Promise<void>;
}) => {
  const [proposal, setProposal] = useState<DomainProposal>(initialProposal);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    renderDomainProposal(api, proposal, "proposed");
  }, [api, proposal]);

  const updateType = (id: string, type: ProblemDomainType) => {
    setProposal((current) => ({
      ...current,
      domains: current.domains.map((domain) =>
        domain.id === id ? { ...domain, type } : domain,
      ),
    }));
  };

  const updateMachine = (field: "name" | "rationale", value: string) => {
    setProposal((current) => ({
      ...current,
      machine: { ...current.machine, [field]: value },
    }));
  };

  const updateDomain = (
    id: string,
    field: "name" | "rationale",
    value: string,
  ) => {
    setProposal((current) => ({
      ...current,
      domains: current.domains.map((domain) =>
        domain.id === id ? { ...domain, [field]: value } : domain,
      ),
    }));
  };

  const removeDomain = (id: string) => {
    setProposal((current) => ({
      ...current,
      domains: current.domains.filter((domain) => domain.id !== id),
    }));
  };

  const addDomain = () => {
    setProposal((current) => {
      const suffix = current.domains.length + 1;
      return {
        ...current,
        domains: [
          ...current.domains,
          {
            id: `manual_domain_${suffix}`,
            name: `New domain ${suffix}`,
            type: "causal",
            rationale: "Describe how this domain relates to the requirement.",
          },
        ],
      };
    });
  };

  return (
    <section className="pf-ai-card pf-ai-domain-card">
      <div className="pf-ai-card__eyebrow">
        Candidate domains synced to canvas
      </div>
      <h3>Confirm machine and problem domains</h3>
      <p>{proposal.summary}</p>
      <div className="pf-ai-domain-row pf-ai-domain-row--editable">
        <button
          className="pf-ai-domain-row__focus"
          aria-label="Focus machine domain"
          title="Focus machine domain"
          onClick={() =>
            highlightProblemDomain(
              api,
              proposal.proposalId,
              proposal.machine.id,
            )
          }
          type="button"
        >
          <LocateFixed size={14} />
        </button>
        <div className="pf-ai-domain-fields">
          <label>
            <span>Domain name</span>
            <input
              aria-label="Machine domain name"
              onChange={(event) => updateMachine("name", event.target.value)}
              value={proposal.machine.name}
            />
          </label>
          <label>
            <span>Rationale (editable)</span>
            <textarea
              aria-label="Machine domain rationale"
              onChange={(event) =>
                updateMachine("rationale", event.target.value)
              }
              rows={2}
              value={proposal.machine.rationale}
            />
          </label>
        </div>
        <em>{domainTypeLabels.machine}</em>
      </div>
      {proposal.domains.map((domain) => (
        <div
          className="pf-ai-domain-row pf-ai-domain-row--editable"
          key={domain.id}
        >
          <button
            className="pf-ai-domain-row__focus"
            aria-label={`Focus ${domain.name}`}
            title={`Focus ${domain.name}`}
            onClick={() =>
              highlightProblemDomain(api, proposal.proposalId, domain.id)
            }
            type="button"
          >
            <LocateFixed size={14} />
          </button>
          <div className="pf-ai-domain-fields">
            <label>
              <span>Domain name</span>
              <input
                aria-label={`${domain.name} name`}
                onChange={(event) =>
                  updateDomain(domain.id, "name", event.target.value)
                }
                value={domain.name}
              />
            </label>
            <label>
              <span>Rationale (editable)</span>
              <textarea
                aria-label={`${domain.name} rationale`}
                onChange={(event) =>
                  updateDomain(domain.id, "rationale", event.target.value)
                }
                rows={2}
                value={domain.rationale}
              />
            </label>
          </div>
          <select
            aria-label={`${domain.name} domain type`}
            onChange={(event) =>
              updateType(domain.id, event.target.value as ProblemDomainType)
            }
            value={domain.type}
          >
            {Object.entries(domainTypeLabels)
              .filter(([type]) => type !== "machine")
              .map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
          </select>
          <button
            aria-label={`Delete ${domain.name}`}
            title={`Delete ${domain.name}`}
            className="pf-ai-domain-row__remove"
            onClick={() => removeDomain(domain.id)}
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="pf-ai-secondary" onClick={addDomain} type="button">
        + Add missing domain
      </button>
      <button
        className="pf-ai-primary"
        disabled={submitting}
        onClick={async () => {
          setSubmitting(true);
          renderDomainProposal(api, proposal, "confirmed");
          await onConfirm(proposal);
        }}
        type="button"
      >
        {submitting ? "Confirming..." : "Confirm domains"}
      </button>
    </section>
  );
};

const SharedPhenomenaConfirmationCard = ({
  api,
  initialProposal,
  onConfirm,
}: {
  api: ExcalidrawImperativeAPI;
  initialProposal: SharedPhenomenaProposal;
  onConfirm: (proposal: SharedPhenomenaProposal) => Promise<void>;
}) => {
  const [proposal, setProposal] =
    useState<SharedPhenomenaProposal>(initialProposal);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    renderSharedPhenomenaProposal(api, proposal, "proposed");
  }, [api, proposal]);

  const updatePhenomena = (
    id: string,
    side: "sourcePhenomena" | "targetPhenomena",
    value: string,
  ) => {
    setProposal((current) => ({
      ...current,
      interfaces: current.interfaces.map((item) =>
        item.id === id
          ? {
              ...item,
              [side]: value
                .split(/[，,\n]/)
                .map((part) => part.trim())
                .filter(Boolean),
            }
          : item,
      ),
    }));
  };

  return (
    <section className="pf-ai-card pf-ai-phenomena-card">
      <div className="pf-ai-card__eyebrow">
        Candidate interfaces synced to canvas
      </div>
      <h3>Confirm shared phenomena</h3>
      <p>{proposal.summary}</p>
      {proposal.interfaces.map((item) => (
        <div className="pf-ai-interface" key={item.id}>
          <button
            className="pf-ai-interface__title"
            onClick={() =>
              highlightSharedPhenomena(api, proposal.proposalId, item.id)
            }
            type="button"
          >
            <strong>
              {item.sourceDomainId} ↔ {item.targetDomainId}
            </strong>
            <small>{item.evidence}</small>
          </button>
          <label>
            {item.sourceDomainId} initiates
            <textarea
              onChange={(event) =>
                updatePhenomena(item.id, "sourcePhenomena", event.target.value)
              }
              rows={2}
              value={item.sourcePhenomena.join(",")}
            />
          </label>
          <label>
            {item.targetDomainId} initiates
            <textarea
              onChange={(event) =>
                updatePhenomena(item.id, "targetPhenomena", event.target.value)
              }
              rows={2}
              value={item.targetPhenomena.join(",")}
            />
          </label>
        </div>
      ))}
      <button
        className="pf-ai-primary"
        disabled={submitting}
        onClick={async () => {
          setSubmitting(true);
          renderSharedPhenomenaProposal(api, proposal, "confirmed");
          await onConfirm(proposal);
        }}
        type="button"
      >
        {submitting ? "Confirming..." : "Confirm shared phenomena"}
      </button>
    </section>
  );
};

const RequirementRelationConfirmationCard = ({
  api,
  initialProposal,
  onConfirm,
}: {
  api: ExcalidrawImperativeAPI;
  initialProposal: RequirementRelationProposal;
  onConfirm: (proposal: RequirementRelationProposal) => Promise<void>;
}) => {
  const [proposal, setProposal] =
    useState<RequirementRelationProposal>(initialProposal);
  const [submitting, setSubmitting] = useState(false);
  // 需求只能引用/约束问题域：机器域与问题域之间用共享现象表示，
  // 需求描述的是问题世界中的事情，不能直接约束待构建的机器。
  const availableDomains = Array.from(
    new Map(
      api
        .getSceneElements()
        .filter(
          (element) =>
            element.type !== "text" &&
            Boolean(element.customData?.pfSemanticId) &&
            element.customData?.pfDomainType !== "machine",
        )
        .map((element) => [
          String(element.customData?.pfSemanticId),
          String(
            element.customData?.pfName || element.customData?.pfSemanticId,
          ),
        ]),
    ),
  );

  useEffect(() => {
    renderRequirementRelationProposal(api, proposal, "proposed");
  }, [api, proposal]);

  const updateRelation = (
    id: string,
    patch: Partial<RequirementRelationProposal["relations"][number]>,
  ) => {
    setProposal((current) => ({
      ...current,
      relations: current.relations.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  };

  const removeRelation = (id: string) => {
    setProposal((current) => ({
      ...current,
      relations: current.relations.filter((item) => item.id !== id),
    }));
  };

  const addRelation = () => {
    setProposal((current) => {
      const suffix = current.relations.length + 1;
      // 新行保持空白语义，用户填写后才会连到画布上已有的问题域。
      const fallbackDomainId = String(
        api
          .getSceneElements()
          .find(
            (element) =>
              element.customData?.pfSemanticId &&
              element.customData?.pfDomainType !== "machine",
          )?.customData?.pfSemanticId || "uncertain",
      );
      return {
        ...current,
        relations: [
          ...current.relations,
          {
            id: `manual_relation_${suffix}`,
            type: "constraint",
            requirementId: `manual_requirement_${suffix}`,
            requirementText: `New requirement ${suffix}`,
            domainId: fallbackDomainId,
            rationale:
              "Describe why this requirement references or constrains the domain.",
          },
        ],
      };
    });
  };

  return (
    <section className="pf-ai-card pf-ai-requirements-card">
      <div className="pf-ai-card__eyebrow">
        Candidate requirement relations synced to canvas
      </div>
      <h3>Confirm requirement relations</h3>
      <p>
        {proposal.summary}
        <br />
        References have no arrows; constraints point to the constrained domain.
      </p>
      {proposal.relations.map((item) => (
        <div className="pf-ai-requirement" key={item.id}>
          <button
            className="pf-ai-requirement__title"
            onClick={() =>
              highlightRequirementRelation(api, proposal.proposalId, item.id)
            }
            type="button"
          >
            <strong>
              {item.requirementText}
              {item.type === "constraint" ? " constrains " : " references "}
              {item.domainId}
            </strong>
            <small>{item.rationale}</small>
          </button>
          <label>
            Relation type
            <select
              aria-label={`${item.id} relation type`}
              onChange={(event) =>
                updateRelation(item.id, {
                  type: event.target.value as PfRequirementRelationType,
                })
              }
              value={item.type}
            >
              <option value="reference">{relationTypeLabels.reference}</option>
              <option value="constraint">
                {relationTypeLabels.constraint}
              </option>
            </select>
          </label>
          <label>
            Requirement text
            <textarea
              aria-label={`${item.id} requirement text`}
              onChange={(event) =>
                updateRelation(item.id, { requirementText: event.target.value })
              }
              rows={2}
              value={item.requirementText}
            />
          </label>
          <label>
            Referenced or constrained domain
            <select
              aria-label={`${item.id} target domain`}
              onChange={(event) =>
                updateRelation(item.id, { domainId: event.target.value })
              }
              value={item.domainId}
            >
              {!availableDomains.some(([id]) => id === item.domainId) && (
                <option value={item.domainId}>{item.domainId}</option>
              )}
              {availableDomains.map(([id, name]) => (
                <option key={id} value={id}>
                  {name} ({id})
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label={`Delete requirement relation ${item.id}`}
            className="pf-ai-requirement__remove"
            onClick={() => removeRelation(item.id)}
            type="button"
          >
            Delete this relation
          </button>
        </div>
      ))}
      <button className="pf-ai-secondary" onClick={addRelation} type="button">
        + Add requirement relation
      </button>
      <button
        className="pf-ai-primary"
        disabled={submitting || !proposal.relations.length}
        onClick={async () => {
          setSubmitting(true);
          renderRequirementRelationProposal(api, proposal, "confirmed");
          await onConfirm(proposal);
        }}
        type="button"
      >
        {submitting ? "Confirming..." : "Confirm requirement relations"}
      </button>
    </section>
  );
};

const ProblemFrameTools = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  useEffect(() => {
    repairLegacyProblemFrameConnections(api);
  }, [api]);

  useFrontendTool({
    name: "inspect_problem_frame_scene",
    description:
      "Read current canvas domains, shared phenomena, requirements, and reference/constraint relations. Return semantic ids, names, types, confirmation states, positions, relation types, and target domains. Always read before proposing additions or corrections; reuse existing ids and propose only missing or changed items. Read-only; do not modify the canvas.",
    parameters: z.object({}),
    handler: async () => JSON.stringify(summarizeProblemFrameScene(api)),
  });

  useHumanInTheLoop({
    name: "request_requirement_clarification",
    description:
      "Call only when a requirement ambiguity could affect domain identification. Present clarification questions and options in English and wait for answers.",
    parameters: clarificationSchema,
    render: ({ args, status, respond }) => {
      if (status === "inProgress") {
        return (
          <div className="pf-ai-card">Preparing clarification questions...</div>
        );
      }
      if (status === "complete") {
        return (
          <div className="pf-ai-card pf-ai-card--complete">
            Clarification submitted
          </div>
        );
      }
      return (
        <ClarificationCard
          args={args}
          onSubmit={(answers) => respond({ answers })}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "confirm_shared_phenomena",
    description:
      "Call after domains are confirmed and the user agrees to continue. Present English candidate shared phenomena per domain pair, draw straight lines using current domain positions, and wait for confirmation. Do not move or rearrange existing domains.",
    parameters: sharedPhenomenaSchema,
    render: ({ args, status, respond }) => {
      if (status === "inProgress") {
        return (
          <div className="pf-ai-card">
            Generating candidate shared phenomena...
          </div>
        );
      }
      if (status === "complete") {
        return (
          <div className="pf-ai-card pf-ai-card--complete">
            Shared phenomena confirmed and kept on canvas
          </div>
        );
      }
      return (
        <SharedPhenomenaConfirmationCard
          api={api}
          initialProposal={args}
          onConfirm={(proposal) => respond({ confirmed: true, proposal })}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "confirm_requirement_relations",
    description:
      "Call after shared phenomena are confirmed to build the problem graph. Connect English requirements to problem domains as references (dashed, no arrow) or constraints (triangular arrow toward the domain). Shapes are created to the left of domains and reused by requirementId.",
    parameters: requirementRelationSchema,
    render: ({ args, status, respond }) => {
      if (status === "inProgress") {
        return (
          <div className="pf-ai-card">Generating requirement relations...</div>
        );
      }
      if (status === "complete") {
        return (
          <div className="pf-ai-card pf-ai-card--complete">
            Requirement relations confirmed and kept on canvas
          </div>
        );
      }
      return (
        <RequirementRelationConfirmationCard
          api={api}
          initialProposal={args}
          onConfirm={(proposal) => respond({ confirmed: true, proposal })}
        />
      );
    },
  });

  useHumanInTheLoop({
    name: "confirm_problem_domains",
    description:
      "Always call after domain identification. Merge by semanticId: preserve existing positions and connections, add only missing domains, and update names, rationales, or types using the same id. Present all human-readable fields in English. Users can edit the machine domain, add or remove problem domains, and change types.",
    parameters: proposalSchema,
    render: ({ args, status, respond }) => {
      if (status === "inProgress") {
        return (
          <div className="pf-ai-card">Generating candidate domains...</div>
        );
      }
      if (status === "complete") {
        return (
          <div className="pf-ai-card pf-ai-card--complete">
            Domains confirmed and kept on canvas
          </div>
        );
      }
      return (
        <DomainConfirmationCard
          api={api}
          initialProposal={args}
          onConfirm={(proposal) => respond({ confirmed: true, proposal })}
        />
      );
    },
  });

  return null;
};

export const ProblemFrameAISidebar = ({
  excalidrawAPI,
  theme = "light",
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  theme?: "light" | "dark";
}) => {
  const [isVisible, setIsVisible] = useState(true);

  // 生产环境通过 VITE_APP_COPILOTKIT_RUNTIME_URL 指向同源反向代理（如 /api/copilotkit），
  // 服务器浏览器无法访问 127.0.0.1。未配置时回退：生产 /api/copilotkit，本地开发直连 8200。
  const runtimeUrl =
    import.meta.env.VITE_APP_COPILOTKIT_RUNTIME_URL ||
    (import.meta.env.MODE === "production"
      ? "/api/copilotkit"
      : "http://127.0.0.1:8200/api/copilotkit");

  return (
    <CopilotKitProvider enableInspector={false} runtimeUrl={runtimeUrl}>
      <ProblemFrameTools api={excalidrawAPI} />
      <aside
        aria-label="AI assistant"
        lang="en"
        className={`pf-ai-sidebar ${
          isVisible ? "pf-ai-sidebar--open" : "pf-ai-sidebar--collapsed"
        } ${theme === "dark" ? "pf-ai-sidebar--dark" : ""}`}
      >
        <button
          className="pf-ai-sidebar-rail-toggle"
          aria-label="Open AI sidebar"
          title="Open AI sidebar"
          onClick={() => setIsVisible(true)}
          type="button"
        >
          <PanelRightOpen size={18} />
        </button>
        <span className="pf-ai-sidebar-rail-label">Chat</span>
        <div className="pf-ai-panel">
          <header className="pf-ai-stage">
            <div className="pf-ai-stage__title">
              <strong>Problem-frame modeling assistant</strong>
            </div>
            <button
              className="pf-ai-sidebar-toggle"
              aria-label="Collapse AI sidebar"
              title="Collapse AI sidebar"
              onClick={() => setIsVisible(false)}
              type="button"
            >
              <PanelRightClose size={18} />
            </button>
          </header>
          <div className="pf-ai-chat">
            <CopilotChat
              agentId="default"
              labels={{
                welcomeMessageText: "Describe the system you want to model.",
                chatInputPlaceholder: "Enter a system requirement or answer...",
                chatDisclaimerText:
                  "AI-generated models require your confirmation.",
              }}
            />
          </div>
        </div>
      </aside>
    </CopilotKitProvider>
  );
};
