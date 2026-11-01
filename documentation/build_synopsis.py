"""Build DeployIQ synopsis DOCX strictly per template + owner's fix list."""
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ACCENT = RGBColor(0x1F, 0x4E, 0x79)
TNR = "Times New Roman"

TEAM = [
    ("Shravan Mote", "08"),
    ("Bhushan Gosavi", "37"),
    ("Vijay Barhate", "05"),
    ("Sanskar Jadhav", "50"),
]
SUPERVISOR = "Dr. Roohum Jegan"
HOD = "Dr. Sujata Bhairnallykar"
COORD = "Prof. Ranjeeta Padlikar"
PRINCIPAL = "Dr. Manjusha Deshmukh"


def base_style(doc):
    st = doc.styles["Normal"]
    st.font.name = TNR
    st.font.size = Pt(12)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), TNR)
    pf = st.paragraph_format
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = 1.5
    pf.space_after = Pt(6)
    pf.space_before = Pt(0)
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    for i in (1, 2, 3):
        h = doc.styles[f"Heading {i}"]
        h.font.name = TNR
        h.font.size = Pt(14)
        h.font.bold = True
        h.font.color.rgb = RGBColor(0, 0, 0)
        h.element.rPr.rFonts.set(qn("w:eastAsia"), TNR)
        h.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        h.paragraph_format.line_spacing = 1.5
        h.paragraph_format.space_after = Pt(6)
        h.paragraph_format.space_before = Pt(12)
        h.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT


def para(doc, text, bold=False, size=12, align="justify", space_after=6, italic=False):
    p = doc.add_paragraph()
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    p.paragraph_format.line_spacing = 1.5
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(0)
    amap = {"justify": WD_ALIGN_PARAGRAPH.JUSTIFY, "center": WD_ALIGN_PARAGRAPH.CENTER,
            "left": WD_ALIGN_PARAGRAPH.LEFT, "right": WD_ALIGN_PARAGRAPH.RIGHT}
    p.alignment = amap.get(align, WD_ALIGN_PARAGRAPH.JUSTIFY)
    r = p.add_run(text)
    r.font.name = TNR
    r.font.size = Pt(size)
    r.bold = bold
    r.italic = italic
    r.font.color.rgb = RGBColor(0, 0, 0)
    return p


def heading(doc, text, level=1):
    h = doc.add_heading(level=level)
    h.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = h.add_run(text)
    r.font.name = TNR
    r.font.size = Pt(14)
    r.bold = True
    return h


def bullets(doc, items):
    for it in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        p.paragraph_format.line_spacing = 1.5
        p.paragraph_format.space_after = Pt(3)
        p.clear()
        r = p.add_run(it)
        r.font.name = TNR
        r.font.size = Pt(12)


def add_page_number(paragraph):
    pPr = paragraph._p.get_or_add_pPr()
    fld1 = OxmlElement("w:fldChar"); fld1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = "PAGE"
    fld2 = OxmlElement("w:fldChar"); fld2.set(qn("w:fldCharType"), "end")
    r = OxmlElement("w:r"); r.append(fld1)
    r2 = OxmlElement("w:r"); r2.append(instr)
    r3 = OxmlElement("w:r"); r3.append(fld2)
    paragraph._p.append(r); paragraph._p.append(r2); paragraph._p.append(r3)


def add_toc(doc):
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    fld1 = OxmlElement("w:fldChar"); fld1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\o "1-3" \\h \\z \\u'
    fld2 = OxmlElement("w:fldChar"); fld2.set(qn("w:fldCharType"), "separate")
    fld3 = OxmlElement("w:fldChar"); fld3.set(qn("w:fldCharType"), "end")
    for el in (fld1,):
        r = OxmlElement("w:r"); r.append(el); p._p.append(r)
    r = OxmlElement("w:r"); r.append(instr); p._p.append(r)
    r = OxmlElement("w:r"); r.append(fld2); p._p.append(r)
    r = OxmlElement("w:r"); r.append(fld3); p._p.append(r)
    para(doc, "Right-click > Update Field in MS Word to refresh page numbers.", size=10, italic=True)


