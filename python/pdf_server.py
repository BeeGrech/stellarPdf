#!/usr/bin/env python3
"""
PDF Editor RPC Server
Communicates with Electron via newline-delimited JSON on stdin/stdout.
All PDF mutations (form fill, redaction, text insert, save) live here.
Logs only to stderr; stdout is the RPC channel.
"""

import sys
import json
import re
import traceback
import os
import tempfile
import fitz  # PyMuPDF

# Global state
doc = None
original_path = None
pending_redactions = {}  # page_index (int) -> list of {"id": str, "rect": [x0,y0,x1,y1]}
redaction_counter = 0
undo_stack = []  # list of bytes snapshots, newest last
MAX_UNDO = 20


def _snapshot():
    """Push current doc state onto undo stack before a mutation."""
    undo_stack.append(doc.tobytes())
    if len(undo_stack) > MAX_UNDO:
        undo_stack.pop(0)


def _xref_refs(raw):
    """Extract all xref integers from a raw PDF value string like '[5 0 R 8 0 R]'."""
    return [int(m) for m in re.findall(r'(\d+) 0 R', raw or "")]


def _xkey(xref, key, pdf_doc=None):
    """Get a key from an xref dict; returns None if null/missing."""
    target = pdf_doc if pdf_doc is not None else doc
    try:
        v = target.xref_get_key(xref, key)
        if v and v[0] not in ("null", "none"):
            return v
    except Exception:
        pass
    return None


def _collect_widget_xrefs_from_acroform(pdf_doc):
    """
    Collect all Widget annotation xrefs. Two strategies:
    1. Walk AcroForm /Fields tree (fast, follows field hierarchy)
    2. Brute-force scan all xrefs for /Subtype /Widget (catches everything)
    Returns union of both.
    """
    found = set()

    # Strategy 1: Walk AcroForm /Fields tree
    try:
        cat = pdf_doc.pdf_catalog()
        af_fields = _xkey(cat, "AcroForm/Fields", pdf_doc)
        if af_fields:
            def walk(xref, depth=0):
                if depth > 30:
                    return
                kids = _xkey(xref, "Kids", pdf_doc)
                if kids:
                    for kid_xref in _xref_refs(kids[1]):
                        walk(kid_xref, depth + 1)
                else:
                    subtype = _xkey(xref, "Subtype", pdf_doc)
                    ft = _xkey(xref, "FT", pdf_doc)
                    # Include if it's a Widget or has a field type
                    if (subtype and "Widget" in subtype[1]) or ft:
                        found.add(xref)

            for xref in _xref_refs(af_fields[1]):
                walk(xref)
    except Exception as e:
        print(f"  AcroForm tree walk error: {e}", file=sys.stderr, flush=True)

    # Strategy 2: Brute-force scan all xrefs for /Subtype /Widget
    try:
        for xref in range(1, pdf_doc.xref_length()):
            try:
                subtype = pdf_doc.xref_get_key(xref, "Subtype")
                if subtype and subtype[0] == "name" and subtype[1] == "/Widget":
                    found.add(xref)
            except Exception:
                pass
    except Exception as e:
        print(f"  Brute-force scan error: {e}", file=sys.stderr, flush=True)

    print(f"  Found {len(found)} widget xrefs total", file=sys.stderr, flush=True)
    return list(found)


def repair_orphaned_widgets(pdf_doc):
    """
    Some PDF generators populate AcroForm/Fields correctly but forget to add
    Widget annotations to the page's /Annots array, so page.widgets() finds
    nothing.

    Strategy:
    1. Collect all widget xrefs from the AcroForm /Fields tree
    2. Build a set of all widget xrefs already in any page's /Annots
    3. For each orphaned widget:
       a. If it has /P → add to that page's /Annots
       b. If no /P but only 1 page → add to page 0
       c. If no /P and multiple pages → add to every page (PDF.js/PyMuPDF will
          ignore widgets outside the page rect, so this is safe)
    """
    try:
        widget_xrefs = _collect_widget_xrefs_from_acroform(pdf_doc)
        if not widget_xrefs:
            return 0

        # Build map: page_xref → (page_index, set of xrefs in /Annots)
        page_annots = {}  # page_index → set of xrefs
        page_xref_to_index = {}
        for i in range(len(pdf_doc)):
            px = pdf_doc.page_xref(i)
            page_xref_to_index[px] = i
            annots_raw = _xkey(px, "Annots", pdf_doc)
            page_annots[i] = set(_xref_refs(annots_raw[1] if annots_raw else ""))

        repaired = 0
        for xref in widget_xrefs:
            # Check if already in any page's annots
            already_placed = any(xref in s for s in page_annots.values())
            if already_placed:
                continue

            # Determine target page(s)
            target_pages = []
            p_ref = _xkey(xref, "P", pdf_doc)
            if p_ref:
                m = re.search(r'(\d+) 0 R', p_ref[1])
                if m:
                    page_xref = int(m.group(1))
                    if page_xref in page_xref_to_index:
                        target_pages = [page_xref_to_index[page_xref]]

            if not target_pages:
                # No /P reference: add to page 0 (single page) or all pages
                target_pages = [0] if len(pdf_doc) == 1 else list(range(len(pdf_doc)))

            for page_index in target_pages:
                existing = page_annots[page_index]
                new_set = sorted(existing | {xref})
                annots_str = "[" + " ".join(f"{x} 0 R" for x in new_set) + "]"
                pdf_doc.xref_set_key(pdf_doc.page_xref(page_index), "Annots", annots_str)
                page_annots[page_index] = set(new_set)
                print(f"  Repaired: widget xref {xref} → page {page_index}",
                      file=sys.stderr, flush=True)
                repaired += 1
                break  # only add to first matching page

        return repaired
    except Exception as e:
        print(f"repair_orphaned_widgets error: {e}", file=sys.stderr, flush=True)
        return 0


