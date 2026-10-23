"""Builds the 10-slide jury deck: docs/Business-Listing-Consistency-Agent-Jury-Deck.pptx
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
    text(s, LM, 0.36, 9, 0.3, kicker, size=13, color=CLAY, bold=True, spc=140)
    text(s, LM, 0.68, CW, 0.7, title, size=30, color=INK, bold=True, font=HEAD, anchor="t")
    text(s, LM, 7.08, 8, 0.25, "Business Listing Consistency Agent  ·  Agentic AI Hackathon 2026", size=11, color=MUTED, check=False)
    text(s, W - LM - 1, 7.08, 1, 0.25, str(len(prs.slides)), size=11, color=MUTED, align="r", check=False)

def card(s, x, y, w, h, title=None, body=None, fill=CARD, line=LINE, tsize=17, bsize=14.5, tcolor=INK, bcolor=MUTED, pad=0.18, bullet=False, sp=3):
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
text(s, 0.9, 1.15, 8, 0.3, "AGENTIC AI HACKATHON 2026  ·  BUSINESS & PRODUCTIVITY AI", size=13, color=TAN, bold=True, spc=140)
text(s, 0.9, 1.6, 8.2, 2.1, "Business Listing\nConsistency Agent", size=56, color=CREAM, bold=True, font=HEAD, line=0.95)
text(s, 0.9, 3.95, 7.7, 1.5, "One true record. Five listing sites. An agent that finds every mismatch, fixes only what you approve, and proves the fix went live.", size=22, color="E7D9C2", line=1.05)
pills = [("Listify", "Matches", OLIVE_S, OLIVE_D), ("CityPages", "Diwali shown as Closed", ROSE_S, ROSE), ("LocalLoop", "Same facts, different format", SAND, INK), ("NearbyNow", "Someone else's listing", CLAY_S, CLAY), ("ShopFront", "Sunday shown as Closed", ROSE_S, ROSE)]
for i, (a, b, bgc, fc) in enumerate(pills):
    y = 1.4 + i * 0.9
    rect(s, 9.2, y, 3.55, 0.74, fill=bgc, line=None, radius=0.12)
    text(s, 9.38, y + 0.08, 3.2, 0.28, a, size=13, bold=True, color=INK)
    text(s, 9.38, y + 0.38, 3.2, 0.3, b, size=13, color=fc, bold=True)
text(s, 0.9, 6.05, 11.8, 0.35, [[("Live demo  ", {"color": TAN, "bold": True}), "zirohacksub.onrender.com    ", ("demo PIN  ", {"color": TAN, "bold": True}), "7KQ4X-M9PHT    ", ("Repo  ", {"color": TAN, "bold": True}), "github.com/yourgrok/zirohacksub"]], size=14, color="E7D9C2")
text(s, 0.9, 6.5, 11.8, 0.3, "Fictional business (Sunrise Sweets & Bakery, Pune), mock listing sites, synthetic data only.", size=12, color="B8A88F")
notes(s, "Opening (20 s): Every local business lives on many listing sites, and the details drift apart. We built an agent that keeps them consistent, but only changes something after the owner approves it, and only reports success after it has reloaded the page and seen the value. Everything you will see is a real run of the deployed app on a fictional bakery with mock listing sites. We will cover: the problem, our solution, the agentic AI, the technical implementation, the innovation, a demonstration and the impact.")

# ═════════════════════════ 2. PROBLEM ═════════════════════════
s = slide(); header(s, "1  ·  THE PROBLEM", "One bakery, five listing sites, five different stories")
text(s, LM, 1.36, CW, 0.4, "A listing inconsistency is any difference between what the owner means and what a site shows: name, address, phone or hours.", size=15, color=MUTED)
tiles = [("a", "A · Listify", "Matches the record", OLIVE_S, OLIVE_D), ("b", "B · CityPages", "Diwali shown as Closed (record: 10:00-2:00)", ROSE_S, ROSE),
         ("c", "C · LocalLoop", "Phone and address written differently, same meaning", SAND, INK), ("d", "D · NearbyNow", "Other phone number; claimed by another account", ROSE_S, ROSE),
         ("e", "E · ShopFront", "Sunday shown as Closed (record: 10:00-2:00)", ROSE_S, ROSE)]
tw, tg = 2.3, 0.158
for i, (k, name, note, bgc, fc) in enumerate(tiles):
    x = LM + i * (tw + tg)
    text(s, x, 1.9, tw, 0.28, name, size=14, bold=True)
    _, w_, h_ = img(s, "public-" + k, x, 2.2, w=tw)
    rect(s, x, 2.2 + h_ + 0.08, tw, 0.74, fill=bgc, line=None, radius=0.08)
    text(s, x + 0.1, 2.2 + h_ + 0.14, tw - 0.2, 0.64, note, size=12.5, bold=True, color=fc)
why = [("Customers are turned away", "Wrong hours or a stale phone number cost real orders."),
       ("Every site is different", "Own formats and logins. Some listings are claimed by others, and some edits wait for a moderator."),
       ("Nobody checks afterwards", "Drift returns silently. And a bot that edits freely is worse than no bot.")]
for i, (t, b) in enumerate(why):
    card(s, LM + i * 4.1, 4.95, 3.93, 1.9, t, b, tsize=18, bsize=16)
notes(s, "These are the five public pages for the same bakery, captured from the running app before anything is fixed. A matches. B says Diwali is closed. C writes the phone and address differently but means the same thing, so a smart tool must not 'fix' it. D shows a different phone and is claimed by someone else, so we are not even allowed to edit it. E says Sunday is closed. Why it matters: customers are turned away and calls go to the wrong number. Why owners struggle: every site has its own formats and logins, some listings belong to others, some edits sit in moderation, look-alike businesses exist, and nobody re-checks afterwards. A bot that edits freely would be dangerous, so the real problem is trust.")

# ═════════════════════════ 3. SOLUTION ═════════════════════════
s = slide(); header(s, "2  ·  OUR SOLUTION", "Tell us the truth once. The agent keeps every site honest.")
steps = [("1", "Scan", "Reads every site and compares meaning, not formatting."), ("2", "Review", "You approve or reject each fix. The reason is shown."),
         ("3", "Apply", "Only approved changes are sent, never to a listing you do not own."), ("4", "Verify", "Reloads the page. VERIFIED only if the value is really there.")]
for i, (n, t, b) in enumerate(steps):
    y = 1.7 + i * 1.3
    rect(s, LM, y, 5.7, 1.18)
    rect(s, LM + 0.2, y + 0.29, 0.6, 0.6, fill=OLIVE, line=None, shape=MSO_SHAPE.OVAL)
    text(s, LM + 0.2, y + 0.29, 0.6, 0.6, n, size=22, bold=True, color=CREAM, font=HEAD, align="c", anchor="m", check=False)
    text(s, LM + 1.05, y + 0.13, 4.5, 0.34, t, size=18, bold=True)
    text(s, LM + 1.05, y + 0.52, 4.5, 0.62, b, size=14.5, color=MUTED)
_, w_, h_ = img(s, "approvals-top", 6.6, 1.7, w=6.13)
card(s, 6.6, 1.7 + h_ + 0.2, 6.13, 6.85 - (1.7 + h_ + 0.2), "Who it helps",
     ["Busy owners of local shops", "Owners with more than one business", "New owners: found, and added where missing"], tsize=18, bsize=16.5, bullet=True, sp=8)
notes(s, "The product in one line: you tell us the truth once, and the agent keeps every site honest. Four steps. Scan reads every site and compares by meaning. Review shows a card per fix with a plain reason, as in the screenshot. Apply sends only what you approved. Verify reloads the page and only then says verified. Who it helps: busy owners of local shops, owners with several businesses (each has a separate PIN and data), and new owners, where the agent finds existing listings and adds the business where it is missing after approval. In our demo the owner does three clicks: Scan, Approve all, Apply. A full scan of five sites and twenty-five field checks took about 150 milliseconds on the local mock sites.")

# ═════════════════════════ 4. AGENTIC LOOP ═════════════════════════
s = slide(); header(s, "3  ·  THE AGENTIC AI", "A goal-driven loop, not a chat box")
rect(s, LM, 1.62, CW, 0.62, fill=SAND, line=None, radius=0.1)
text(s, LM + 0.25, 1.62, CW - 0.5, 0.62, [[("Goal  ", {"bold": True, "color": CLAY}), "every listing says what the owner's record says. The owner approves; the agent proves it."]], size=16, anchor="m")
stages = [("1  Perceive", "Read every page and dashboard. Keep the raw values."), ("2  Decide", "Compare meaning. Pick the next tool from the current state."),
          ("3  Act", "Propose, flag, ask the owner, or apply what was approved."), ("4  Verify", "Reload the page. VERIFIED only if the value is really there."),
          ("5  Recover", "Page changed? Site down? Re-ask, retry, re-send once.")]
sw, sg = 2.25, 0.22
for i, (t, b) in enumerate(stages):
    x = LM + i * (sw + sg)
    rect(s, x, 2.45, sw, 2.1)
    text(s, x + 0.17, 2.58, sw - 0.34, 0.34, t, size=17, bold=True, color=OLIVE_D)
    text(s, x + 0.17, 3.02, sw - 0.34, 1.45, b, size=14.5, color=INK)
    if i < 4: arrow(s, x + sw + 0.01, 3.5, x + sw + sg - 0.01, 3.5, color=OLIVE, w=2.25)
lx1, lx2, ly = LM + 4 * (sw + sg) + sw / 2, LM + 1 * (sw + sg) + sw / 2, 4.85
arrow(s, lx1, 4.55, lx1, ly, color=OLIVE, w=2, head=False); arrow(s, lx1, ly, lx2, ly, color=OLIVE, w=2, head=False); arrow(s, lx2, ly, lx2, 4.57, color=OLIVE, w=2)
text(s, lx2 + 0.3, ly + 0.04, 5, 0.28, "loops until nothing is left to do", size=12.5, color=MUTED, check=False)
rect(s, LM, 5.35, 7.9, 1.5)
text(s, LM + 0.2, 5.43, 7.4, 0.3, "Eight tools, one registry", size=15, bold=True, color=OLIVE_D)
tools = ["read_listing", "normalise", "compare", "propose", "apply_approved", "reload_and_verify", "flag_listing", "ask_owner"]
for i, n in enumerate(tools):
    x = LM + 0.2 + (i % 4) * 1.88; y = 5.82 + (i // 4) * 0.5
    rect(s, x, y, 1.8, 0.42, fill=BG, line=LINE, radius=0.06)
    text(s, x, y, 1.8, 0.42, n, size=11.5, bold=True, color=OLIVE_D, font=MONO, align="c", anchor="m", check=False)
card(s, 8.7, 5.35, 4.03, 1.5, "Who decides each step?", "A rules planner by default, or optional Gemini. Same tools, same guardrails. Every trace row shows who decided.", tsize=15, bsize=13.5)
notes(s, "What makes it agentic: it has a goal, not a script. Each step it looks at the current state of every site, chooses one of eight tools, acts, checks the result, and loops until nothing is left to do. Perceive, decide, act, verify, recover. The decision-maker is pluggable: a rules planner by default, or Gemini if a key is configured. Both use the same tool registry and the same guardrails, and every step is written to a trace with a badge saying who decided.")

# ═════════════════════════ 5. AGENTIC IN ACTION ═════════════════════════
s = slide(); header(s, "3  ·  THE AGENTIC AI", "From plain-language request to verified result")
cols = [("Interprets requests", ["Typed text becomes an intent: question, edit or date", "26th December becomes Sat 26 Dec 2026", "Unclear? One question. Nothing saves before Confirm"], "\"closed on 26th December\"  >  Action: Closed, Date: Sat 26 Dec 2026"),
        ("Selects tools", ["Looks at every site's state before each step", "Read, normalise, compare, then propose", "Not your listing? Code forces a flag, never an edit"], "Rogue planner test: 6 unsafe picks, 6 blocked, 0 writes"),
        ("Runs multi-step work", ["Scan reads and proposes; Execute applies and verifies", "One closure request fans out to all five sites", "Every step is a visible trace row"], "TC1: MISMATCH > PROPOSED > APPROVED > APPLIED > VERIFIED"),
        ("Verifies and recovers", ["Reloads the page; \"saved\" is never trusted", "A moderated site stays PENDING until it really changes", "Page changed? Site down? Re-ask, retry, re-send once"], "TC8: outage retried, lost write re-sent, VERIFIED")]
cw4, g4 = 2.9, 0.177
for i, (t, bl, ex) in enumerate(cols):
    x = LM + i * (cw4 + g4)
    rect(s, x, 1.62, cw4, 4.6)
    rect(s, x, 1.62, cw4, 0.58, fill=OLIVE, line=None, radius=0.06)
    text(s, x + 0.17, 1.62, cw4 - 0.3, 0.58, t, size=16, bold=True, color=CREAM, anchor="m")
    text(s, x + 0.17, 2.38, cw4 - 0.34, 2.85, bl, size=15, color=INK, bullet=True, sp=10)
    rect(s, x + 0.12, 5.28, cw4 - 0.24, 0.82, fill=SAND, line=None, radius=0.06)
    text(s, x + 0.22, 5.28, cw4 - 0.44, 0.82, ex, size=12, color=OLIVE_D, bold=True, anchor="m")
rect(s, LM, 6.35, CW, 0.62, fill=CLAY_S, line=None, radius=0.08)
text(s, LM + 0.2, 6.35, CW - 0.4, 0.62, [[("Honest note  ", {"bold": True, "color": CLAY}), "The default decision-maker is a rules planner. Gemini is optional, falls back to rules, and is tested with a mocked client: no live Gemini run is in our evidence."]], size=12.5, color=INK, anchor="m")
notes(s, "Four things the judges asked about. How it interprets requests: the Edit and Ask box turns text into an intent, resolves dates, asks exactly one clarifying question when unclear, and saves nothing until Confirm. How it selects tools: every step it looks at the state and picks a tool, and code blocks unsafe picks. How it runs multi-step workflows: scan then execute, fanning one request out to every site. How it verifies and recovers: reload and compare, wait on moderation, re-ask if the page changed after approval, retry outages and re-send a dropped edit once. Be upfront: the default planner is rules-based; Gemini is optional and tested with a mocked client, with 12 tests; there is no live Gemini run in our evidence because the build environment had no key.")

# ═════════════════════════ 6. TECH: ARCHITECTURE ═════════════════════════
s = slide(); header(s, "4  ·  TECHNICAL IMPLEMENTATION", "One service: console, agent, readers, five mock platforms")
text(s, LM, 1.36, CW, 0.35, "Data flow: record, read pages, normalise, compare, propose, owner approves, apply, reload and verify, report.", size=14.5, color=MUTED)
rect(s, LM, 2.3, 2.55, 3.4)
text(s, LM + 0.17, 2.4, 2.25, 0.32, "Owner's browser", size=15, bold=True, color=OLIVE_D)
text(s, LM + 0.17, 2.76, 2.25, 0.3, "React 19 + Vite", size=12.5, color=MUTED)
text(s, LM + 0.17, 3.2, 2.25, 2.4, ["PIN-only login", "Nine screens", "Scan, Review, Apply bar", "Agent Trace map"], size=13.5, bullet=True, sp=6)
rect(s, 3.55, 1.95, 5.6, 3.95, fill=SAND, line=LINE)
text(s, 3.75, 2.03, 5.2, 0.3, "Node 22 service  ·  Express 5  ·  TypeScript", size=14, bold=True)
inner = [("API + auth", "PIN-only login, sessions, one business per call", 3.72, 2.5), ("Agent core", "loop, planner, guardrail, 8 tools, verifier", 6.4, 2.5),
         ("Owner-facing smarts", "intent parser, holiday foresight, score matching", 3.72, 4.15), ("SQLite", "field states, audit log, trace, change log", 6.4, 4.15)]
for t, b, x, y in inner:
    rect(s, x, y, 2.6, 1.5, fill=CARD, line=LINE)
    text(s, x + 0.15, y + 0.12, 2.3, 0.3, t, size=14.5, bold=True, color=OLIVE_D)
    text(s, x + 0.15, y + 0.5, 2.3, 0.95, b, size=13, color=MUTED)
rect(s, 3.55, 6.05, 5.6, 0.45, fill=CARD, line=OLIVE, dash=True)
text(s, 3.7, 6.05, 5.3, 0.45, [[("Optional  ", {"bold": True, "color": OLIVE_D}), "Gemini (Interactions API): planner, date cross-check"]], size=12.5, color=MUTED, anchor="m")
arrow(s, 3.15, 3.8, 3.55, 3.8, color=OLIVE, w=2.25); arrow(s, 3.55, 4.1, 3.15, 4.1, color=OLIVE, w=2.25)
text(s, 3.0, 3.42, 0.7, 0.3, "HTTPS", size=11, color=MUTED, align="c", check=False)
rect(s, 9.75, 1.95, 2.98, 1.2)
text(s, 9.92, 2.03, 2.7, 0.3, "Readers", size=14.5, bold=True, color=OLIVE_D)
text(s, 9.92, 2.4, 2.7, 0.7, "Playwright, or HTTP + cheerio", size=13, color=MUTED)
rect(s, 9.75, 3.55, 2.98, 2.35)
text(s, 9.92, 3.63, 2.7, 0.3, "Five mock platforms", size=14.5, bold=True, color=OLIVE_D)
text(s, 9.92, 4.0, 2.7, 1.85, ["Public page, owner dashboard, edit API", "Different markup and hours formats", "Ownership and moderation rules"], size=12.5, color=MUTED, bullet=True, sp=4)
arrow(s, 9.15, 2.55, 9.75, 2.55, color=OLIVE, w=2.25); arrow(s, 11.24, 3.15, 11.24, 3.55, color=OLIVE, w=2.25)
text(s, 9.17, 2.17, 0.6, 0.3, "read +", size=11, color=MUTED, check=False); text(s, 9.17, 2.6, 0.6, 0.3, "write", size=11, color=MUTED, check=False)
rect(s, LM, 6.6, CW, 0.38, fill=DARK, line=None, radius=0.08)
text(s, LM + 0.2, 6.6, CW - 0.4, 0.38, "TypeScript  ·  Node 22  ·  Express 5  ·  React 19 + Vite  ·  SQLite  ·  Zod 4  ·  Playwright + cheerio  ·  chrono-node  ·  Docker on Render", size=12.5, color=CREAM, anchor="m", check=False)
notes(s, "This is the real architecture. One deployable Node service. The React console talks to an Express API over HTTPS. Behind it: auth, the agent core with its loop, planner, guardrail, eight tools and verifier, the owner-facing intelligence such as the intent parser, holiday foresight and score matching, and SQLite for field states, audit, trace and change log. Readers fetch pages with Playwright or a plain HTTP fallback, from five mock listing platforms that deliberately differ in markup, hours format, ownership and moderation. Every read asserts the listing ID so look-alikes are never touched; writes go through each site's dashboard API with permission handling. Gemini is an optional side connection. The data flow line at the top is one run from the owner's record to the report. We do not claim real platform integrations: those need their own APIs and consent flows.")

# ═════════════════════════ 7. TECH: SAFETY ═════════════════════════
s = slide(); header(s, "4  ·  TECHNICAL IMPLEMENTATION", "Safety is enforced in code, not in prompts")
def sbox(x, y, label, fill=SAND, color=INK, w=1.3):
    rect(s, x, y, w, 0.66, fill=fill, line=LINE, radius=0.08)
    text(s, x + 0.04, y, w - 0.08, 0.66, label, size=11.5, bold=True, color=color, align="c", anchor="m", check=False)
xs = [LM + i * 1.55 for i in range(5)]
for x, (l, f, c) in zip(xs, [("MISMATCH", SAND, INK), ("PROPOSED", SAND, INK), ("APPROVED", OLIVE_S, OLIVE_D), ("APPLIED", SAND, INK), ("VERIFIED", OLIVE, CREAM)]): sbox(x, 2.15, l, f, c)
for i, t in enumerate(["agent proposes", "owner only", "agent sends", "verifier only"]):
    arrow(s, xs[i] + 1.31, 2.48, xs[i + 1] - 0.01, 2.48, color=OLIVE, w=2.25)
    text(s, xs[i] + 0.75, 1.75, 1.4, 0.3, t, size=11.5, color=CLAY, bold=True, align="c", check=False)
sbox(xs[0], 3.7, "FLAGGED_NOT_OWNER", ROSE_S, ROSE, w=1.95); arrow(s, xs[0] + 0.65, 2.82, xs[0] + 0.65, 3.68, color=ROSE, w=2)
sbox(xs[1] + 0.65, 3.7, "REJECTED", SAND); arrow(s, xs[1] + 0.65, 2.82, xs[1] + 0.65, 3.68, color=MUTED, w=2)
sbox(xs[3] - 0.35, 3.7, "PENDING_MODERATION", CLAY_S, CLAY, w=1.95); arrow(s, xs[3] + 0.65, 2.82, xs[3] + 0.65, 3.68, color=CLAY, w=2)
arrow(s, xs[3] + 1.6, 3.85, xs[4] + 0.65, 2.84, color=OLIVE, w=2)
text(s, xs[0], 4.45, 1.95, 0.55, "not your listing: no write", size=12, color=ROSE, bold=True, check=False)
text(s, xs[1] + 0.65, 4.45, 1.3, 0.55, "owner says no", size=12, color=MUTED, bold=True, check=False)
text(s, xs[3] - 0.35, 4.45, 2.6, 0.55, "moderator has not approved; verified after reload", size=12, color=CLAY, bold=True, check=False)
text(s, LM, 5.15, 7.7, 0.4, "Only the owner can approve. Only the verifier can mark VERIFIED.", size=15, bold=True, color=OLIVE_D)
card(s, LM, 5.65, 7.7, 1.2, None, ["One business can never see another's data", "PINs are never stored; the API key never leaves the server"], bsize=14, bullet=True, sp=4, pad=0.2)
rect(s, 8.5, 1.7, 4.233, 3.6)
text(s, 8.7, 1.8, 3.85, 0.3, "Guardrails in code", size=17, bold=True)
text(s, 8.7, 2.27, 3.85, 3.0, ["No apply without a DB row the owner approved", "Not your listing: flag, never edit", "Pending moderation is never reported as fixed", "Look-alike listings are never read or edited"], size=16, bullet=True, sp=13)
rect(s, 8.5, 5.45, 4.233, 1.4, fill=DARK, line=None, radius=0.08)
text(s, 8.7, 5.5, 3.85, 0.65, "6 / 6", size=34, bold=True, color=CREAM, font=HEAD)
text(s, 8.7, 6.17, 3.85, 0.65, "unsafe actions blocked in the rogue-planner test: 0 writes", size=13, color="E7D9C2")
notes(s, "The safety story is code, not prompt engineering. Each field moves through a state machine. Only the owner can approve, only the verifier can mark verified, and a listing we do not own can only be flagged. A moderated site stays pending until a reload proves the change. We tested the guardrails with a scripted rogue planner that tried six unsafe things: apply without approval, apply unapproved fields, verify without applying, touch the look-alike, flag an editable listing. All six were blocked and zero writes reached any site. Business isolation and PIN handling are enforced and tested the same way.")

# ═════════════════════════ 8. INNOVATION ═════════════════════════
s = slide(); header(s, "5  ·  THE INNOVATION", "Not a dashboard, not a chatbot, not a cron job")
rows = [["", "Dashboard", "Chatbot", "Rule-based sync", "Our agent"],
        ["Compares meaning, not formatting", "No", "Partly", "No", "Yes"],
        ["Knows who owns a listing, refuses to edit it", "Partly", "No", "No", "Yes"],
        ["Reloads the page to prove the edit is live", "No", "No", "No", "Yes"],
        ["Tells \"pending moderation\" from \"done\"", "No", "No", "No", "Yes"],
        ["Recovers when a page changes or a site is down", "No", "No", "Partly", "Yes"]]
colors, fills = {}, {}
for i in range(1, 6):
    for j in range(1, 5):
        v = rows[i][j]; colors[(i, j)] = OLIVE_D if v == "Yes" else (CLAY if v == "Partly" else MUTED)
    fills[(i, 4)] = OLIVE_S
table(s, LM, 1.65, [5.0, 1.8, 1.8, 1.9, 1.633], rows, 0.56, size=15, colors=colors, fills=fills)
text(s, LM, 5.07, CW, 0.25, "Typical tools in each category, not specific products. \"Partly\" means possible, or only if configured.", size=11.5, color=MUTED, check=False)
calls = [("Verify-after-write", "A field is VERIFIED only when the reloaded public page shows the approved value."),
         ("Finds you among look-alikes", "Score = phone 40 + address 35 + name 25. The look-alike scores 37.7; the real listing 100."),
         ("Looks ahead, speaks plainly", "Holiday alerts at 30, 14 and 7 days. \"Closed on 26th December\" becomes an approved change.")]
for i, (t, b) in enumerate(calls):
    x = LM + i * 4.1
    rect(s, x, 5.45, 3.93, 1.42, fill=SAND, line=None, radius=0.08)
    text(s, x + 0.2, 5.55, 3.55, 0.32, t, size=15.5, bold=True, color=OLIVE_D)
    text(s, x + 0.2, 5.93, 3.55, 0.92, b, size=13.5, color=INK)
notes(s, "Why this is different. A dashboard shows values and leaves all the work to you. A chatbot can talk about listings but has no tools, no ownership checks and no proof. A rule-based sync pushes data and assumes it worked. Our agent compares by meaning, knows when a listing is not ours, reloads the page to prove the edit is live, tells pending moderation from done, and recovers when the world changes. The three callouts: verify-after-write; score-matched onboarding that finds you among look-alikes, with the look-alike at 37.7 against 100 for the real listing; and holiday foresight with plain-language edits. The comparison is against typical tools in each category, not specific products.")

# ═════════════════════════ 9. DEMO ═════════════════════════
s = slide(); header(s, "6  ·  THE DEMONSTRATION", "End to end: hours fixed, a stranger's listing left alone")
story = [("1", "Scan and review", "5 sites read in about 150 ms. CityPages shows Diwali as Closed; the record says 10:00-2:00. You decide."),
         ("2", "Safety", "NearbyNow belongs to another account: zero edits, and a claim request is drafted."),
         ("3", "Apply and verify", "Only approved changes go out; pages are reloaded. ShopFront waits for its moderator, then a re-check verifies."),
         ("4", "Report", "2 fixed and verified, 1 needs you, 2 ignored. Exported as CSV.")]
for i, (n, t, b) in enumerate(story):
    y = 1.65 + i * 1.18
    rect(s, LM, y, 5.55, 1.08)
    rect(s, LM + 0.15, y + 0.3, 0.48, 0.48, fill=OLIVE, line=None, shape=MSO_SHAPE.OVAL)
    text(s, LM + 0.15, y + 0.3, 0.48, 0.48, n, size=16, bold=True, color=CREAM, font=HEAD, align="c", anchor="m", check=False)
    text(s, LM + 0.82, y + 0.1, 4.6, 0.3, t, size=16, bold=True, color=OLIVE_D)
    text(s, LM + 0.82, y + 0.42, 4.6, 0.64, b, size=13.5, color=INK)
_, w1, h1 = img(s, "card-approve", 6.4, 1.65, w=6.33)
text(s, 6.4, 1.65 + h1 + 0.05, 6.33, 0.28, "Review: the card shows both values and the reason.", size=12, color=MUTED, check=False)
y2 = 1.65 + h1 + 0.45
_, w2, h2 = img(s, "flagged-card", 6.4, y2, w=6.33)
text(s, 6.4, y2 + h2 + 0.05, 6.33, 0.28, "Safety: not our listing, so nothing is edited.", size=12, color=MUTED, check=False)
rect(s, LM, 6.4, CW, 0.52, fill=DARK, line=None, radius=0.08)
text(s, LM + 0.25, 6.4, CW - 0.5, 0.52, [[("TC1 to TC8 pass from a fresh reset (8 / 8)", {"bold": True}), "   ·   295 automated tests   ·   2-minute video: docs/demo/demo.mp4"]], size=14, color=CREAM, anchor="m", check=False)
notes(s, "Walk through the scenario, ideally live. Press Scan: the agent reads five sites and tells you what it found, two fixes, one listing claimed by someone else, two formatting-only differences it ignores. Review: CityPages lists Diwali as closed, and the card explains why that matters. NearbyNow belongs to another account, so the agent makes no edit and drafts a claim request instead. Approve and Apply: only approved changes are sent and the pages are reloaded. ShopFront has a moderation queue, so the edit stays pending until the moderator approves, then a re-check verifies it. The report shows the before and after table with a CSV export. The strip at the bottom is the proof: the eight official test cases TC1 to TC8 pass from a fresh reset, including TC3 with zero write attempts on a listing we do not own and TC4 where pending moderation is never reported as fixed, alongside 295 automated tests. There is a two-minute video of exactly this flow, and anyone can press Run all on the test page in the live demo.")

# ═════════════════════════ 10. IMPACT ═════════════════════════
s = slide(); header(s, "7  ·  THE IMPACT", "Value we can measure, and where it goes next")
nums = [("~150 ms", "full scan: 5 sites, 25 field checks"), ("3 clicks", "owner effort in the demo"), ("8 / 8", "test cases pass, plus 295 tests"), ("0", "unapproved writes in any test")]
for i, (a, b) in enumerate(nums):
    x = LM + i * 3.077
    rect(s, x, 1.62, 2.9, 1.55)
    text(s, x + 0.2, 1.7, 2.55, 0.75, a, size=34, bold=True, color=OLIVE_D, font=HEAD)
    text(s, x + 0.2, 2.5, 2.55, 0.6, b, size=14, color=MUTED)
cols3 = [("Practical value", ["No wrong-hours surprises on holidays", "Proof for the owner: VERIFIED, trace, CSV"]),
         ("Scalability", ["Each platform is one more reader", "Every business is isolated by its own ID"]),
         ("Next", ["Real platform APIs and consent flows", "Scheduled scans, PIN recovery, more fields"])]
for i, (t, bl) in enumerate(cols3):
    x = LM + i * 4.1
    rect(s, x, 3.4, 3.93, 2.05, fill=SAND, line=None, radius=0.08)
    text(s, x + 0.22, 3.52, 3.5, 0.34, t, size=18, bold=True, color=OLIVE_D)
    text(s, x + 0.22, 4.0, 3.5, 1.4, bl, size=16, color=INK, bullet=True, sp=8)
rect(s, LM, 5.7, CW, 1.2, fill=DARK, line=None, radius=0.1)
text(s, LM + 0.3, 5.8, CW - 0.6, 0.5, [[("Honest limits  ", {"bold": True, "color": TAN}), "mock platforms  ·  OTP stays a human step  ·  Gemini optional, not live-tested"]], size=15, color=CREAM, anchor="m", check=False)
text(s, LM + 0.3, 6.32, CW - 0.6, 0.5, [[("Try it  ", {"bold": True, "color": TAN}), "zirohacksub.onrender.com   ·   demo PIN 7KQ4X-M9PHT   ·   github.com/yourgrok/zirohacksub"]], size=15, color=CREAM, anchor="m", check=False)
notes(s, "Impact, with numbers we actually measured. A full scan of five sites and twenty-five field checks takes about 150 milliseconds on the local mock sites (three runs: 139 to 156), so this excludes real-world network latency. In the demo the owner does three clicks. Eight of eight test cases and 295 automated tests pass; the rogue planner could not get a single write through. Practical value: no wrong-hours surprises, and proof for the owner. Scalability: each platform is another reader, work per scan grows with sites times fields, each business is isolated by its own ID. Next: real platform APIs with consent flows, scheduled scans, PIN recovery and phone verification, more fields. We would rather be honest than impressive: the platforms are mock sites, OTP stays a human step because the agent never automates OTP or CAPTCHA, and the Gemini path is tested with a mocked client only. We do not claim production traffic numbers; we have none. Close by inviting the judges to open the live demo, log in with the synthetic PIN and press Scan.")

prs.save(OUT)
print("saved", OUT, "-", len(prs.slides), "slides")
if warnings:
    print("LAYOUT WARNINGS:"); print("\n".join(warnings))
else:
    print("no overflow warnings")