def table(doc, rows, widths=None, header=True):
    t = doc.add_table(rows=1, cols=len(rows[0]))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for j, val in enumerate(rows[0]):
        hdr[j].text = ""
        p = hdr[j].paragraphs[0]
        r = p.add_run(val)
        r.font.name = TNR; r.font.size = Pt(12); r.bold = True
    for row in rows[1:]:
        cells = t.add_row().cells
        for j, val in enumerate(row):
            cells[j].text = ""
            p = cells[j].paragraphs[0]
            r = p.add_run(val)
            r.font.name = TNR; r.font.size = Pt(12)
    return t


doc = Document()
base_style(doc)
sec0 = doc.sections[0]
sec0.top_margin = Inches(1); sec0.bottom_margin = Inches(1)
sec0.left_margin = Inches(1.25); sec0.right_margin = Inches(1)
sec0.header_distance = Inches(0.5); sec0.footer_distance = Inches(0.5)

# ---------------- COVER ----------------
para(doc, "A PROJECT SYNOPSIS", bold=False, size=16, align="center", space_after=2)
para(doc, "ON", bold=False, size=12, align="center", space_after=2)
para(doc, "\u201c DeployIQ \u201d", bold=False, size=18, align="center", space_after=6)
para(doc, "Submitted in partial fulfilment of the requirements for the award of the degree of", size=12, align="center")
para(doc, "BACHELOR OF ENGINEERING IN COMPUTER ENGINEERING", bold=False, size=13, align="center")
para(doc, "Submitted by", bold=False, size=12, align="center")
for name, roll in TEAM:
    para(doc, f"{name}, {roll}", size=12, align="center", space_after=1)
para(doc, "Under the supervision of", size=12, align="center")
para(doc, SUPERVISOR, size=12, align="center")
para(doc, "Department of Computer Engineering", size=12, align="center")
para(doc, "Saraswati College of Engineering, Kharghar", size=12, align="center")
para(doc, "(Affiliated to University of Mumbai)", size=12, align="center")
para(doc, "(2026-27)", size=12, align="center")

# ---------------- VISION / OUTCOMES (compact, PO11 flows into Knowledge profile) ----------------
heading(doc, "Saraswati College of Engineering — Vision and Mission", level=1)
para(doc, "Vision: To be globally recognized as an autonomous institute in engineering education with an emphasis on academics, research and skill enhancement to create innovators and future leaders for industry and societal needs.", size=12)
bullets(doc, [
    "Mission 1: To provide theoretical and practical knowledge through quality teaching-learning to develop competent engineers.",
    "Mission 2: To create an ambience that facilitates research, entrepreneurship and collaborations leading to innovators and future leaders.",
    "Mission 3: To follow a student-centric approach that inculcates moral and ethical values with leadership for holistic development.",
])
heading(doc, "Department of Computer Engineering — Vision and Mission", level=1)
para(doc, "Vision: To become a globally competent graduate program and one of the leading institutions in computer engineering education and research.", size=12)
bullets(doc, [
    "Mission 1: To offer outstanding education with hands-on programming to meet industry and societal demands.",
    "Mission 2: To motivate research, innovation and entrepreneurship in computer engineering and allied fields.",
    "Mission 3: To provide an engaging learning environment that fosters creative thinking, problem-solving, team spirit and ethical conduct.",
])
heading(doc, "Programme Outcomes (PO1–PO12)", level=1)
bullets(doc, [
    "PO 1: Engineering knowledge — apply mathematics, science and engineering fundamentals to complex problems.",
    "PO 2: Problem analysis — identify, formulate and analyse complex engineering problems from literature.",
    "PO 3: Design/development of solutions — design systems meeting needs with regard to safety, sustainability and ethics.",
    "PO 4: Conduct investigations of complex problems — design experiments, analyse data, draw valid conclusions.",
    "PO 5: Modern tool usage — select and apply appropriate techniques and IT tools for engineering practice.",
    "PO 6: Engineer and society — assess societal, health, safety, legal and cultural impacts of solutions.",
    "PO 7: Ethics — apply ethical principles and professional responsibilities.",
    "PO 8: Individual and team work — function effectively as an individual and in multidisciplinary teams.",
    "PO 9: Communication — communicate effectively through reports, presentations and documentation.",
    "PO 10: Project management and finance — apply management principles to project work.",
    "PO 11: Life-long learning — engage in independent, life-long learning in evolving technologies.",
])
para(doc, "Knowledge and Attitude Profile (WK): WK1–WK4 cover mathematics, natural science, computing and engineering fundamentals; WK5–WK9 cover design, practice, society, ethics and project management. DeployIQ maps evidence-grounded RCA (WK3–WK4), tool usage (WK5–WK6) and validation (WK8) to these profiles.", size=12)
heading(doc, "Programme Specific Outcomes", level=1)
bullets(doc, [
    "PSO 1: Build production-grade full-stack systems with databases, APIs and automated testing.",
    "PSO 2: Apply AI/ML and retrieval techniques to domain problems with measurable evaluation.",
])