def handle_open(params):
    global doc, original_path, pending_redactions, redaction_counter
    path = params["path"]
    if doc:
        doc.close()
    doc = fitz.open(path)
    original_path = path
    pending_redactions = {}
    redaction_counter = 0

    # Repair PDFs where widget annotations are not linked to page /Annots
    repaired = repair_orphaned_widgets(doc)
    if repaired:
        print(f"Repaired {repaired} orphaned widget(s); reloading doc", file=sys.stderr, flush=True)
        # Reload from modified bytes to flush PyMuPDF's internal page cache
        buf = doc.tobytes()
        doc.close()
        doc = fitz.open("pdf", buf)

    md = getattr(doc, "metadata", None) or {}
    title = (md.get("title", "") if isinstance(md, dict) else "") or ""
    widget_total = sum(len(list(doc[i].widgets())) for i in range(len(doc)))
    print(f"Opened: {len(doc)} pages, {widget_total} total widgets after repair", file=sys.stderr, flush=True)
    return {"page_count": len(doc), "title": title, "repaired_widgets": repaired}


def handle_get_page_info(params):
    page = doc[params["page_index"]]
    r = page.rect
    return {"width": r.width, "height": r.height}


def handle_detect_fields(params):
    """
    Detect visual form fields on a page by analysing drawing paths.
    Returns boxes that look like input fields (thin rectangles with borders,
    no fill or white fill) plus the dominant font size on the page.
    Also detects underlines (single horizontal lines used as signature lines).
    """
    page_index = params["page_index"]
    page = doc[page_index]

    # --- Dominant font size from page text ---
    font_sizes = []
    text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    for block in text_dict.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                sz = span.get("size", 0)
                if sz > 4:
                    font_sizes.append(sz)

    default_fontsize = 10.0  # safe fallback
    if font_sizes:
        # Use the most common size rounded to 0.5
        rounded = [round(s * 2) / 2 for s in font_sizes]
        default_fontsize = max(set(rounded), key=rounded.count)

    # --- Detect form field boxes from drawings ---
    detected = []
    drawings = page.get_drawings()

    for d in drawings:
        rect = d.get("rect")
        if not rect:
            continue

        w = rect.width
        h = rect.height
        fill = d.get("fill")        # fill colour tuple or None
        color = d.get("color")      # stroke colour or None
        stroke_w = d.get("width", 1)

        # Skip filled shapes (likely decorative); allow None or white/near-white fill
        if fill is not None:
            if isinstance(fill, (list, tuple)) and len(fill) >= 3:
                # Reject anything with a clearly coloured fill
                if not all(c > 0.85 for c in fill[:3]):
                    continue
            elif isinstance(fill, (int, float)) and fill < 0.85:
                continue  # grey fill, skip

        # Must have a visible stroke
        if color is None and stroke_w == 0:
            continue

        # Form field height: single-line input typically 8–32 pts
        # Width must be meaningful
        if h < 6 or h > 40 or w < 20:
            continue

        # Underline / signature line: very thin height, wide
        is_underline = (h < 4 and w > 40)

        # Standard box field
        is_box = (6 <= h <= 40 and w >= 30)

        if not (is_underline or is_box):
            continue

        # Estimate a good baseline Y inside the field.
        # Text baseline sits roughly 20% up from the bottom of the field.
        baseline_offset = h * 0.25
        baseline_y = rect.y1 - baseline_offset  # PyMuPDF coords (y↓)

        detected.append({
            "rect": [rect.x0, rect.y0, rect.x1, rect.y1],
            "baseline_y": baseline_y,
            "fontsize": default_fontsize,
            "is_underline": is_underline,
        })

    print(f"detect_fields page {page_index}: {len(detected)} candidates, fontsize={default_fontsize}",
          file=sys.stderr, flush=True)
    return {"fields": detected, "default_fontsize": default_fontsize}


