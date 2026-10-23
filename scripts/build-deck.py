"""Builds the jury deck: docs/Business-Listing-Consistency-Agent-Jury-Deck.pptx
   python scripts/build-deck.py            (needs: pip install python-pptx pillow)
Every figure on the slides comes from this project's own docs/evidence or from a measured run
(see docs/deck/NOTES.md). Screenshots are in docs/deck/img/. Fonts: Cambria (titles) and Calibri (body).
"""
import os
from lxml import etree
from PIL import Image, ImageFont
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "docs", "deck", "img")
OUT = os.path.join(ROOT, "docs", "Business-Listing-Consistency-Agent-Jury-Deck.pptx")

# ── palette (same as the app) ──
def C(h): return RGBColor.from_string(h)
BG, CARD, INK, MUTED, LINE = "F4EEE3", "FBF8F1", "3A312A", "6A5E51", "E2D8C6"
OLIVE, OLIVE_D, OLIVE_S = "54733F", "3F5A2E", "DFEBD2"
CLAY, CLAY_S = "B8561F", "F4DCC8"
ROSE, ROSE_S = "9B2A38", "F7DADD"
SAND, DARK, CREAM, TAN = "EBE2CF", "2F2721", "FBF8F1", "E0B98F"
HEAD, BODY, MONO = "Cambria", "Calibri", "Consolas"

W, H = 13.333, 7.5
LM, CW = 0.6, 12.133

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
BLANK = prs.slide_layouts[6]
warnings = []

# ── real font metrics for overflow checks (Carlito/Caladea are metric-compatible with Calibri/Cambria) ──
_FD = "/usr/share/fonts/truetype/crosextra/"
_fonts = {}
def _font(name, bold, size):
    key = (name, bold, size)
    if key not in _fonts:
        f = {("Cambria", False): "Caladea-Regular.ttf", ("Cambria", True): "Caladea-Bold.ttf", ("Calibri", False): "Carlito-Regular.ttf", ("Calibri", True): "Carlito-Bold.ttf"}.get((name, bold), "Carlito-Regular.ttf")
        path = _FD + f
        _fonts[key] = ImageFont.truetype(path, int(size * 10)) if os.path.exists(path) else None
    return _fonts[key]

def _lines(text, name, bold, size, width_in):
    f = _font(name, bold, size)
    if f is None: return max(1, int(len(text) * size * 0.5 / (width_in * 72)) + 1)
    maxw = width_in * 72 * 10
    n = 0
    for para in text.split("\n"):
        cur = ""
        n += 1
        for word in para.split(" "):
            t = (cur + " " + word).strip()
            if f.getlength(t) <= maxw or not cur: cur = t
            else: n += 1; cur = word
    return n

# ── drawing helpers ──
def slide(bg=BG):
    s = prs.slides.add_slide(BLANK)
    s.background.fill.solid(); s.background.fill.fore_color.rgb = C(bg)
    return s

def rect(s, x, y, w, h, fill=CARD, line=LINE, lw=0.75, radius=0.06, dash=False, shape=None):
    sh = s.shapes.add_shape(shape or MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    if shape is None: sh.adjustments[0] = min(0.5, radius / max(0.01, min(w, h)) * 1.0) if radius else 0
    if fill: sh.fill.solid(); sh.fill.fore_color.rgb = C(fill)
    else: sh.fill.background()
    if line:
        sh.line.color.rgb = C(line); sh.line.width = Pt(lw)
        if dash: sh.line.dash_style = 4  # dash
    else: sh.line.fill.background()
    sh.shadow.inherit = False
    st = sh._element.find(qn("p:style"))
    if st is not None: sh._element.remove(st)
    return sh

def text(s, x, y, w, h, content, size=12, color=INK, bold=False, font=BODY, align="l", anchor="t", sp=0, line=1.0, bullet=False, check=True, spc=None):
    """content: str | list of paragraphs; a paragraph is str | list of runs; a run is str | (str, dict)."""
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = {"t": MSO_ANCHOR.TOP, "m": MSO_ANCHOR.MIDDLE, "b": MSO_ANCHOR.BOTTOM}[anchor]
    paras = content if isinstance(content, list) else [content]
    total = 0.0
    for i, p in enumerate(paras):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.alignment = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}[align]
        para.line_spacing = line
        if i < len(paras) - 1: para.space_after = Pt(sp)
        runs = p if isinstance(p, list) else [p]
        plain, psize, pbold, pfont = "", size, bold, font
        for r in runs:
            t, o = (r, {}) if isinstance(r, str) else r
            run = para.add_run(); run.text = t
            f = run.font; f.size = Pt(o.get("size", size)); f.bold = o.get("bold", bold); f.italic = o.get("italic", False)
            f.name = o.get("font", font); f.color.rgb = C(o.get("color", color))
            if spc: run._r.get_or_add_rPr().set("spc", str(spc))
            plain += t; psize = max(psize, o.get("size", size)) if o.get("size") else psize; pbold = pbold or o.get("bold", False)
        if bullet:
            pPr = para._p.get_or_add_pPr(); pPr.set("marL", str(int(Inches(0.17)))); pPr.set("indent", str(-int(Inches(0.17))))
            bu = etree.SubElement(pPr, qn("a:buChar")); bu.set("char", "•")
        wi = w - (0.17 if bullet else 0)
        total += _lines(plain, font if font in ("Cambria", "Calibri") else BODY, pbold, psize, wi) * psize * 1.2 * line / 72 + (sp / 72 if i < len(paras) - 1 else 0)
    if check and total > h + 0.02: warnings.append(f"  overflow: needs {total:.2f}in, box {h:.2f}in :: {str(paras[0])[:60]}")
    return tb

ALT = {"public-a": "Public listing page of site A (Listify), details match", "public-b": "Public page of CityPages showing Diwali as Closed", "public-c": "Public page of LocalLoop with phone and address written in a different format",
       "public-d": "Public page of NearbyNow with a different phone number", "public-e": "Public page of ShopFront showing Sunday as Closed",
       "approvals-top": "Approvals screen: a proposed fix with what the listing shows, what the record says, and the reason", "card-approve": "Approval card for the CityPages Diwali hours with Approve and Reject buttons",
       "flagged-card": "Flagged card for NearbyNow: listing claimed by another account, no edit attempted", "report": "Consistency table filtered to Verified: CityPages holiday and ShopFront hours verified",
       "trace-map": "Agent Trace map: applying, double-checking, all done, with the agent mascot"}
def img(s, name, x, y, w=None, h=None, border=True):
    path = os.path.join(IMG, name + ".jpg")
    iw, ih = Image.open(path).size
    if w and not h: h = w * ih / iw
    if h and not w: w = h * iw / ih
    pic = s.shapes.add_picture(path, Inches(x), Inches(y), Inches(w), Inches(h))
    pic._element.nvPicPr.cNvPr.set("descr", ALT.get(name, name))
    if border: pic.line.color.rgb = C(LINE); pic.line.width = Pt(0.75)
    return pic, w, h

def arrow(s, x1, y1, x2, y2, color=MUTED, w=1.75, dash=False, head=True):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = C(color); c.line.width = Pt(w)
    if dash: c.line.dash_style = 4
    if head:
        ln = c.line._get_or_add_ln(); t = etree.SubElement(ln, qn("a:tailEnd")); t.set("type", "triangle"); t.set("w", "med"); t.set("len", "med")
    return c

def notes(s, t): s.notes_slide.notes_text_frame.text = t

_n = [0]
def header(s, kicker, title):
    _n[0] += 1
    text(s, LM, 0.4, 9, 0.3, kicker, size=12, color=CLAY, bold=True, spc=140)
    text(s, LM, 0.72, CW, 0.75, title, size=28, color=INK, bold=True, font=HEAD, anchor="t")
    text(s, LM, 7.08, 8, 0.25, "Business Listing Consistency Agent  ·  Agentic AI Hackathon 2026", size=10, color=MUTED, check=False)
    text(s, W - LM - 1, 7.08, 1, 0.25, str(len(prs.slides)), size=10, color=MUTED, align="r", check=False)