# ---------------- CERTIFICATE (fixed wording + spacing) ----------------
heading(doc, "Certificate", level=1)
para(doc, "[College Logo — left]                                          [Saraswati Logo — placed mid-right as per template]", size=10, italic=True, align="center")
para(doc, "This is to certify that the requirements for the synopsis report entitled \u201cDeployIQ\u201d have been successfully completed by the following students:", size=12)
for name, roll in TEAM:
    para(doc, f"{roll}\t{name}", size=12, space_after=1)
para(doc, "Sanskar Jadhav, 50", size=12, space_after=6)
para(doc, "In partial fulfilment of Sem-VII, Bachelor of Engineering in Computer Engineering of Saraswati College of Engineering, Kharghar during the academic year 2026-27.", size=12)
para(doc, "Project Guide: Dr. Roohum Jegan", size=12, align="right", space_after=1)
para(doc, "Head of Department: Dr. Sujata Bhairnallykar", size=12, align="right", space_after=1)
para(doc, "Principal: Dr. Manjusha Deshmukh", size=12, align="right", space_after=1)

# ---------------- APPROVAL + DECLARATION ----------------
heading(doc, "Project Report Approval Sheet", level=1)
para(doc, "Examiners: 1. ____________________  2. ____________________", size=12)
para(doc, "Place: Kharghar    Date: ____ / ____ / 2026-27", size=12)
heading(doc, "Declaration", level=1)
para(doc, "We declare that this written submission represents our ideas in our own words and where others' ideas or words have been included, we have adequately cited and referenced the original sources. We also declare that we have adhered to all principles of academic honesty and integrity and have not misrepresented, fabricated or falsified any idea, data, fact or source in our submission. We understand that any violation of the above will be cause for disciplinary action by the Institute and can also evoke penal action from the sources which have thus not been properly cited or from whom proper permission has not been taken when needed.", size=12)
for name, roll in TEAM:
    para(doc, f"({name}, {roll} — Signature: ___________)", size=12, space_after=1)

# ---------------- ABBREVIATIONS / FIGURES / TABLES ----------------
heading(doc, "List of Abbreviations", level=1)
para(doc, "Only abbreviations actually used in this synopsis are listed.", size=12, italic=True)
table(doc, [
    ["Abbreviation", "Meaning"],
    ["AI", "Artificial Intelligence"],
    ["API", "Application Programming Interface"],
    ["BM25", "Best Matching 25 (ranking function)"],
    ["CI/CD", "Continuous Integration / Continuous Delivery"],
    ["DB", "Database"],
    ["ER", "Entity Relationship"],
    ["LLM", "Large Language Model"],
    ["NLP", "Natural Language Processing"],
    ["RAG", "Retrieval-Augmented Generation"],
    ["RCA", "Root Cause Analysis"],
    ["REST", "Representational State Transfer"],
    ["UI", "User Interface"],
])
heading(doc, "List of Figures", level=1)
bullets(doc, ["Fig 4.1 — DeployIQ methodology flow.", "Fig 4.2 — DeployIQ data model (ER)."])
heading(doc, "List of Tables", level=1)
bullets(doc, ["Table 2.1 — Literature comparison.", "Table 4.1 — System modules and responsibilities."])

