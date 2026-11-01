"""Generate methodology flowchart + ER diagram PNGs with PIL (no matplotlib)."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1400, 900


def _font(size):
    for name in ["arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _box(d, xy, text, fill=(235, 245, 255), outline=(30, 80, 160)):
    d.rectangle(xy, fill=fill, outline=outline, width=3)
    f = _font(26)
    x0, y0, x1, y1 = xy
    lines = text.split("\n")
    try:
        lh = f.getbbox("Ag")[3] + 8
    except Exception:
        lh = 34
    th = lh * len(lines)
    y = y0 + (y1 - y0 - th) // 2
    for ln in lines:
        try:
            tw = d.textlength(ln, font=f)
        except Exception:
            tw = len(ln) * 14
        d.text((x0 + (x1 - x0 - tw) // 2, y), ln, fill=(20, 20, 20), font=f)
        y += lh


def _arrow(d, x1, y1, x2, y2):
    d.line([x1, y1, x2, y2], fill=(30, 80, 160), width=3)
    s = 12
    if y2 > y1:  # down
        d.polygon([(x2, y2), (x2 - s, y2 - s), (x2 + s, y2 - s)], fill=(30, 80, 160))
    elif x2 > x1:  # right
        d.polygon([(x2, y2), (x2 - s, y2 - s), (x2 - s, y2 + s)], fill=(30, 80, 160))


def flowchart(path):
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    title = _font(34)
    d.text((60, 20), "DeployIQ Methodology Flow (Fig 4.1)", fill=(15, 40, 90), font=title)
    boxes = [
        ((60, 100, 340, 220), "Docker\nWatcher"),
        ((400, 100, 680, 220), "Evidence\nExtractor"),
        ((740, 100, 1020, 220), "BM25 Runbook\nRetrieval (RAG)"),
        ((60, 320, 340, 440), "LangGraph:\nevidence agent"),
        ((400, 320, 680, 440), "LangGraph:\nrag + root-cause"),
        ((740, 320, 1020, 440), "LangGraph:\nreport agent"),
        ((60, 540, 340, 660), "SQLite +\nSnapshots"),
        ((400, 540, 680, 660), "FastAPI\nREST API"),
        ((740, 540, 1020, 660), "React\nWorkbench UI"),
    ]
    for xy, t in boxes:
        _box(d, xy, t)
    # arrows row 1
    _arrow(d, 340, 160, 400, 160)
    _arrow(d, 680, 160, 740, 160)
    _arrow(d, 880, 220, 880, 320)
    # row 2 right-to-left flow visually: evidence->rag chain
    _arrow(d, 340, 380, 400, 380)
    _arrow(d, 680, 380, 740, 380)
    _arrow(d, 200, 440, 200, 540)
    _arrow(d, 340, 600, 400, 600)
    _arrow(d, 680, 600, 740, 600)
    # side note
    note = _font(24)
    d.text((1080, 100), "Free-model\nOpenRouter\nrouting\n(fallback +\nusage log)", fill=(80, 80, 80), font=note)
    d.text((1080, 540), "CI: Ruff +\npytest +\nvitest +\nE2E", fill=(80, 80, 80), font=note)
    img.save(path)


def er_diagram(path):
    img = Image.new("RGB", (W, 700), "white")
    d = ImageDraw.Draw(img)
    title = _font(34)
    d.text((60, 20), "DeployIQ Data Model — ER (Fig 4.2)", fill=(15, 40, 90), font=title)
    _box(d, (60, 100, 420, 420), "INCIDENT\nid (PK)\nproject_id\ntitle\nerror_signature\nstatus / severity\nfirst_seen\nlast_seen")
    _box(d, (520, 100, 920, 420), "INVESTIGATION\nid (PK)\nincident_id (FK)\nstatus\nrequested/actual model\nprompt_version\nresult JSON\nsnapshots JSON\ntokens, duration\ntimestamps")
    _box(d, (1000, 100, 1340, 420), "RUNBOOK\nrunbook_id (PK)\ntitle\nsections\nsource_urls\nBM25 index")
    _arrow(d, 420, 260, 520, 260)
    d.text((425, 225), "1 : N", fill=(30, 80, 160), font=_font(24))
    _arrow(d, 920, 200, 1000, 200)
    d.text((925, 165), "N : M\nretrieved", fill=(30, 80, 160), font=_font(24))
    foot = _font(24)
    d.text((60, 470), "Snapshots (evidence_snapshot, runbook_snapshot) freeze each attempt for audit + replay.", fill=(80, 80, 80), font=foot)
    d.text((60, 520), "Partial unique index allows only one active (pending/running) investigation per incident.", fill=(80, 80, 80), font=foot)
    img.save(path)


if __name__ == "__main__":
    flowchart("documentation/methodology_flowchart.png")
    er_diagram("documentation/er_diagram.png")
    print("diagrams done")