def handle_get_click_context(params):
    """
    Given a click position in PyMuPDF coords, return the nearest text
    baseline Y and the font size of nearby text.
    """
    page_index = params["page_index"]
    _ = params["x"]
    y = params["y"]
    page = doc[page_index]

    text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)

    best_fontsize = 10.0
    best_baseline_y = y
    min_dist = float("inf")

    for block in text_dict.get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            bbox = line.get("bbox", [])
            if not bbox:
                continue
            line_cy = (bbox[1] + bbox[3]) / 2
            dist = abs(y - line_cy)
            if dist < min_dist:
                min_dist = dist
                sz = spans[0].get("size", 10.0)
                if sz > 4:
                    best_fontsize = sz
                # baseline: origin y of first span (in PyMuPDF coords)
                origin = spans[0].get("origin")
                if origin:
                    best_baseline_y = origin[1]
                else:
                    best_baseline_y = bbox[3] - sz * 0.2

    return {"fontsize": best_fontsize, "baseline_y": best_baseline_y}


def handle_diagnose(_params):
    """Diagnostic: return raw info about what PyMuPDF sees in the current PDF."""
    if not doc:
        return {"error": "No document open"}

    result = {"pages": [], "xfa": False, "acroform": False}

    # Check for XFA
    try:
        cat = doc.pdf_catalog()
        af = doc.xref_get_key(cat, "AcroForm")
        if af and af[0] != "null":
            result["acroform"] = True
            # Check if AcroForm has XFA key
            xfa = doc.xref_get_key(cat, "AcroForm/XFA")
            if xfa and xfa[0] not in ("null", "none", None):
                result["xfa"] = True
    except Exception as e:
        result["acroform_error"] = str(e)

    for page_index, page in enumerate(doc):
        raw_widgets = []
        for w in page.widgets():
            raw_widgets.append({
                "name": w.field_name,
                "raw_type": w.field_type,
                "type_str": _widget_type_str(w.field_type),
                "rect": [w.rect.x0, w.rect.y0, w.rect.x1, w.rect.y1],
            })
        result["pages"].append({"page": page_index, "widget_count": len(raw_widgets), "widgets": raw_widgets})

    print(f"DIAGNOSE result: {result}", file=sys.stderr, flush=True)
    return result


def handle_get_fields(params):
    page_index = params["page_index"]
    page = doc[page_index]
    fields = []

    # Track radio groups: name -> currently selected value
    radio_values = {}
    for widget in page.widgets():
        if widget.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
            name = widget.field_name
            if name not in radio_values:
                radio_values[name] = widget.field_value

    for widget in page.widgets():
        rect = widget.rect
        # PyMuPDF rect: x0,y0 = top-left; y increases downward
        rect_list = [rect.x0, rect.y0, rect.x1, rect.y1]
        field_type = _widget_type_str(widget.field_type)

        if field_type == "radio":
            try:
                on_state = widget.on_state()
            except Exception:
                on_state = widget.field_value
            fields.append({
                "name": widget.field_name,
                "type": "radio",
                "rect": rect_list,
                "value": radio_values.get(widget.field_name, ""),
                "option_value": on_state,
                "options": None,
            })
        elif field_type == "select":
            choices = widget.choice_values or []
            fields.append({
                "name": widget.field_name,
                "type": "select",
                "rect": rect_list,
                "value": widget.field_value or "",
                "option_value": None,
                "options": choices,
            })
        elif field_type == "checkbox":
            fields.append({
                "name": widget.field_name,
                "type": "checkbox",
                "rect": rect_list,
                "value": widget.field_value or "",
                "option_value": None,
                "options": None,
            })
        elif field_type == "text":
            fields.append({
                "name": widget.field_name,
                "type": "text",
                "rect": rect_list,
                "value": widget.field_value or "",
                "option_value": None,
                "options": None,
            })
        # Skip signature, button, unknown types

    return {"fields": fields}