# ---------------- ABSTRACT ----------------
heading(doc, "Abstract", level=1)
para(doc, "DeployIQ is an AI DevOps copilot that converts raw Docker failure logs into evidence-grounded root-cause reports. A Docker watcher streams container logs, an evidence extractor normalizes exceptions and signatures, a BM25 retriever grounds the analysis in curated DevOps runbooks, and a LangGraph pipeline (evidence \u2192 RAG \u2192 root-cause \u2192 report) produces a structured RCA with findings, recommendations, verification steps and confidence. A React investigation workbench presents per-attempt snapshots, citations, runbook panels and model metadata with keyboard access and responsive layout. The backend uses FastAPI, SQLAlchemy, SQLite with Alembic migrations and OpenRouter free-model routing with fallbacks; CI enforces Ruff, pytest, TypeScript, oxlint, Vitest, build and Playwright E2E. The current MVP covers incident ingestion, RAG, agentic RCA and the dashboard workbench; next steps are live-demo hardening, evaluation on real failures and deployment readiness.", size=12)

# ---------------- TOC (field; update in Word) ----------------
heading(doc, "Table of Contents", level=1)
add_toc(doc)

# ---------------- MAIN SECTION: header DeployIQ from Chapter 1 ----------------
main = doc.add_section(WD_SECTION.NEW_PAGE)
main.top_margin = Inches(1); main.bottom_margin = Inches(1)
main.left_margin = Inches(1.25); main.right_margin = Inches(1)
main.header_distance = Inches(0.5); main.footer_distance = Inches(0.5)
main.header.is_linked_to_previous = False
main.footer.is_linked_to_previous = False
hp = main.header.paragraphs[0]
hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
hr = hp.add_run("DeployIQ")
hr.font.name = TNR; hr.font.size = Pt(10); hr.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
fp = main.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
fr = fp.add_run("Page ")
fr.font.name = TNR; fr.font.size = Pt(10)
add_page_number(fp)

# ---------------- CHAPTER 1 ----------------
heading(doc, "Chapter 1 — Introduction", level=1)
heading(doc, "1.1 General", level=2)
para(doc, "Modern services ship through Docker and CI/CD, yet failures still surface as long, noisy container logs. Developers triage manually: scrolling logs, recalling past runbooks and guessing root causes under release pressure. DeployIQ addresses this gap with an AI copilot that watches Docker output, extracts structured evidence, retrieves the most relevant runbooks and asks a language model to reason only over that grounded evidence. Every investigation freezes its evidence and runbook snapshots so results are auditable and replayable.")
heading(doc, "1.2 Problem Statement", level=2)
heading(doc, "1.2.1 Symptom noise", level=2)
para(doc, "Container logs mix tracebacks, retries and framework chatter. Without normalization, the same failure looks different on every run and simple keyword search misses the true signature.")
heading(doc, "1.2.2 Ungrounded AI advice", level=2)
para(doc, "Generic LLM answers hallucinate commands and cite missing sources. Operations teams cannot trust recommendations that are not tied to observed evidence and versioned runbooks.")
heading(doc, "1.3 Significance of the Study", level=2)
para(doc, "Evidence-grounded RCA reduces mean time to resolution, preserves institutional runbook knowledge, and makes AI assistance accountable: each finding links to evidence IDs and runbook IDs, each recommendation carries risk and approval flags, and each attempt records model, tokens and duration.")
heading(doc, "1.4 Scope of the Study", level=2)
para(doc, "In scope: Docker log monitoring, incident grouping by error signature, BM25 runbook retrieval, LangGraph RCA with OpenRouter free models, FastAPI services, React incident center and investigation workbench, SQLite persistence with Alembic, and CI-gated quality. Out of scope: automatic production remediation, multi-cloud orchestration and infinite log retention.")
heading(doc, "1.5 Summary", level=2)
para(doc, "This chapter introduced the operational pain of Docker failures, defined the grounding problem, and scoped DeployIQ as an evidence-first AI copilot. Chapter 2 reviews existing approaches.")

