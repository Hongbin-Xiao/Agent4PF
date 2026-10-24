# Agent4PF

**A Human–AI Collaborative Tool for Stepwise Problem Frames Modeling from Natural Language Requirements**

Agent4PF turns a natural-language requirement description into a Jackson **Problem Frames (PF)** problem diagram through four reviewable steps. An LLM agent proposes structured candidate elements at each step. The analyst edits, rejects (with a comment), or confirms them, and **only confirmed elements enter the model**.

> 🎬 **Demo video:** <[Click here](https://www.youtube.com/watch?v=xIaZc6bPdlY)> (four-minute walkthrough)

---

## ✨ Highlights

- **Four-step PF workflow.** The steps are system boundary definition, problem-domain identification, shared-phenomena linking, and requirement mapping.
- **Schema-constrained generation.** Each stage uses zero-shot chain-of-thought (CoT) prompting and a predefined JSON Schema. Malformed or incomplete output is rejected and retried instead of being rendered.
- **Human in the loop.** Candidates appear as editable cards. The model never advances without analyst confirmation.
- **Comment-driven regeneration.** A rejection sends your feedback back to the agent as a targeted retry.
- **Incremental merging.** Confirmed elements are merged into the diagram immediately, so it grows step by step.
- **Export.** The finished model can be exported as structured JSON and as an image.

---

## 🧭 Workflow

<img width="5649" height="1626" alt="new_01" src="https://github.com/user-attachments/assets/291487fd-1884-47df-a886-e0750f4993f6" />








| Step | Input | Output |
|------|-------|--------|
| 1. Boundary definition | Requirement text | Machine, external entities, interfaces |
| 2. Problem-domain analysis | Text + confirmed boundary | Domains with type (causal / biddable / lexical), description, entities |
| 3. Shared-phenomena analysis | Confirmed domains | Phenomena with name, interacting domain pair, interaction type |
| 4. Requirement reference & constraint | Confirmed domains | Functional requirements linked to domains by *reference* or *constraint* |

Every request carries the confirmed model as context. A later stage therefore never re-discovers what an earlier stage established.


<img width="6656" height="4163" alt="工具图_01" src="https://github.com/user-attachments/assets/58768025-b82f-448c-8619-8e4bac190b84" />





---

## 📁 Repository Structure

```
Agent4PF/
├── System Requirements Description/   # Five bundled example scenarios
│   ├── PMS.txt      # Patient Monitoring System
│   ├── LWGCS.txt    # Irregular Sluice Gate Control System
│   ├── CGMS.txt     # Continuous Glucose Monitoring System
│   ├── SSCS.txt     # Sun-Seeking Control System
│   └── SHS.txt      # Smart Home System
└── code/
    ├── backend/
    │   ├── server.mjs           # HTTP server
    │   └── deepseek-agent.mjs   # LLM agent (prompts, JSON Schema, DeepSeek API calls)
    ├── frontend/
    │   ├── excalidraw-app/      # Web application
    │   └── packages/excalidraw/ # Excalidraw-based diagram canvas
    └── .env.local               # Environment configuration (see below)
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [Yarn](https://yarnpkg.com/) or npm (the frontend is Excalidraw-based, so Yarn is typical)
- An LLM API key (the backend agent is `deepseek-agent.mjs`, so a DeepSeek key is expected)

### 1. Clone

```bash
git clone https://github.com/Hongbin-Xiao/Agent4PF.git
cd Agent4PF/code
```

### 2. Configure the API key

Edit `code/.env.local` and set your own key. The variable names below are examples, so check the file for the actual names.

```bash
# code/.env.local
DEEPSEEK_API_KEY=your_api_key_here
# DEEPSEEK_BASE_URL=...   # optional
# PORT=...                # optional
```

> ⚠️ **Never commit real API keys.** Keep `.env.local` in `.gitignore` and use a placeholder in the repository.

### 3. Start the backend

```bash
cd backend
node server.mjs
```

### 4. Start the frontend

```bash
cd frontend
yarn install
yarn start        # or: yarn --cwd excalidraw-app start
```

Then open the printed local URL in your browser.

> The commands above follow standard Excalidraw and Node conventions. Adjust them to match the scripts in your `package.json`.

---

## 🖱️ Usage: A Modeling Session

1. **Input.** Paste a requirement description, or load one of the bundled scenarios from `System Requirements Description/`.
2. **Step 1: Boundary.** Review the boundary card (machine, external entities, interfaces). Edit labels, add a missed entity, reject it with a comment, or confirm it.
3. **Steps 2–4: Domains, phenomena, requirements.** Each step returns element cards. Confirming a card merges it into the model, and the diagram is redrawn immediately. Domains appear first, then shared phenomena connect them, and finally requirement references and constraints are added.
4. **Iterate.** Return to an earlier stage, revise it, and regenerate.
5. **Export.** Save the finished model as structured JSON and as an image.

---

## 🧩 Design: What Makes It Reviewable

1. **Structured candidates.** Schema-constrained output gives typed fields, so each candidate renders as an editable card and the model can be validated mechanically between steps.
2. **Stage granularity.** The analyst decides on one kind of PF construct at a time, which keeps each decision small.
3. **Incremental merging with comment-driven regeneration.** Nothing enters the model without confirmation, and a rejection leads to a targeted retry.

These choices follow three guidelines from Amershi et al.'s *Guidelines for Human–AI Interaction* (CHI 2019). Each stage announces what it will produce, correction is efficient, and the system never advances on its own.

---

## 📊 Evaluation Summary

We ran a study with **5 scenarios** and **20 participants** (10 experienced and 10 novice master's students). Each participant modeled every scenario twice, once manually and once with Agent4PF. Condition order was counterbalanced and scenario order was randomized.

| Group | Manual (avg.) | Agent4PF (avg.) | Speed-up | Time reduction |
|-------|--------------|-----------------|----------|----------------|
| Experienced | 14:11.28 | 2:50.28 | ~5.00× | **80.0%** |
| Novice | 33:42.68 | 4:35.00 | ~7.36× | **86.4%** |

<details>
<summary>Per-scenario times (mm:ss.ss)</summary>

| Scenario | Exp. Manual | Exp. Agent4PF | Novice Manual | Novice Agent4PF |
|----------|------------|---------------|---------------|-----------------|
| PMS   | 9:16.81  | 3:22.49 | 30:01.35 | 4:11.23 |
| LWGCS | 8:04.48  | 2:40.45 | 26:08.98 | 3:56.00 |
| CGMS  | 19:43.93 | 2:29.65 | 44:31.43 | 4:54.72 |
| SSCS  | 15:37.20 | 2:03.17 | 30:50.09 | 3:36.38 |
| SHS   | 18:13.98 | 3:35.66 | 37:01.57 | 6:16.69 |

</details>

### Limitations

- The study measures **time, not model quality**. We did not evaluate whether the confirmed diagrams are better or worse than hand-made ones.
- Participants were master's students rather than professional analysts.
- The scenarios come from textbook and embedded-software examples.

Measuring diagram correctness and comparing candidate LLMs are ongoing work.

---

## 👥 Intended Users

- **Requirements engineers** skip mechanical transcription and focus on modeling judgements.
- **Domain experts** correct candidate elements instead of drawing diagrams.
- **Teachers and students** get a stepwise, inspectable worked example for each of the four stages.
- **Researchers** can use the tool as a baseline for LLM-based modeling pipelines.

---

## 🗺️ Roadmap

- Improve the agent's identification of PF elements and their relationships
- Analyze and reduce the manual corrections analysts still need to make
- Extend the collaborative pattern to other requirements and graphical modeling tasks
- Evaluate the quality of the resulting models

---

## 📝 Citation

```bibtex
@inproceedings{agent4pf,
  title     = {Agent4PF: A Human--AI Collaborative Tool for Stepwise Problem Frames Modeling from Natural Language Requirements},
  author    = {Liu, Wanglong and Xiao, Hongbin and Tan, Shuru and Li, Zhi and Tang, Fei and Jin, Dongming},
  year      = {2026}
}
```

---

## 📬 Contact

- Hongbin Xiao — hongbinxiao@stu.gxnu.edu.cn
- Wanglong Liu — wanglongliu@stu.gxnu.edu.cn
- Zhi Li (corresponding author) — zhili@gxnu.edu.cn

Key Laboratory of Education Blockchain and Intelligent Technology (MOE), Guangxi Normal University, Guilin, China.

## 📄 License

Add your license here (e.g., MIT or Apache-2.0). The frontend builds on [Excalidraw](https://github.com/excalidraw/excalidraw), which is MIT-licensed, so keep its license notice.