def card(s, x, y, w, h, title=None, body=None, fill=CARD, line=LINE, tsize=14, bsize=12, tcolor=INK, bcolor=MUTED, pad=0.18, bullet=False, sp=3):
    rect(s, x, y, w, h, fill=fill, line=line)
    ty = y + pad
    if title:
        th = _lines(title, BODY, True, tsize, w - 2 * pad) * tsize * 1.2 / 72
        text(s, x + pad, ty, w - 2 * pad, th + 0.02, title, size=tsize, bold=True, color=tcolor)
        ty += th + 0.07
    if body: text(s, x + pad, ty, w - 2 * pad, y + h - ty - pad * 0.6, body, size=bsize, color=bcolor, bullet=bullet, sp=sp)

def table(s, x, y, colw, rows, rowh, head_fill=DARK, head_color=CREAM, size=11.5, first_bold=True, fills=None, colors=None):
    n, m = len(rows), len(colw)
    gs = s.shapes.add_table(n, m, Inches(x), Inches(y), Inches(sum(colw)), Inches(rowh * n))
    tbl = gs.table
    tblPr = tbl._tbl.tblPr
    for a in ("firstRow", "bandRow"): tblPr.set(a, "0")
    sid = tblPr.find(qn("a:tableStyleId"))
    if sid is None: sid = etree.SubElement(tblPr, qn("a:tableStyleId"))
    sid.text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"  # No Style, No Grid
    for j, cw in enumerate(colw): tbl.columns[j].width = Inches(cw)
    for i in range(n):
        tbl.rows[i].height = Inches(rowh)
        for j in range(m):
            cell = tbl.cell(i, j); val = rows[i][j]
            cell.margin_left = cell.margin_right = Inches(0.1); cell.margin_top = cell.margin_bottom = Inches(0.04)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = cell.text_frame; tf.word_wrap = True
            p = tf.paragraphs[0]; r = p.add_run(); r.text = val
            r.font.name = BODY; r.font.size = Pt(size)
            head = i == 0
            r.font.bold = head or (j == 0 and first_bold)
            r.font.color.rgb = C(head_color if head else (colors or {}).get((i, j), INK))
            if head: p.alignment = PP_ALIGN.LEFT
            fill = head_fill if head else (fills or {}).get((i, j), CARD if i % 2 else "F6F1E7")
            cell.fill.solid(); cell.fill.fore_color.rgb = C(fill)
            tcPr = cell._tc.get_or_add_tcPr()
            ln = etree.Element(qn("a:lnB"), w="9525", cap="flat", cmpd="sng", algn="ctr")
            sf = etree.SubElement(ln, qn("a:solidFill")); etree.SubElement(sf, qn("a:srgbClr")).set("val", LINE)
            etree.SubElement(ln, qn("a:prstDash")).set("val", "solid")
            tcPr.insert(0, ln)  # borders must precede the fill in tcPr
            if not head:
                lines = _lines(val, BODY, r.font.bold, size, colw[j] - 0.2)
                if lines * size * 1.2 / 72 + 0.08 > rowh + 0.01: warnings.append(f"  table cell tall ({lines} lines): {val[:50]}")
    return gs

# ═════════════════════════ 1. TITLE ═════════════════════════
s = slide(DARK)
text(s, 0.9, 1.15, 8, 0.3, "AGENTIC AI HACKATHON 2026  ·  BUSINESS & PRODUCTIVITY AI", size=12, color=TAN, bold=True, spc=140)
text(s, 0.9, 1.6, 8.2, 2.1, "Business Listing\nConsistency Agent", size=54, color=CREAM, bold=True, font=HEAD, line=0.95)
text(s, 0.9, 3.95, 7.6, 1.4, "One true record. Five listing sites. An agent that finds every mismatch, fixes only what you approve, and proves the fix went live.", size=20, color="E7D9C2", line=1.05)
pills = [("Listify", "Matches", OLIVE_S, OLIVE_D), ("CityPages", "Diwali shown as Closed", ROSE_S, ROSE), ("LocalLoop", "Same facts, different format", SAND, INK), ("NearbyNow", "Someone else's listing", CLAY_S, CLAY), ("ShopFront", "Sunday shown as Closed", ROSE_S, ROSE)]
for i, (a, b, bgc, fc) in enumerate(pills):
    y = 1.5 + i * 0.86
    rect(s, 9.2, y, 3.55, 0.68, fill=bgc, line=None, radius=0.12)
    text(s, 9.38, y + 0.08, 3.2, 0.25, a, size=12, bold=True, color=INK)
    text(s, 9.38, y + 0.34, 3.2, 0.28, b, size=12, color=fc, bold=True)
text(s, 0.9, 6.15, 11.8, 0.3, [[("Live demo  ", {"color": TAN, "bold": True}), "zirohacksub.onrender.com   ", ("demo PIN  ", {"color": TAN, "bold": True}), "7KQ4X-M9PHT   ", ("Repo  ", {"color": TAN, "bold": True}), "github.com/yourgrok/zirohacksub"]], size=13, color="E7D9C2")
text(s, 0.9, 6.55, 11.8, 0.3, "Fictional business (Sunrise Sweets & Bakery, Pune), mock listing sites, synthetic data only.", size=12, color="B8A88F")
notes(s, "Opening (20 s): Every local business lives on many listing sites, and the details drift apart. We built an agent that keeps them consistent, but only ever changes something after the owner approves it, and only reports success after it has reloaded the page and seen the value. Everything you see is a real run of the deployed app on a fictional bakery with mock listing sites.")

# ═════════════════════════ 2. ROADMAP ═════════════════════════
s = slide(); header(s, "OVERVIEW", "The seven things you asked us to show")
items = [("1", "The problem", "Five sites, five versions of one business.", "slides 3-4"),
         ("2", "Our solution", "Scan, review, apply, verify. The owner stays in charge.", "slides 5-6"),
         ("3", "The agentic AI", "A loop that reads, decides, acts, verifies and recovers.", "slides 7-8"),
         ("4", "Technical implementation", "Architecture, stack, data flow, platform integration, guardrails.", "slides 9-11"),
         ("5", "The innovation", "Why it is not a dashboard, a chatbot or a cron job.", "slide 12"),
         ("6", "The demonstration", "One scenario end to end, the result on screen, and the TC1-TC8 proof.", "slides 13-15"),
         ("7", "The impact", "Numbers we measured, scalability, honest limits, roadmap.", "slides 16-17")]