# ---------------- CHAPTER 2 ----------------
heading(doc, "Chapter 2 — Literature Review", level=1)
heading(doc, "2.1 General", level=2)
para(doc, "We survey four strands: container log monitoring, retrieval-augmented generation, agentic LLM workflows for operations, and RCA user interfaces. The goal is to position DeployIQ against dashboards that only display logs and chatbots that only generate text.")
heading(doc, "2.2 Literature Based on the Study", level=2)
table(doc, [
    ["Work / Tool", "What it does", "Limitation DeployIQ addresses"],
    ["Docker + ELK / Prometheus stacks", "Collect and chart container logs and metrics", "No causal reasoning; leaves triage to humans"],
    ["Lewis et al., RAG (2020)", "Grounds generation in retrieved passages", "General NLP; needs DevOps runbook corpus + BM25 tuning"],
    ["LangChain / LangGraph agents", "Compose multi-step LLM pipelines with state", "Needs evidence contracts, retries and cost guards for ops use"],
    ["OpenRouter free-model routing", "Aggregates hosted LLMs incl. free tiers", "Free tiers return null/strict-schema edge cases; needs fallback + accounting"],
    ["Incident dashboards (e.g., PagerDuty, Grafana)", "List alerts and timelines", "Citations, snapshots and approval-gated fixes are rare"],
])
para(doc, "Table 2.1 — Literature comparison.", size=11, italic=True, align="center")
heading(doc, "2.3 Summary from Literature Review", level=2)
bullets(doc, [
    "Monitoring gives data but not causes; RCA needs an explicit evidence contract.",
    "RAG improves trust only when retrieval is ranked (BM25) and citations are enforced.",
    "Agentic pipelines need bounded retries, usage accounting and terminal states (insufficient-evidence, validation-failed).",
    "Workbench UX needs keyboard access, focus management and snapshot-scoped citations — the focus of our frontend milestones.",
])

# ---------------- CHAPTER 3 ----------------
heading(doc, "Chapter 3 — Aim and Objectives", level=1)
heading(doc, "3.1 General", level=2)
para(doc, "Following the gaps in Chapter 2, DeployIQ aims to deliver a demonstrable, tested copilot: from Docker logs to a grounded RCA report with UI, persistence and CI — not a chatbot demo.")
heading(doc, "3.2 Aim of the Study", level=2)
para(doc, "To design and implement an evidence-grounded AI DevOps copilot that monitors Docker logs, retrieves relevant runbooks and produces auditable root-cause analyses through a tested web workbench.")
heading(doc, "3.3 Objectives of the Study", level=2)
bullets(doc, [
    "Objective 1: Implement Docker log watching, normalization and incident grouping with SQLite + Alembic persistence.",
    "Objective 2: Build BM25 runbook retrieval with relevance scoring and snapshot freezing per investigation.",
    "Objective 3: Implement the LangGraph RCA pipeline on OpenRouter free models with fallbacks, validation and token accounting.",
    "Objective 4: Deliver the React incident center and investigation workbench (keyboard access, focus, responsive, E2E-tested) under green CI.",
])