def handle_fill_form(params):
    _snapshot()
    page_index = params["page_index"]
    fields_to_fill = {f["name"]: f["value"] for f in params["fields"]}
    page = doc[page_index]

    for widget in page.widgets():
        name = widget.field_name
        if name not in fields_to_fill:
            continue
        value = fields_to_fill[name]

        if widget.field_type == fitz.PDF_WIDGET_TYPE_TEXT:
            widget.field_value = value
            widget.update()

        elif widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
            # Normalize: truthy strings → "Yes", else "Off"
            widget.field_value = value if value in ("Yes", "Off") else ("Yes" if value else "Off")
            widget.update()

        elif widget.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
            # For radio: each widget has its own on_state; set the matching one
            try:
                on_state = widget.on_state()
            except Exception:
                on_state = None
            if on_state == value:
                widget.field_value = on_state
            else:
                widget.field_value = "Off"
            widget.update()

        elif widget.field_type in (fitz.PDF_WIDGET_TYPE_LISTBOX, fitz.PDF_WIDGET_TYPE_COMBOBOX):
            widget.field_value = value
            widget.update()

    return {"ok": True}


def handle_add_redaction(params):
    global redaction_counter
    page_index = params["page_index"]
    rect = params["rect"]
    redaction_id = f"redact_{redaction_counter}"
    redaction_counter += 1

    if page_index not in pending_redactions:
        pending_redactions[page_index] = []
    pending_redactions[page_index].append({"id": redaction_id, "rect": rect})

    return {"id": redaction_id}


def handle_remove_redaction(params):
    rid = params["id"]
    for page_index, rects in pending_redactions.items():
        pending_redactions[page_index] = [r for r in rects if r["id"] != rid]
    return {"ok": True}


def handle_apply_redactions(_params):
    _snapshot()
    pages_affected = []
    for page_index, rects in pending_redactions.items():
        if not rects:
            continue
        page = doc[page_index]
        for entry in rects:
            r = entry["rect"]
            page.add_redact_annot(fitz.Rect(r[0], r[1], r[2], r[3]), fill=(0, 0, 0))
        page.apply_redactions()
        pages_affected.append(page_index)
    pending_redactions.clear()
    return {"pages_affected": pages_affected}


def handle_insert_text(params):
    _snapshot()
    page_index = params["page_index"]
    x = params["x"]
    y = params["y"]
    text = params["text"]
    fontsize = params.get("fontsize", 12)
    color_raw = params.get("color", [0, 0, 0])
    color = tuple(c / 255.0 if c > 1 else c for c in color_raw)
    clear_rect = params.get("clear_rect")

    page = doc[page_index]

    if clear_rect:
        # White-out the field area so previous text doesn't show through
        r = fitz.Rect(clear_rect[0], clear_rect[1], clear_rect[2], clear_rect[3])
        page.draw_rect(r, color=None, fill=(1, 1, 1), overlay=True)

    page.insert_text(
        fitz.Point(x, y),
        text,
        fontsize=fontsize,
        fontname="helv",
        color=color,
    )
    return {"ok": True}


def handle_save(params):
    global doc
    path = params["path"]
    # PyMuPDF cannot do a full save to the same file it has open.
    # Save to a temp file alongside the target, then atomically replace.
    dir_ = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=dir_, suffix=".pdf")
    os.close(fd)
    try:
        doc.save(tmp, deflate=True)
        doc.close()
        os.replace(tmp, path)
        doc = fitz.open(path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return {"ok": True}


def handle_undo(_params):
    global doc
    if not undo_stack:
        return {"ok": False, "reason": "nothing to undo"}
    buf = undo_stack.pop()
    doc.close()
    doc = fitz.open("pdf", buf)
    return {"ok": True, "remaining": len(undo_stack)}


def _widget_type_str(t):
    if t == fitz.PDF_WIDGET_TYPE_TEXT:
        return "text"
    if t == fitz.PDF_WIDGET_TYPE_CHECKBOX:
        return "checkbox"
    if t == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
        return "radio"
    if t in (fitz.PDF_WIDGET_TYPE_LISTBOX, fitz.PDF_WIDGET_TYPE_COMBOBOX):
        return "select"
    return "unknown"


HANDLERS = {
    "open": handle_open,
    "get_page_info": handle_get_page_info,
    "get_fields": handle_get_fields,
    "detect_fields": handle_detect_fields,
    "get_click_context": handle_get_click_context,
    "diagnose": handle_diagnose,
    "fill_form": handle_fill_form,
    "add_redaction": handle_add_redaction,
    "remove_redaction": handle_remove_redaction,
    "apply_redactions": handle_apply_redactions,
    "insert_text": handle_insert_text,
    "undo": handle_undo,
    "save": handle_save,
}


def main():
    print("PDF server ready", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            method = req.get("method")
            params = req.get("params", {})

            if method not in HANDLERS:
                raise ValueError(f"Unknown method: {method}")

            result = HANDLERS[method](params)
            response = {"id": req_id, "result": result, "error": None}
        except Exception as e:
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            response = {
                "id": req_id,
                "result": None,
                "error": {"code": -32000, "message": str(e)},
            }

        print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
