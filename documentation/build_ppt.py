"""Build DeployIQ stage PPT."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor

BG = RGBColor(0x0F, 0x1B, 0x2D)
ACCENT = RGBColor(0x2E, 0xCC, 0x71)
LIGHT = RGBColor(0xE8, 0xF0, 0xFE)
MUTED = RGBColor(0x9A, 0xAD, 0xC2)

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)


def bg(slide):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = BG


def textbox(slide, left, top, width, height):
    return slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))


def add_text(slide, left, top, width, height, runs, align=PP_ALIGN.LEFT, size=20, bold=False, color=LIGHT):
    box = textbox(slide, left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    for i, (txt, b, c) in enumerate(runs):
        r = p.add_run() if i else p.add_run()
        # first paragraph already has a run; reuse it
        pass
    # simpler: clear and rebuild
    tf.clear()
    p = tf.paragraphs[0]
    p.alignment = align
    for txt, b, c in runs:
        r = p.add_run()
        r.text = txt
        r.font.size = Pt(size)
        r.font.bold = bold if b is None else b
        r.font.color.rgb = c or color
        r.font.name = "Arial"
    return box


def title_body(slide, title, bullets, num):
    bg(slide)
    add_text(slide, 0.7, 0.3, 11.9, 1.0, [(title, True, ACCENT)], size=34)
    box = textbox(slide, 0.7, 1.5, 11.9, 5.0)
    tf = box.text_frame
    tf.word_wrap = True
    for b in bullets:
        p = tf.add_paragraph() if len(tf.paragraphs[0].runs) or tf.paragraphs[0].text else tf.paragraphs[0]
        p.space_after = Pt(10)
        p.level = 0
        # support (head, rest) tuples
        if isinstance(b, tuple):
            r = p.add_run(); r.text = b[0]; r.font.size = Pt(20); r.font.bold = True; r.font.color.rgb = ACCENT; r.font.name = "Arial"
            r2 = p.add_run(); r2.text = b[1]; r2.font.size = Pt(20); r2.font.color.rgb = LIGHT; r2.font.name = "Arial"
        else:
            r = p.add_run(); r.text = "\u2022  " + b; r.font.size = Pt(20); r.font.color.rgb = LIGHT; r.font.name = "Arial"
    # page badge
    add_text(slide, 12.3, 6.8, 0.5, 0.4, [(str(num), True, RGBColor(255, 255, 255))], align=PP_ALIGN.CENTER, size=12)


slides_content = [
    ("Problem", [
        "Docker failures surface as long, noisy container logs under release pressure.",
        "Manual triage is slow; generic LLM advice hallucinates and cites nothing.",
        ("Need: ", "evidence-grounded RCA — every claim linked to logs + runbooks."),
    ]),
    ("Objectives", [
        "O1: Docker watching, normalization and incident grouping (SQLite + Alembic).",
        "O2: BM25 runbook retrieval with relevance + per-attempt snapshots.",
        "O3: LangGraph RCA on OpenRouter free models with fallback + validation.",
        "O4: React workbench — keyboard, focus, responsive, E2E-tested, green CI.",
    ]),
    ("Literature snapshot", [
        "Container monitoring (ELK/Prometheus): data, no causes.",
        "RAG (Lewis et al. 2020): grounding needs ranked retrieval + enforced citations.",
        "LangGraph agents: need evidence contracts, retries, cost guards.",
        "Dashboards: alerts yes; snapshot-scoped citations + approval flags rare.",
    ]),
    ("Architecture", [
        "Docker watcher \u2192 evidence extractor \u2192 BM25 runbooks \u2192 LangGraph (evidence\u2192RAG\u2192root-cause\u2192report).",
        "FastAPI REST + SQLite snapshots \u2192 React incident center + workbench.",
        "One logical LLM call + one fallback retry; dedup guard; token accounting.",
    ]),
    ("Results today (MVP M1–M3.3)", [
        "Backend: 97 pytest passed; Ruff clean; migrations 0001–0005.",
        "Frontend: 92 Vitest; typecheck + lint; build; 7 Playwright E2E green.",
        "Workbench: live regions, focus restore, reduced-motion, zero-overflow, retry.",
        "Ghost-ID cleanup keyed on successful refreshes; failures never counted.",
    ]),
    ("UI / motion inspiration (references, not dependencies)", [
        "driver.js: product-tour onboarding for the workbench demo.",
        "motionmaxxing + bang-motion: micro-interactions for status transitions.",
        "dimensional-drawing: architecture visual language for posters.",
        "papermorph / PaperBanana / learnharness: paper-to-story slide craft.",
        "openfilm + pentagi + mesh-avatar-studio: demo video + presenter avatar.",
    ]),
    ("Future scope", [
        "Live crashme demo (M3.3-E) + recorded walkthrough.",
        "Hybrid BM25 + pgvector retrieval, evaluated on real failures.",
        "Risk-score calibration + approval-gated remediation.",
        "Multi-project watch, alerting integrations, deployment packaging.",
    ]),
]

# Slide 1: title
s = prs.slides.add_slide(prs.slide_layouts[6])
bg(s)
add_text(s, 0.7, 1.2, 11.9, 1.2, [("DeployIQ — AI DevOps Copilot", True, ACCENT)], align=PP_ALIGN.CENTER, size=44)
add_text(s, 0.7, 2.6, 11.9, 0.8, [("Docker logs \u2192 evidence-grounded root-cause reports", False, LIGHT)], align=PP_ALIGN.CENTER, size=24)
add_text(s, 0.7, 3.8, 11.9, 1.6, [
    ("Shravan Mote (08)  \u2022  Bhushan Gosavi (37)  \u2022  Vijay Barhate (05)  \u2022  Sanskar Jadhav (50)\nGuide: Dr. Roohum Jegan  \u2022  Saraswati College of Engineering, Kharghar (2026–27)", False, MUTED),
], align=PP_ALIGN.CENTER, size=18)

n = 2
for title, bullets in slides_content[:5]:
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_body(s, title, bullets, n)
    n += 1

# Methodology image slide
s = prs.slides.add_slide(prs.slide_layouts[6])
bg(s)
add_text(s, 0.7, 0.3, 11.9, 1.0, [("Methodology flow", True, ACCENT)], size=34)
s.shapes.add_picture("documentation/methodology_flowchart.png", Inches(0.7), Inches(1.5), width=Inches(11.9), height=Inches(4.6))
add_text(s, 0.7, 6.3, 11.9, 0.5, [("Fig 4.1 — ingest, retrieve, reason, present, verify.", False, MUTED)], size=14)
add_text(s, 12.3, 6.8, 0.5, 0.4, [(str(n), True, RGBColor(255, 255, 255))], align=PP_ALIGN.CENTER, size=12)
n += 1

# ER image slide
s = prs.slides.add_slide(prs.slide_layouts[6])
bg(s)
add_text(s, 0.7, 0.3, 11.9, 1.0, [("Data model (ER)", True, ACCENT)], size=34)
s.shapes.add_picture("documentation/er_diagram.png", Inches(0.7), Inches(1.5), width=Inches(11.9), height=Inches(4.6))
add_text(s, 0.7, 6.3, 11.9, 0.5, [("Fig 4.2 — incidents 1:N investigations; snapshots frozen per attempt.", False, MUTED)], size=14)
add_text(s, 12.3, 6.8, 0.5, 0.4, [(str(n), True, RGBColor(255, 255, 255))], align=PP_ALIGN.CENTER, size=12)
n += 1

for title, bullets in slides_content[5:]:
    s = prs.slides.add_slide(prs.slide_layouts[6])
    title_body(s, title, bullets, n)
    n += 1

# Thank you
s = prs.slides.add_slide(prs.slide_layouts[6])
bg(s)
add_text(s, 0.7, 2.5, 11.9, 1.2, [("Thank you", True, ACCENT)], align=PP_ALIGN.CENTER, size=48)
add_text(s, 0.7, 3.8, 11.9, 0.8, [("Questions + live workbench demo", False, LIGHT)], align=PP_ALIGN.CENTER, size=24)

prs.save("documentation/DeployIQ_PPT.pptx")
print("ppt saved")