cw, ch, gap = 2.85, 2.05, 0.243
for i, (n, t, d, sl) in enumerate(items):
    x = LM + (i % 4) * (cw + gap); y = 1.85 + (i // 4) * (ch + 0.22)
    rect(s, x, y, cw, ch)
    text(s, x + 0.2, y + 0.12, 0.8, 0.6, n, size=34, color=CLAY, bold=True, font=HEAD)
    text(s, x + 0.2, y + 0.78, cw - 0.4, 0.3, t, size=15, bold=True)
    text(s, x + 0.2, y + 1.1, cw - 0.4, 0.62, d, size=12, color=MUTED)
    text(s, x + 0.2, y + 1.72, cw - 0.4, 0.22, sl, size=10, color=OLIVE, bold=True, check=False)
x = LM + 3 * (cw + gap); y = 1.85 + ch + 0.22
rect(s, x, y, cw, ch, fill=DARK, line=None)
text(s, x + 0.2, y + 0.18, cw - 0.4, 0.3, "TRY IT YOURSELF", size=11, color=TAN, bold=True, spc=100)
text(s, x + 0.2, y + 0.55, cw - 0.4, 1.4, ["zirohacksub.onrender.com", [("PIN  ", {"color": TAN}), "7KQ4X-M9PHT"], "2-minute video: docs/demo/demo.mp4"], size=12.5, color=CREAM, sp=5)
notes(s, "A map of the talk so the judges can tick their seven criteria as we go. The dark card has the live demo address and the synthetic demo PIN.")

# ═════════════════════════ 3. PROBLEM A ═════════════════════════
s = slide(); header(s, "1  ·  THE PROBLEM", "One bakery, five listing sites, five different stories")
tiles = [("a", "A · Listify", "Matches the record", OLIVE_S, OLIVE_D), ("b", "B · CityPages", "Diwali shown as Closed (record: 10:00-2:00)", ROSE_S, ROSE),
         ("c", "C · LocalLoop", "Phone and address written differently, same meaning", SAND, INK), ("d", "D · NearbyNow", "Other phone number; claimed by another account", ROSE_S, ROSE),
         ("e", "E · ShopFront", "Sunday shown as Closed (record: 10:00-2:00)", ROSE_S, ROSE)]
tw, tg = 2.3, 0.158
for i, (k, name, note, bgc, fc) in enumerate(tiles):
    x = LM + i * (tw + tg)
    text(s, x, 1.72, tw, 0.28, name, size=13, bold=True)
    _, w_, h_ = img(s, "public-" + k, x, 2.05, w=tw)
    rect(s, x, 2.05 + h_ + 0.1, tw, 0.72, fill=bgc, line=None, radius=0.08)
    text(s, x + 0.1, 2.05 + h_ + 0.17, tw - 0.2, 0.6, note, size=11.5, bold=True, color=fc, anchor="t")
y0 = 2.05 + 1.683 + 0.1 + 0.72 + 0.25
card(s, LM, y0, 5.6, 6.75 - y0, "What is a listing inconsistency?",
     "Any difference between what the owner means and what a listing site shows: name, address, phone or hours. Some are obvious (a wrong holiday). Some only a careful reader catches, and some look different but mean the same thing.", bsize=13.5)
card(s, 6.4, y0, 6.333, 6.75 - y0, "In our test bed (fictional bakery, Pune)",
     [[("Wrong holiday hours ", {"bold": True, "color": INK}), "on one site (B)"],
      [("Same facts, different format ", {"bold": True, "color": INK}), "(C): \"090000 00001\" equals \"+91 90000 00001\""],
      [("Stale phone ", {"bold": True, "color": INK}), "on a listing that another account has claimed (D)"],
      [("Regular hours differ ", {"bold": True, "color": INK}), "(E): Sunday listed as Closed"]], bsize=13, bullet=True, sp=5)
notes(s, "These are the five public pages for the same bakery, captured from the running app before anything is fixed. A matches. B says Diwali is closed. C writes the phone and address differently but means the same thing, so a smart tool must not 'fix' it. D shows a different phone and is claimed by someone else, so we are not even allowed to edit it. E says Sunday is closed. Five layouts, five formats, one business.")

# ═════════════════════════ 4. PROBLEM B ═════════════════════════
s = slide(); header(s, "1  ·  THE PROBLEM", "Why it matters, and why owners can't fix it by hand")
text(s, LM, 1.7, 5.6, 0.25, "WHY IT MATTERS", size=11, color=CLAY, bold=True, spc=120)
why = [("Customers are turned away", "A holiday or Sunday shown as Closed sends paying customers elsewhere. The reverse sends them to a locked door."),
       ("Calls go to the wrong number", "A stale phone number on one site means missed orders and a business that looks careless."),
       ("Conflicting details cost trust", "Every platform shows its own version of the business, and customers notice when versions disagree.")]
for i, (t, b) in enumerate(why):
    card(s, LM, 2.0 + i * 1.42, 5.6, 1.3, t, b, tsize=14.5, bsize=12.5)
text(s, 6.5, 1.7, 6.2, 0.25, "WHY OWNERS STRUGGLE", size=11, color=CLAY, bold=True, spc=120)
hard = [("Many sites, many formats", "Each site stores phones and hours its own way. We parse four different hours layouts."),
        ("Every change is repeated", "One new holiday means one edit per site, each with its own login and form."),
        ("Not every listing is yours", "A listing claimed by someone else cannot be edited. A bot must not try."),
        ("Edits do not always go live", "Moderation queues and dropped edits: \"saved\" is not the same as \"live\"."),
        ("Look-alike businesses", "\"Sunrise Sweet House\" sits next to our bakery. Editing the wrong one is worse than doing nothing."),
        ("Nobody checks afterwards", "Drift returns silently, so the cleanup never stays done.")]
for i, (t, b) in enumerate(hard):
    x = 6.5 + (i % 2) * 3.13; y = 2.0 + (i // 2) * 1.42
    card(s, x, y, 3.0, 1.3, t, b, tsize=13.5, bsize=12, pad=0.15)
rect(s, LM, 6.32, CW, 0.58, fill=DARK, line=None, radius=0.1)
text(s, LM + 0.25, 6.32, CW - 0.5, 0.58, "By hand it is slow and gets forgotten. Letting a bot edit freely is unsafe. The real problem is trust.", size=15, bold=True, color=CREAM, anchor="m")
notes(s, "Why it matters: wrong hours turn customers away, a wrong number loses orders, and conflicting details look careless. Why owners cannot just fix it: sites format things differently, every change is repeated per site, some listings belong to someone else, edits can sit in moderation or silently fail, look-alike businesses exist, and nobody re-checks afterwards. A script that edits freely would be dangerous, so the real problem is building automation an owner can trust.")

# ═════════════════════════ 5. SOLUTION A ═════════════════════════
s = slide(); header(s, "2  ·  OUR SOLUTION", "Tell us the truth once. The agent keeps every site honest.")
steps = [("1", "Scan", "Reads all five sites and compares meaning, not formatting: 25 field checks in about 150 ms."),
         ("2", "Review", "Every proposed fix is a card with a plain-English reason. You approve or reject each one."),
         ("3", "Apply", "Only approved changes are sent, and never to a listing you do not own."),
         ("4", "Verify", "The agent reloads the public page and marks VERIFIED only if the value is really there.")]
for i, (n, t, b) in enumerate(steps):
    y = 1.8 + i * 1.24
    rect(s, LM, y, 5.2, 1.12)
    rect(s, LM + 0.18, y + 0.28, 0.56, 0.56, fill=OLIVE, line=None, shape=MSO_SHAPE.OVAL)
    text(s, LM + 0.18, y + 0.28, 0.56, 0.56, n, size=20, bold=True, color=CREAM, font=HEAD, align="c", anchor="m", check=False)
    text(s, LM + 0.95, y + 0.12, 4.1, 0.3, t, size=15, bold=True)
    text(s, LM + 0.95, y + 0.44, 4.1, 0.62, b, size=12, color=MUTED)
_, w_, h_ = img(s, "approvals-top", 6.1, 1.8, w=6.63)
text(s, 6.1, 1.8 + h_ + 0.08, 6.63, 0.25, "Approvals: what the site shows versus what your record says, and why.", size=11, color=MUTED, check=False)
cy = 1.8 + h_ + 0.5
rect(s, 6.1, cy, 6.63, 6.9 - cy)
text(s, 6.3, cy + 0.15, 6.2, 0.3, "Your record is the single source of truth", size=14.5, bold=True)
px = 6.3
for lab, wd in [("Name", 0.85), ("Address", 1.05), ("Phone", 0.95), ("Weekly hours", 1.45), ("Holidays", 1.15)]:
    rect(s, px, cy + 0.6, wd, 0.36, fill=SAND, line=None, radius=0.18)
    text(s, px, cy + 0.6, wd, 0.36, lab, size=11.5, bold=True, color=OLIVE_D, align="c", anchor="m", check=False)
    px += wd + 0.1
text(s, 6.3, cy + 1.12, 6.2, 0.7, "Five kinds of fact, one place. Nothing reaches a listing until you approve it.", size=12.5, color=MUTED)
notes(s, "The product in one line: you tell us the truth once, and the agent keeps every site honest. Four steps. Scan reads every site and compares by meaning. Review shows a card per fix with a plain reason, as in the screenshot. Apply sends only what you approved. Verify reloads the page and only then says verified. The scan of five sites and twenty-five field checks took about 150 milliseconds in our measured runs on the local mock sites.")

# ═════════════════════════ 6. SOLUTION B ═════════════════════════
s = slide(); header(s, "2  ·  OUR SOLUTION", "Who it helps, and what changes for them")
text(s, LM, 1.7, 4.2, 0.25, "WHO IT HELPS", size=11, color=CLAY, bold=True, spc=120)
who = [("Busy owners of local shops", "Bakeries, clinics, salons: no time to check five sites, no SEO team."),
       ("Owners with more than one business", "Each business has its own PIN and fully separate data."),
       ("New owners", "The agent finds where you are already listed and adds you where you are missing, after you approve.")]
for i, (t, b) in enumerate(who):
    card(s, LM, 2.0 + i * 1.62, 4.2, 1.5, t, b, tsize=15, bsize=13)
rows = [["", "Today, by hand", "With the agent"],
        ["Find mismatches", "Open each site and compare by eye", "One scan reads every site and every field"],
        ["Same meaning, other format", "Easy to miss, or to \"fix\" needlessly", "Compared by meaning; formatting-only differences are ignored"],
        ["Fix them", "Log in to each site and retype", "Review cards and approve; only approved changes are sent"],
        ["Know it worked", "Hope the site saved it", "Reloads the live page; moderation shows as pending"],
        ["Owner effort in our demo", "Edit 2 sites by hand, re-check all 5", "3 clicks: Scan, Approve all, Apply"],
        ["Stay consistent", "A one-off cleanup", "Repeatable scans and holiday alerts"]]
fills = {(i, 2): OLIVE_S for i in range(1, 7)}
table(s, 5.1, 1.7, [2.0, 2.55, 3.08], rows, 0.72, size=12, fills=fills)
notes(s, "Who it helps: busy owners of local shops first, owners who run several businesses (each has a separate PIN and separate data), and new owners, where the agent finds existing listings and adds the business where it is missing after approval. The table is the process change: from open each site and compare by eye, to one scan, approve, and automatic verification. In our demo scenario the owner does three clicks: Scan, Approve all, Apply. If a site moderates edits, one more click re-checks it.")

# ═════════════════════════ 7. AGENTIC A ═════════════════════════
s = slide(); header(s, "3  ·  THE AGENTIC AI", "A goal-driven loop, not a chat box")
rect(s, LM, 1.7, CW, 0.62, fill=SAND, line=None, radius=0.1)
text(s, LM + 0.25, 1.7, CW - 0.5, 0.62, [[("Goal  ", {"bold": True, "color": CLAY}), "every listing says what the owner's record says. The owner approves; the agent does the legwork and proves the result."]], size=14, anchor="m")
stages = [("1  Perceive", "Reads each public page and owner dashboard. Raw values are kept.", "read_listing, normalise"),
          ("2  Decide", "Compares meaning per field and picks the next tool from the current state.", "compare, planner"),
          ("3  Act", "Proposes a fix, flags a listing, asks the owner, or applies what was approved.", "propose, flag_listing, apply_approved"),
          ("4  Verify", "Reloads the page. VERIFIED only if the approved value is really there.", "reload_and_verify"),
          ("5  Recover", "Page changed? Site down? Edit dropped? Re-ask, retry, or re-send once.", "same tools, new decision")]
sw, sg = 2.25, 0.22
for i, (t, b, tl) in enumerate(stages):
    x = LM + i * (sw + sg)
    rect(s, x, 2.6, sw, 1.95)
    text(s, x + 0.15, 2.7, sw - 0.3, 0.3, t, size=15, bold=True, color=OLIVE_D)
    text(s, x + 0.15, 3.05, sw - 0.3, 0.95, b, size=11.5, color=MUTED)
    text(s, x + 0.15, 4.08, sw - 0.3, 0.42, tl, size=9.5, color=CLAY, font=MONO, check=False)
    if i < 4: arrow(s, x + sw + 0.01, 3.5, x + sw + sg - 0.01, 3.5, color=OLIVE, w=2)
lx1, lx2, ly = LM + 4 * (sw + sg) + sw / 2, LM + 1 * (sw + sg) + sw / 2, 4.82
arrow(s, lx1, 4.55, lx1, ly, color=OLIVE, w=1.75, head=False); arrow(s, lx1, ly, lx2, ly, color=OLIVE, w=1.75, head=False); arrow(s, lx2, ly, lx2, 4.57, color=OLIVE, w=1.75)
text(s, lx2 + 0.3, ly + 0.04, 5, 0.25, "loops until nothing is left to do", size=10.5, color=MUTED, check=False)
rect(s, LM, 5.2, 7.7, 1.7)
text(s, LM + 0.2, 5.28, 7, 0.26, "EIGHT TOOLS, ONE REGISTRY", size=10.5, bold=True, color=CLAY, spc=100)
tools = [("read_listing", "page + dashboard"), ("normalise", "E.164, address, hours"), ("compare", "meaning per field"), ("propose", "one card per fix"),
         ("apply_approved", "approved rows only"), ("reload_and_verify", "checks the live page"), ("flag_listing", "not ours: no write"), ("ask_owner", "asks for approval")]
for i, (n, d) in enumerate(tools):
    x = LM + 0.2 + (i % 4) * 1.82; y = 5.58 + (i // 4) * 0.66
    rect(s, x, y, 1.72, 0.6, fill=BG, line=LINE, radius=0.06)
    text(s, x + 0.08, y + 0.06, 1.58, 0.25, n, size=10.5, bold=True, color=OLIVE_D, font=MONO, check=False)
    text(s, x + 0.08, y + 0.32, 1.58, 0.25, d, size=10, color=MUTED, check=False)
card(s, 8.5, 5.2, 4.233, 1.7, "Who decides each step?",
     "A rules planner (default, no key needed) or an optional Gemini planner. Same tools, same guardrails. Each trace row carries a badge: Gemini, Deterministic, Fallback or Blocked.", tsize=14, bsize=12)
notes(s, "What makes it agentic: it has a goal, not a script. Each step it looks at the current state of every site, chooses one of eight tools, acts, checks the result, and loops until nothing is left to do. Perceive, decide, act, verify, recover. The decision-maker is pluggable: a rules planner by default, or Gemini if a key is configured. Both use the same tool registry and the same guardrails, and every step is written to a trace with a badge saying who decided.")

# ═════════════════════════ 8. AGENTIC B ═════════════════════════
s = slide(); header(s, "3  ·  THE AGENTIC AI", "From plain-language request to verified result")
cols = [("Interprets requests", ["Typed text becomes an intent: a question, a detail edit or a closure date.", "chrono-node plus rules turn \"26th December\" into Sat 26 Dec 2026 (IST).", "Unclear input gets exactly one clarifying question.", "Optional Gemini cross-checks the reading; if it disagrees, the owner chooses.", "Nothing is saved before Confirm."], "\"closed on 26th December\"  >  Action: Closed, Date: Sat 26 Dec 2026"),
        ("Selects tools", ["Each step the planner sees the tool list, the record and every site's state.", "Nothing read yet: read_listing. Then normalise, then compare.", "Owner's listing differs: propose. Permission denied: flag_listing (forced in code).", "Approved rows: apply_approved.", "An unsafe pick is blocked and the rules choose instead."], "Rogue planner test: 6 unsafe picks, 6 blocked, 0 writes"),
        ("Runs multi-step workflows", ["Scan phase reads and proposes. Execute phase applies and verifies.", "One closure request fans out to every site (TC5: 3 verified, 1 flagged, 1 pending moderation).", "27 tool calls for the TC1 holiday fix, each a visible trace row.", "Every run ends with a short \"what I did and why\" briefing."], "TC1: MISMATCH > PROPOSED > APPROVED > APPLIED > VERIFIED"),
        ("Verifies and recovers", ["Reloads and compares. \"Saved\" is never trusted.", "Moderated site: PENDING_MODERATION until the page really changes (TC4).", "Page changed after approval: sends nothing, asks again with the new facts (TC7).", "Site down: retries. Edit dropped: re-sent once, then verified (TC8)."], "TC8: outage retried, lost write re-sent, VERIFIED")]
cw4, g4 = 2.9, 0.177
for i, (t, bl, ex) in enumerate(cols):
    x = LM + i * (cw4 + g4)
    rect(s, x, 1.7, cw4, 4.5)
    rect(s, x, 1.7, cw4, 0.5, fill=OLIVE, line=None, radius=0.06)
    text(s, x + 0.15, 1.7, cw4 - 0.3, 0.5, t, size=14, bold=True, color=CREAM, anchor="m")
    text(s, x + 0.15, 2.32, cw4 - 0.3, 2.95, bl, size=11.5, color=INK, bullet=True, sp=5)
    rect(s, x + 0.12, 5.35, cw4 - 0.24, 0.72, fill=SAND, line=None, radius=0.06)
    text(s, x + 0.2, 5.38, cw4 - 0.4, 0.66, ex, size=10.5, color=OLIVE_D, bold=True, font=BODY, anchor="m")
rect(s, LM, 6.33, CW, 0.62, fill=CLAY_S, line=None, radius=0.08)
text(s, LM + 0.2, 6.33, CW - 0.4, 0.62, [[("Honest note  ", {"bold": True, "color": CLAY}), "The default decision-maker is a rules planner. The Gemini planner is optional and falls back to rules on 429, timeout or invalid JSON; it is covered by 12 mocked-client tests, and no live Gemini run is in our evidence set (no key in the build environment)."]], size=10.5, color=INK, anchor="m")
notes(s, "Four things the judges asked about. How it interprets requests: the Edit and Ask box turns text into an intent, resolves dates with chrono-node, asks exactly one clarifying question when unclear, and saves nothing until Confirm. How it selects tools: every step it looks at the state and picks a tool, and code blocks unsafe picks. How it runs multi-step workflows: scan then execute, fanning one request out to every site. How it verifies and recovers: reload and compare, wait on moderation, re-ask if the page changed after approval, retry outages and re-send a dropped edit once. Be upfront: the default planner is rules-based; Gemini is optional and tested with a mocked client.")

# ═════════════════════════ 9. TECH A (architecture) ═════════════════════════
s = slide(); header(s, "4  ·  TECHNICAL IMPLEMENTATION", "One service: console, agent, readers, five mock platforms")
rect(s, LM, 2.45, 2.55, 3.4)
text(s, LM + 0.15, 2.55, 2.25, 0.3, "Owner's browser", size=14, bold=True, color=OLIVE_D)
text(s, LM + 0.15, 2.87, 2.25, 0.3, "React 19 + Vite console", size=11, color=MUTED)
text(s, LM + 0.15, 3.3, 2.25, 2.5, ["PIN-only login", "Nine sections: details, sites, approvals, consistency, edit & ask, change log, agent trace, holidays, add business", "Step bar: Scan, Review, Apply", "Agent Trace map"], size=11, bullet=True, sp=4)
rect(s, 3.55, 1.7, 5.6, 5.1, fill=SAND, line=LINE)
text(s, 3.75, 1.78, 5.2, 0.3, "Node 22 service  ·  Express 5  ·  TypeScript", size=13, bold=True, color=INK)
inner = [("API + auth", "PIN-only login (HMAC), sessions, every call scoped to one business", 3.72, 2.2), ("Agent core", "loop · planner · guardrail · 8 tools · verifier", 6.4, 2.2),
         ("Owner-facing intelligence", "intent parser · holiday foresight · score-matched onboarding", 3.72, 4.0), ("SQLite", "field states · audit log · trace · change log (Zod-validated)", 6.4, 4.0)]
for t, b, x, y in inner:
    rect(s, x, y, 2.6, 1.6, fill=CARD, line=LINE)
    text(s, x + 0.15, y + 0.12, 2.3, 0.3, t, size=13, bold=True, color=OLIVE_D)
    text(s, x + 0.15, y + 0.5, 2.3, 1.05, b, size=12, color=MUTED)
rect(s, 3.72, 5.8, 5.28, 0.78, fill=CARD, line=LINE)
text(s, 3.87, 5.84, 5.0, 0.7, [[("Evidence runner  ", {"bold": True, "color": OLIVE_D}), "TC1-TC8 on a fresh reset, 295 tests, before/after CSV, trace and audit reports"]], size=11, color=MUTED, anchor="m")
arrow(s, 3.15, 4.0, 3.55, 4.0, color=OLIVE, w=2.25); arrow(s, 3.55, 4.3, 3.15, 4.3, color=OLIVE, w=2.25)
text(s, 3.0, 3.62, 0.7, 0.3, "HTTPS", size=9.5, color=MUTED, align="c", check=False)
rect(s, 9.75, 1.95, 2.98, 1.15)
text(s, 9.9, 2.03, 2.7, 0.3, "Readers", size=13, bold=True, color=OLIVE_D)
text(s, 9.9, 2.36, 2.7, 0.7, "Playwright (optional) with an HTTP + cheerio fallback", size=11, color=MUTED)
rect(s, 9.75, 3.5, 2.98, 2.4)
text(s, 9.9, 3.58, 2.7, 0.3, "Five mock platforms", size=13, bold=True, color=OLIVE_D)
text(s, 9.9, 3.92, 2.7, 1.9, ["Listify · CityPages · LocalLoop · NearbyNow · ShopFront", "Public page, owner dashboard and edit API on each", "Different markup, hours formats, ownership and moderation", "/mock/admin: moderator queue"], size=11, color=MUTED, bullet=True, sp=3)
rect(s, 9.75, 6.1, 2.98, 0.7, fill=CARD, line=OLIVE, dash=True)
text(s, 9.9, 6.14, 2.7, 0.62, [[("Gemini (optional)  ", {"bold": True, "color": OLIVE_D}), "Interactions API"]], size=11, color=MUTED, anchor="m")
arrow(s, 9.15, 2.5, 9.75, 2.5, color=OLIVE, w=2.25); arrow(s, 11.24, 3.1, 11.24, 3.5, color=OLIVE, w=2.25)
arrow(s, 9.15, 6.45, 9.75, 6.45, color=OLIVE, w=1.75, dash=True)
text(s, 9.17, 2.15, 0.6, 0.3, "read +", size=9.5, color=MUTED, check=False); text(s, 9.17, 2.55, 0.6, 0.3, "write", size=9.5, color=MUTED, check=False)
notes(s, "This is the real architecture, not a diagram of aspirations. One deployable Node service. The React console talks to an Express API over HTTPS. Behind it: auth, the agent core with its loop, planner, guardrail, eight tools and verifier, the owner-facing intelligence, and SQLite for field states, audit, trace and change log. Readers fetch pages with Playwright or a plain HTTP fallback, from five mock listing platforms that deliberately differ in markup, hours format, ownership and moderation. Gemini is an optional side connection.")

# ═════════════════════════ 10. TECH B ═════════════════════════
s = slide(); header(s, "4  ·  TECHNICAL IMPLEMENTATION", "Stack, data flow and how it talks to listing platforms")
stack = [("Language", "TypeScript end to end, Node 22"), ("Server", "Express 5, Zod 4 validation"), ("Console", "React 19 + Vite, served by Express"), ("Data", "SQLite (better-sqlite3, node:sqlite fallback)"),
         ("Readers", "Playwright, plus fetch + cheerio"), ("Language tools", "chrono-node for dates"), ("LLM (optional)", "@google/genai, Interactions API"), ("Quality", "Vitest: 295 tests, 24 files"), ("Deploy", "Docker, Render free tier, /health")]
rect(s, LM, 1.75, 3.7, 5.05)
text(s, LM + 0.2, 1.85, 3.3, 0.28, "STACK", size=11, bold=True, color=CLAY, spc=120)
text(s, LM + 0.2, 2.2, 3.3, 4.55, [[(a + "  ", {"bold": True, "color": OLIVE_D}), b] for a, b in stack], size=12.5, sp=10)
flow = ["Owner record (SQLite) is the source of truth", "Read each public page and dashboard; keep raw values", "Normalise: E.164 phone, tidy address, parse hours", "Compare meaning per field", "Propose: one card per mismatch", "Owner approves: DB row becomes APPROVED", "Apply: read-before-write, idempotent", "Reload and verify: VERIFIED, PENDING or MISMATCH", "Report: trace, audit log, change log, CSV"]
rect(s, 4.5, 1.75, 4.2, 5.05)
text(s, 4.7, 1.85, 3.8, 0.28, "DATA FLOW OF A RUN", size=11, bold=True, color=CLAY, spc=120)
for i, f in enumerate(flow):
    y = 2.22 + i * 0.5
    rect(s, 4.7, y + 0.03, 0.3, 0.3, fill=OLIVE, line=None, shape=MSO_SHAPE.OVAL)
    text(s, 4.7, y + 0.03, 0.3, 0.3, str(i + 1), size=10, bold=True, color=CREAM, align="c", anchor="m", check=False)
    text(s, 5.12, y, 3.4, 0.46, f, size=11.5, anchor="m")
rect(s, 8.9, 1.75, 3.833, 5.05)
text(s, 9.1, 1.85, 3.4, 0.28, "INTEGRATING WITH PLATFORMS", size=11, bold=True, color=CLAY, spc=120)
integ = ["One reader per site turns four different hours layouts into one weekly schedule", "Every read asserts the page's listing ID equals the registered ID; look-alike listings are never read as ours", "Writes use each site's dashboard API with server-signed credentials; permission denied becomes a flag, never an edit", "Edit accepted but page unchanged and queued: PENDING_MODERATION", "Real platforms would need their own APIs and consent flows; we do not claim that yet"]
text(s, 9.1, 2.22, 3.45, 4.5, integ, size=12, bullet=True, sp=9)
notes(s, "The stack is deliberately boring and testable: TypeScript everywhere, Express, React and Vite, SQLite, Zod for validation, Playwright with an HTTP fallback, chrono-node for dates, and the Google GenAI Interactions API as an optional extra. The middle column is the data flow of one run, from the owner's record to the report. The right column is how it integrates with listing platforms: per-site readers, identity assertions so look-alikes are never touched, dashboard APIs for writes with permission handling, and moderation awareness. We are explicit that real platforms need their own APIs and consent flows.")

# ═════════════════════════ 11. TECH C ═════════════════════════
s = slide(); header(s, "4  ·  TECHNICAL IMPLEMENTATION", "Safety is enforced in code, not in prompts")
def sbox(x, y, label, fill=SAND, color=INK, w=1.25):
    rect(s, x, y, w, 0.6, fill=fill, line=LINE, radius=0.08)
    text(s, x + 0.04, y, w - 0.08, 0.6, label, size=9.5, bold=True, color=color, align="c", anchor="m", check=False)
xs = [LM + i * 1.5 for i in range(5)]
labels = [("MISMATCH", SAND, INK), ("PROPOSED", SAND, INK), ("APPROVED", OLIVE_S, OLIVE_D), ("APPLIED", SAND, INK), ("VERIFIED", OLIVE, CREAM)]
for x, (l, f, c) in zip(xs, labels): sbox(x, 2.2, l, f, c)
for i, t in enumerate(["agent proposes", "owner only", "agent sends", "verifier only"]):
    arrow(s, xs[i] + 1.26, 2.5, xs[i + 1] - 0.01, 2.5, color=OLIVE, w=2)
    text(s, xs[i] + 0.75, 1.82, 1.25, 0.3, t, size=9.5, color=CLAY, bold=True, align="c", check=False)
sbox(xs[0], 3.8, "FLAGGED_NOT_OWNER", ROSE_S, ROSE, w=1.55); arrow(s, xs[0] + 0.62, 2.8, xs[0] + 0.62, 3.78, color=ROSE, w=1.75)
sbox(xs[1] + 0.25, 3.8, "REJECTED", SAND); arrow(s, xs[1] + 0.62, 2.8, xs[1] + 0.62, 3.78, color=MUTED, w=1.75)
sbox(xs[3] - 0.2, 3.8, "PENDING_MODERATION", CLAY_S, CLAY, w=1.7); arrow(s, xs[3] + 0.62, 2.8, xs[3] + 0.62, 3.78, color=CLAY, w=1.75)
arrow(s, xs[3] + 1.5, 3.95, xs[4] + 0.62, 2.82, color=OLIVE, w=1.75)
text(s, xs[0], 4.48, 1.55, 0.45, "permission denied: no write", size=10, color=ROSE, bold=True, check=False)
text(s, xs[1] + 0.25, 4.48, 1.25, 0.45, "owner rejects", size=10, color=MUTED, bold=True, check=False)
text(s, xs[3] - 0.2, 4.48, 2.7, 0.45, "queued, page unchanged; VERIFIED after moderator and reload", size=10, color=CLAY, bold=True, check=False)
text(s, LM, 5.05, 7.5, 0.5, "Entering APPROVED requires the actor \"owner\"; entering VERIFIED requires the actor \"verifier\". Enforced in src/core/states.ts and unit-tested.", size=11, color=MUTED)
card(s, LM, 5.6, 7.5, 1.3, "Isolation and secrets",
     ["One business can never read another's data: a session-scoped business ID is required on every call; foreign IDs answer 404.", "PINs are never stored (HMAC-SHA256, constant-time compare, rate-limited). The API key never reaches git, logs, /health or the trace."], tsize=13, bsize=10.5, bullet=True, sp=2)
rect(s, 8.4, 1.75, 4.333, 5.15)
text(s, 8.6, 1.85, 3.9, 0.28, "GUARDRAILS IN CODE", size=11, bold=True, color=CLAY, spc=120)
text(s, 8.6, 2.22, 3.95, 3.0, ["No apply without a DB row the owner approved", "Permission denied forces flag_listing", "Only the verifier can mark VERIFIED, after a reload", "Pending moderation is never reported as fixed", "Decoy listings are never read as ours or edited", "Re-running never double-applies"], size=12.5, bullet=True, sp=9)
rect(s, 8.6, 5.25, 3.93, 1.5, fill=DARK, line=None, radius=0.08)
text(s, 8.8, 5.32, 3.55, 0.6, "6 / 6", size=32, bold=True, color=CREAM, font=HEAD)
text(s, 8.8, 5.95, 3.55, 0.75, "unsafe actions blocked by a scripted rogue planner: 0 writes, 0 false VERIFIED", size=11.5, color="E7D9C2")
notes(s, "The safety story is code, not prompt engineering. Each field moves through a state machine. Only the owner can approve, only the verifier can mark verified, and a listing we do not own can only be flagged. We tested the guardrails with a scripted rogue planner that tried six unsafe things: apply without approval, apply unapproved fields, verify without applying, touch the look-alike, flag an editable listing. All six were blocked, zero writes reached any site. Business isolation and PIN handling are enforced and tested the same way.")

# ═════════════════════════ 12. INNOVATION ═════════════════════════
s = slide(); header(s, "5  ·  THE INNOVATION", "Not a dashboard, not a chatbot, not a cron job")
rows = [["", "Typical dashboard", "Typical chatbot", "Typical rule-based sync", "Our agent"],
        ["Compares meaning, not formatting", "No", "Partly", "No", "Yes"],
        ["Knows who owns a listing and refuses to edit it", "Partly", "No", "No", "Yes"],
        ["Reloads the page to prove the edit went live", "No", "No", "No", "Yes"],
        ["Tells \"pending moderation\" from \"done\"", "No", "No", "No", "Yes"],
        ["Explains every step it took (trace)", "No", "Partly", "No", "Yes"],
        ["Recovers when a page changes or a site is down", "No", "No", "Partly", "Yes"],
        ["Looks ahead (holiday alerts)", "No", "No", "Partly", "Yes"]]
colors, fills = {}, {}
for i in range(1, 8):
    for j in range(1, 5):
        v = rows[i][j]; colors[(i, j)] = OLIVE_D if v == "Yes" else (CLAY if v == "Partly" else MUTED)
    fills[(i, 4)] = OLIVE_S
table(s, LM, 1.7, [4.0, 1.95, 1.95, 2.15, 2.083], rows, 0.4, size=12, colors=colors, fills=fills)
text(s, LM, 4.98, CW, 0.22, "Compared with typical tools in each category, not with specific products. \"Partly\" means possible, or only if configured.", size=10, color=MUTED, check=False)
calls = [("Verify-after-write", "A field becomes VERIFIED only when the reloaded public page shows the approved value."),
         ("Ownership-aware", "Claimed by someone else? No edit is attempted, and a claim request is drafted for the owner."),
         ("Finds you among look-alikes", "Score = phone 40 + address 35 + name 25. The look-alike scores 37.7, the real listing 100."),
         ("Looks ahead, speaks plainly", "Holiday alerts at 30, 14 and 7 days. \"Closed on 26th December\" becomes a previewed, approved change.")]
for i, (t, b) in enumerate(calls):
    x = LM + i * 3.077
    rect(s, x, 5.3, 2.9, 1.58, fill=SAND, line=None, radius=0.08)
    text(s, x + 0.15, 5.4, 2.6, 0.3, t, size=13.5, bold=True, color=OLIVE_D)
    text(s, x + 0.15, 5.76, 2.6, 1.1, b, size=12, color=INK)
notes(s, "Why this is different. A dashboard shows values and leaves all the work to you. A chatbot can talk about listings but has no tools, no ownership checks and no proof. A rule-based sync pushes data and assumes it worked. Our agent compares by meaning, knows when a listing is not ours, reloads the page to prove the edit is live, distinguishes pending moderation from done, explains every step, recovers when the world changes, and looks ahead to holidays. The comparison is against typical tools in each category, not specific products.")

# ═════════════════════════ 13. DEMO (scenario) ═════════════════════════
s = slide(); header(s, "6  ·  THE DEMONSTRATION", "End to end: holiday hours fixed, a stranger's listing left alone")
story = [("1", "Scan", "Five sites read in about 150 ms: 2 fixes proposed, 1 listing claimed by someone else, 2 format-only ignored."),
         ("2", "Review", "CityPages lists Diwali as Closed; the record says 10:00-2:00. The card says why, and you decide."),
         ("3", "Safety", "NearbyNow is claimed by another account: zero edits, and a claim request is drafted for you."),
         ("4", "Apply", "Only approved changes are sent. Every step lands in the trace; each page is reloaded."),
         ("5", "Moderate", "ShopFront queues the edit. It stays PENDING until its moderator approves; a re-check then verifies it."),
         ("6", "Report", "Before/after table: 2 fixed and verified, 1 needs you, 2 ignored. CSV export.")]
for i, (n, t, b) in enumerate(story):
    y = 1.75 + i * 0.78
    rect(s, LM, y, 4.95, 0.72)
    rect(s, LM + 0.12, y + 0.17, 0.38, 0.38, fill=OLIVE, line=None, shape=MSO_SHAPE.OVAL)
    text(s, LM + 0.12, y + 0.17, 0.38, 0.38, n, size=13, bold=True, color=CREAM, font=HEAD, align="c", anchor="m", check=False)
    text(s, LM + 0.65, y + 0.06, 4.2, 0.62, [[(t + "  ", {"bold": True, "color": OLIVE_D, "size": 13}), b]], size=10.5, color=INK, anchor="m")
_, w1, h1 = img(s, "card-approve", 5.85, 1.75, w=6.88)
text(s, 5.85, 1.75 + h1 + 0.06, 6.88, 0.25, "Step 2, Review: the card shows both values and the reason.", size=11, color=MUTED, check=False)
y2 = 1.75 + h1 + 0.5
_, w2, h2 = img(s, "flagged-card", 5.85, y2, w=6.88)
text(s, 5.85, y2 + h2 + 0.06, 6.88, 0.25, "Step 3, Safety: not our listing, so no edit is attempted and the manual steps are spelled out.", size=11, color=MUTED, check=False)
rect(s, LM, 6.55, CW, 0.38, fill=DARK, line=None, radius=0.08)
text(s, LM + 0.2, 6.55, CW - 0.4, 0.38, "Watch the 2-minute video: docs/demo/demo.mp4   ·   Try it live: zirohacksub.onrender.com   ·   demo PIN 7KQ4X-M9PHT", size=11.5, color=CREAM, anchor="m", bold=True, check=False)
notes(s, "Walk through the scenario, ideally live. Press Scan: the agent reads five sites and tells you what it found, two fixes, one listing claimed by someone else, two formatting-only differences it ignores. Review: CityPages lists Diwali as closed, and the card explains why that matters. NearbyNow belongs to another account, so the agent makes no edit and drafts a claim request instead. Approve and Apply: only approved changes are sent and the pages are reloaded. ShopFront has a moderation queue, so the edit stays pending until the moderator approves, then a re-check verifies it. The report shows the before and after table with a CSV export. There is a two-minute video of exactly this flow.")

# ═════════════════════════ 14. DEMO (result on screen) ═════════════════════════
s = slide(); header(s, "6  ·  THE DEMONSTRATION", "The result on screen: verified, pending or flagged")
_, w1, h1 = img(s, "report", LM, 1.75, w=8.4)
text(s, LM, 1.75 + h1 + 0.06, 8.4, 0.25, "Consistency table, filtered to Verified: both fixes were confirmed by reloading the page.", size=11, color=MUTED, check=False)
card(s, 9.2, 1.75, 3.53, h1 + 0.31, "How to read it",
     ["Verified: the reloaded page shows the approved value", "Pending: the site's moderator has not approved yet", "Flagged: not your listing, nothing was sent"], tsize=13.5, bsize=11.5, bullet=True, sp=4)
y2 = 1.75 + h1 + 0.65
_, w2, h2 = img(s, "trace-map", LM, y2, w=6.6)
text(s, LM, y2 + h2 + 0.06, 6.6, 0.25, "Agent Trace: the route of the run, step by step.", size=11, color=MUTED, check=False)
card(s, 7.45, y2, 5.28, h2 + 0.31, "Agent Trace: every step, in order",
     ["Each row names the tool, who decided (Gemini, Deterministic, Fallback or Blocked), what it found and how long it took", "Verification is a visible step: Applying, then Double-checking, then All done", "Blocked actions show in red with the reason", "The little agent follows your pointer along the route"], tsize=13.5, bsize=11.5, bullet=True, sp=4)
notes(s, "This is what the owner sees when the run is finished. The Consistency table is the before and after report, here filtered to Verified: CityPages and ShopFront were both fixed and confirmed by reloading the live page. The legend explains the three outcomes: verified, pending a moderator, or flagged because the listing is not ours. Below, the Agent Trace shows every step in order with a badge for who decided it, so nothing the agent did is hidden.")

# ═════════════════════════ 15. PROOF ═════════════════════════
s = slide(); header(s, "6  ·  THE DEMONSTRATION", "What the run proves: TC1 to TC8 pass from a fresh reset")
tc = [["Test case", "Actual result"],
      ["TC1  Holiday hours differ on one site", "MISMATCH > PROPOSED > APPROVED > APPLIED > VERIFIED; 1 write"],
      ["TC2  Phone formatted differently", "FORMAT_ONLY_EQUIVALENT; 0 proposals, 0 writes"],
      ["TC3  Listing claimed by someone else", "FLAGGED_NOT_OWNER; 0 write attempts"],
      ["TC4  Edit pending moderation", "... PENDING_MODERATION > VERIFIED after moderator and reload"],
      ["TC5  Plain-language closure", "3 VERIFIED, 1 FLAGGED_NOT_OWNER, 1 PENDING_MODERATION"],
      ["TC6  Foresight alert, no exception", "\"Bhai Dooj (11 Nov 2026) is in 21 days and has no opening-hours exception\""],
      ["TC7  Listing changes after approval", "Nothing sent; asked again with the new facts, then VERIFIED"],
      ["TC8  Site down, then drops an edit", "Outage retried; lost write re-sent once; VERIFIED"]]
table(s, LM, 1.75, [3.2, 4.4], tc, 0.52, size=11, fills={(i, 1): CARD for i in range(1, 9)})
stats = [("8 / 8", "official test cases pass from a fresh reset"), ("295", "automated tests pass across 24 files"), ("6 / 6", "unsafe actions blocked in the rogue-planner test, with 0 writes")]
for i, (a, b) in enumerate(stats):
    y = 1.75 + i * 1.45
    rect(s, 8.5, y, 4.233, 1.3, fill=SAND, line=None, radius=0.08)
    text(s, 8.7, y + 0.08, 3.8, 0.7, a, size=34, bold=True, color=OLIVE_D, font=HEAD, check=False)
    text(s, 8.7, y + 0.8, 3.85, 0.48, b, size=12, color=INK)
rect(s, 8.5, 6.1, 4.233, 0.8, fill=CARD)
text(s, 8.68, 6.1, 3.9, 0.8, [[("Re-run it yourself  ", {"bold": True, "color": OLIVE_D}), "open /tests, press Run all"]], size=11.5, anchor="m")
text(s, LM, 6.55, 7.6, 0.4, "Deterministic run with the date pinned to 21 Oct 2026; each test starts from a fresh reset. The Gemini run needs an API key and is not part of this evidence.", size=10, color=MUTED)
notes(s, "This is the evidence behind the demo. The eight official test cases each start from a fresh reset and record input, expected and actual results. TC1 is the holiday fix, TC2 proves we ignore formatting-only differences, TC3 proves zero write attempts on a listing we do not own, TC4 proves pending moderation is never reported as fixed. TC5 to TC8 cover plain-language closures, holiday foresight, a page that changes after approval, and an outage with a dropped edit. All eight pass, alongside 295 automated tests. Anyone can open the test page in the demo and press Run all.")

# ═════════════════════════ 16. IMPACT ═════════════════════════
s = slide(); header(s, "7  ·  THE IMPACT", "Value we can measure today, and where it scales")
nums = [("about 150 ms", "full scan: 5 sites x 5 fields = 25 checks (local mock sites; three runs: 139-156 ms)"), ("3 clicks", "owner effort in the demo: Scan, Approve all, Apply"), ("0", "unapproved writes, decoy edits or false VERIFIED in the tests"),
        ("8 / 8", "official test cases pass from a fresh reset"), ("6 / 6", "unsafe actions blocked in the rogue-planner test"), ("295", "automated tests pass")]
for i, (a, b) in enumerate(nums):
    x = LM + (i % 3) * 4.115; y = 1.72 + (i // 3) * 1.4
    rect(s, x, y, 3.9, 1.3)
    text(s, x + 0.2, y + 0.1, 3.5, 0.6, a, size=28, bold=True, color=OLIVE_D, font=HEAD, check=False)
    text(s, x + 0.2, y + 0.72, 3.5, 0.55, b, size=11, color=MUTED)
cols3 = [("Practical value", ["Hours saved on every holiday change, and no more wrong-hours surprises", "Safe by design: no write without approval, none to listings you do not own", "Owners get proof (VERIFIED, trace, CSV), not promises"]),
         ("Scalability", ["Each new platform is one more reader; the mock sites already differ in markup, formats and rules", "Work per scan grows with sites x fields (25 checks today)", "Every business is isolated by a session-scoped ID; one Docker service on a free host"]),
         ("Future potential", ["Real platform APIs and consent flows; OTP and phone checks stay with a human", "Scheduled scans and alerts when drift returns", "More fields (categories, photos, menus) and a multi-location view"])]
for i, (t, bl) in enumerate(cols3):
    x = LM + i * 4.115
    rect(s, x, 4.65, 3.9, 2.25, fill=SAND, line=None, radius=0.08)
    text(s, x + 0.2, 4.75, 3.5, 0.3, t, size=14.5, bold=True, color=OLIVE_D)
    text(s, x + 0.2, 5.13, 3.55, 1.75, bl, size=11.5, color=INK, bullet=True, sp=4)
notes(s, "Impact, with numbers we actually measured. A full scan of five sites and twenty-five field checks takes about 150 milliseconds on the local mock sites, so this excludes real-world network latency. In the demo the owner does three clicks. Eight of eight test cases and 295 automated tests pass; the rogue planner could not get a single write through. Scalability: each platform is another reader, work per scan grows with sites times fields, and each business is isolated by a session-scoped ID. The future: real platform APIs with consent flows, scheduled scans, and more fields. We do not claim production traffic numbers; we have none.")

# ═════════════════════════ 17. LIMITS & ROADMAP ═════════════════════════
s = slide(); header(s, "7  ·  THE IMPACT", "What is real today, and what comes next")
card(s, LM, 1.75, 5.95, 2.95, "Real and tested today",
     ["Scan, approve, apply, verify across five mock platforms", "Ownership flags, moderation handling, retries and re-planning (TC1-TC8)", "PIN-only login, per-business isolation, score-matched onboarding", "Plain-language edits and questions, holiday foresight", "Trace, change log and CSV evidence; 295 tests", "Deployed demo on a free host (first load can take 30-60 s)"], fill=OLIVE_S, line=None, tsize=15, tcolor=OLIVE_D, bcolor=INK, bsize=13, bullet=True, sp=6)
card(s, 6.78, 1.75, 5.953, 2.95, "Mocked or not built yet",
     ["The platforms are mock sites; real ones need their own APIs and consent flows", "Claiming a listing is mocked (no OTP). On real sites that step stays human: the agent never automates OTP or CAPTCHA", "Festival dates must be confirmed by the owner (approximate calendar)", "No live Gemini run in the evidence (no key in the build environment)", "A lost PIN cannot be recovered; no phone verification yet"], fill=CLAY_S, line=None, tsize=15, tcolor=CLAY, bcolor=INK, bsize=13, bullet=True, sp=6)
text(s, LM, 4.95, CW, 0.28, "NEXT STEPS", size=11, bold=True, color=CLAY, spc=120)
nxt = [("1", "A real platform adapter with its consent flow"), ("2", "Scheduled scans and drift alerts"), ("3", "PIN recovery and phone verification as a human step"), ("4", "More fields and a multi-location view")]
for i, (n, t) in enumerate(nxt):
    x = LM + i * 3.077
    rect(s, x, 5.3, 2.9, 1.55)
    text(s, x + 0.15, 5.38, 0.5, 0.7, n, size=34, bold=True, color=CLAY, font=HEAD, check=False)
    text(s, x + 0.7, 5.5, 2.1, 1.3, t, size=14, bold=True)
notes(s, "We would rather be honest than impressive. What is real: the full loop on five mock platforms, ownership and moderation handling, recovery, isolated businesses, onboarding, plain-language edits and holiday foresight, all covered by tests. What is not: real platforms, which need their own APIs and consent flows; OTP, which stays a human step; a calendar of approximate festival dates; and a live Gemini run, because the build environment had no key. Next steps: a real platform adapter, scheduled scans, PIN recovery and phone verification, and more fields.")

# ═════════════════════════ 18. CLOSING ═════════════════════════
s = slide(DARK)
text(s, 0.9, 1.3, 11.5, 0.3, "IN ONE SENTENCE", size=12, color=TAN, bold=True, spc=140)
text(s, 0.9, 1.75, 11.3, 1.9, "An agent you can trust near your public listings.", size=44, bold=True, color=CREAM, font=HEAD, line=0.98)
pts = [("Safe by construction", "No write without approval, none to listings you do not own."), ("Proven", "TC1-TC8, 295 tests, plus trace and CSV evidence."), ("Ready to try", "Live demo, a 2-minute video and the open repo.")]
for i, (a, b) in enumerate(pts):
    x = 0.9 + i * 3.95
    rect(s, x, 4.0, 3.7, 1.3, fill="3A3029", line=None, radius=0.08)
    text(s, x + 0.2, 4.1, 3.3, 0.3, a, size=15, bold=True, color=TAN)
    text(s, x + 0.2, 4.5, 3.3, 0.75, b, size=12.5, color="E7D9C2")
text(s, 0.9, 5.75, 11.8, 0.9, [[("Live demo  ", {"color": TAN, "bold": True}), "zirohacksub.onrender.com    ", ("demo PIN  ", {"color": TAN, "bold": True}), "7KQ4X-M9PHT (synthetic)"], [("Video  ", {"color": TAN, "bold": True}), "docs/demo/demo.mp4    ", ("Repo  ", {"color": TAN, "bold": True}), "github.com/yourgrok/zirohacksub"]], size=14, color="E7D9C2", sp=6)
text(s, 0.9, 6.7, 6, 0.4, "Thank you. Questions?", size=20, bold=True, color=CREAM, font=HEAD)
notes(s, "Close: safe by construction, proven by evidence, ready to try. Invite the judges to open the live demo, log in with the synthetic demo PIN, press Scan, and watch the agent work. Then take questions.")

prs.save(OUT)
print("saved", OUT, "-", len(prs.slides), "slides")
if warnings:
    print("LAYOUT WARNINGS:"); print("\n".join(warnings))
else:
    print("no overflow warnings")