# ---------------- CHAPTER 4 ----------------
heading(doc, "Chapter 4 — Methodology", level=1)
heading(doc, "4.1 General", level=2)
para(doc, "Methodology follows the objectives in order: ingest, retrieve, reason, present, and verify. Each phase has an artifact and a test gate so failures are caught before the demo.")
heading(doc, "4.2 Methodology of the Study", level=2)
para(doc, "Docker watcher streams logs for configured projects, the extractor pulls exceptions and signatures, and incidents are grouped to avoid duplicates. For each investigation, BM25 ranks runbooks; LangGraph runs evidence \u2192 RAG \u2192 root-cause \u2192 report nodes with Pydantic validation, one logical LLM call plus at most one compatibility retry, and dedup guards. The React workbench polls active attempts, shares one clock for elapsed time, announces transitions politely, and scopes every citation to its own snapshot. Migrations (0001–0005) own the schema; CI runs Ruff, pytest, typecheck, oxlint, Vitest, build and Playwright.")
table(doc, [
    ["Module", "Responsibility"],
    ["collector/watch", "Docker log stream, signature grouping"],
    ["evidence/extractor", "Normalize exceptions, build evidence IDs"],
    ["rag/retriever", "BM25 rank runbooks, freeze runbook_snapshot"],
    ["agents/graph", "LangGraph pipeline + validation + fallback"],
    ["services/investigation", "Orchestrate, dedup, persist snapshots"],
    ["api/routes", "FastAPI REST for incidents/investigations"],
    ["frontend workbench", "History, citations, runbook panel, a11y"],
])
para(doc, "Table 4.1 — System modules and responsibilities.", size=11, italic=True, align="center")
doc.add_picture("documentation/methodology_flowchart.png", width=Inches(6))
para(doc, "Fig 4.1 — DeployIQ methodology flow: ingest, retrieve, reason, present, verify.", size=11, italic=True, align="center")
doc.add_picture("documentation/er_diagram.png", width=Inches(6))
para(doc, "Fig 4.2 — Data model: one incident to many investigations; runbooks linked N:M at retrieval time; snapshots frozen per attempt.", size=11, italic=True, align="center")
heading(doc, "4.3 Summary", level=2)
para(doc, "This chapter specified the phased methodology with flow and data views. Chapter 5 reports what the MVP achieves today.")

# ---------------- CHAPTER 5 ----------------
heading(doc, "Chapter 5 — Results and Discussion", level=1)
heading(doc, "5.1 General", level=2)
para(doc, "Results are reported against the objectives with the gates that prove them, followed by honest limits.")
heading(doc, "5.2 Implemented and Verified", level=2)
bullets(doc, [
    "Incident pipeline: Docker watcher, grouping, REST list/detail with observation counts.",
    "RAG: BM25 over curated runbooks with scores, matched sections and safe source links.",
    "Agentic RCA: LangGraph pipeline on OpenRouter free models; null/strict-schema fallbacks; token and duration accounting; terminal states for insufficient evidence and validation failures.",
    "Workbench: per-attempt cards, evidence/runbook snapshots, citation focus with reduced-motion respect, single live region, queued/running transparency, keyboard + Escape flows, responsive 1280/360 with zero-overflow, retry recovery — all E2E covered.",
    "Quality gates (latest): backend 97 passed + 1 skipped; frontend 92 Vitest; build; 7 Playwright E2E; green CI on the feature branch.",
])
heading(doc, "5.3 Discussion and Limits", level=2)
para(doc, "Free-model variance remains the main risk: strict JSON modes sometimes return null, handled by plain-JSON fallback and honest failure states. BM25 suffices for the curated corpus; dense vectors (pgvector) are future work. The pending-created cleanup now keys on successful refresh timestamps so ghost IDs expire even when data is unchanged, with failures never counted.")
heading(doc, "5.4 Summary", level=2)
para(doc, "The MVP meets its four objectives under test. Chapter 6 concludes and scopes future study.")

# ---------------- CHAPTER 6 ----------------
heading(doc, "Chapter 6 — Conclusion and Scope of Future Study", level=1)
heading(doc, "6.1 General", level=2)
para(doc, "This synopsis connected the Docker triage problem to an evidence-first copilot and showed a tested path from logs to grounded reports.")
heading(doc, "6.2 Conclusions", level=2)
bullets(doc, [
    "Conclusion 1: Evidence + runbook snapshots make AI RCA auditable and replayable.",
    "Conclusion 2: A small LangGraph pipeline with validation and free-model fallback is sufficient for structured RCA.",
    "Conclusion 3: Workbench accessibility (focus, announcements, keyboard, responsive) is a first-class correctness property, verified by tests.",
])
heading(doc, "6.3 Scope of Future Study", level=2)
bullets(doc, [
    "Live Docker Compose demo with crashme app and recorded M3.3-E walkthrough.",
    "Dense retrieval (pgvector) + hybrid BM25 evaluation on real failure corpus.",
    "Risk scoring calibration and approval-gated remediation actions.",
    "Multi-project watching, alerting integrations and deployment packaging.",
])
heading(doc, "6.4 Summary", level=2)
para(doc, "DeployIQ demonstrates that grounded, tested AI assistance beats generic chat for DevOps triage, and it leaves clear, measurable next steps.")

# ---------------- REFERENCES ----------------
heading(doc, "References", level=1)
bullets(doc, [
    "Lewis, P. et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. NeurIPS.",
    "LangChain / LangGraph documentation: stateful agent graphs and validation patterns.",
    "Docker documentation: container logs, Compose networking and Desktop usage.",
    "React, Vite, TanStack Query and Playwright documentation: workbench implementation and E2E.",
    "FastAPI, SQLAlchemy and Alembic documentation: API, ORM and migration workflow.",
    "OpenRouter documentation: free-model routing, response formats and usage accounting.",
])

# ---------------- DELIVERABLES ----------------
heading(doc, "Deliverables", level=1)
bullets(doc, [
    "D1: FastAPI backend with incident/investigation REST APIs and Alembic migrations 0001–0005.",
    "D2: Docker watcher + evidence extractor with incident grouping and demo crashme app.",
    "D3: BM25 runbook corpus with relevance scores and per-investigation snapshots.",
    "D4: LangGraph RCA pipeline (evidence, RAG, root-cause, report) on OpenRouter free models.",
    "D5: React incident center + investigation workbench (a11y, keyboard, responsive, E2E).",
    "D6: CI pipeline (Ruff, pytest, typecheck, oxlint, Vitest, build, Playwright) + green runs.",
    "D7: This synopsis and the stage PPT with methodology and data-model figures.",
])

# ---------------- ACK ----------------
heading(doc, "Acknowledgement", level=1)
para(doc, "After the completion of this work, words are not enough to express our feelings about all those who helped us reach our goal.", size=12)
para(doc, "It is a great pleasure and moment of immense satisfaction for us to express our profound gratitude to our Project Guide, Dr. Roohum Jegan, whose constant encouragement enabled us to work enthusiastically. Perpetual motivation, patience and excellent expertise in discussions during the progress of the project work have benefited us to an extent which is beyond expression. We also sincerely thank Dr. Sujata Bhairnallykar, Head of Department, and Prof. Ranjeeta Padlikar, Project Coordinator, Department of Computer Engineering, Saraswati College of Engineering, Kharghar, Navi Mumbai, for guidance, encouragement and support.", size=12)
para(doc, "We are thankful to Dr. Manjusha Deshmukh, Principal, Saraswati College of Engineering, Kharghar, Navi Mumbai, for providing an outstanding academic environment and adequate facilities.", size=12)
para(doc, "Last but not the least, we thank all staff of the Computer Engineering Department for valuable guidance and suggestions.", size=12)
for name, roll in TEAM:
    para(doc, f"{name}, {roll}", size=12, align="right", space_after=1)

doc.save("documentation/DeployIQ_synopsis_fixed.docx")
print("synopsis saved")
