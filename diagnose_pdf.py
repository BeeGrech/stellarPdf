#!/usr/bin/env python3
"""
Run: python/venv/bin/python3 diagnose_pdf.py /path/to/your.pdf
Dumps everything about the PDF's form structure.
"""
import sys, re, json
import fitz

if len(sys.argv) < 2:
    print("Usage: python/venv/bin/python3 diagnose_pdf.py /path/to/file.pdf")
    sys.exit(1)

path = sys.argv[1]
doc = fitz.open(path)
print(f"\n=== PDF: {path}")
print(f"Pages: {len(doc)}, Encrypted: {doc.is_encrypted}")
print(f"Metadata: {doc.metadata}\n")

cat = doc.pdf_catalog()

def xkey(xref, key):
    try:
        v = doc.xref_get_key(xref, key)
        return v if v and v[0] not in ("null","none") else None
    except:
        return None

# --- AcroForm structure ---
af = xkey(cat, "AcroForm")
print(f"=== AcroForm: {af}")
if af:
    af_fields = xkey(cat, "AcroForm/Fields")
    print(f"  /Fields: {af_fields}")
    af_xfa = xkey(cat, "AcroForm/XFA")
    print(f"  /XFA: {af_xfa}")
    af_sig = xkey(cat, "AcroForm/SigFlags")
    print(f"  /SigFlags: {af_sig}")

    # Walk the fields tree
    def walk(xref, depth=0, parent_name=""):
        indent = "  " * (depth + 2)
        obj = doc.xref_object(xref, compressed=False)
        t = xkey(xref, "T")
        ft = xkey(xref, "FT")
        kids = xkey(xref, "Kids")
        rect = xkey(xref, "Rect")
        subtype = xkey(xref, "Subtype")
        v = xkey(xref, "V")
        p = xkey(xref, "P")
        name = t[1].strip("()") if t else f"<unnamed>"
        full_name = f"{parent_name}.{name}" if parent_name else name
        print(f"{indent}xref={xref} name={full_name!r} FT={ft} Subtype={subtype} Rect={rect} V={v} P={p}")
        if depth == 0:
            print(f"{indent}  raw: {obj[:300]}")
        if kids:
            kid_xrefs = [int(m) for m in re.findall(r'(\d+) 0 R', kids[1])]
            for k in kid_xrefs:
                walk(k, depth+1, full_name)

    if af_fields:
        print("\n  Field tree:")
        field_xrefs = [int(m) for m in re.findall(r'(\d+) 0 R', af_fields[1])]
        print(f"  Top-level field xrefs: {field_xrefs}")
        for x in field_xrefs:
            walk(x)

# --- Page annotations ---
print("\n=== Page Annotations:")
for i in range(len(doc)):
    page = doc[i]
    px = doc.page_xref(i)
    annots_raw = xkey(px, "Annots")
    print(f"  Page {i} (xref {px}): /Annots = {annots_raw}")
    for annot in page.annots():
        print(f"    annot type={annot.type} subtype={annot.type[1]} rect={annot.rect}")
    for w in page.widgets():
        print(f"    WIDGET name={w.field_name} type={w.field_type} rect={w.rect}")

# --- Brute-force Widget scan ---
print("\n=== Brute-force /Subtype /Widget scan across all xrefs:")
found = []
for xref in range(1, doc.xref_length()):
    try:
        st = doc.xref_get_key(xref, "Subtype")
        if st and st[1] == "/Widget":
            ft = xkey(xref, "FT")
            rect = xkey(xref, "Rect")
            t = xkey(xref, "T")
            p = xkey(xref, "P")
            found.append(xref)
            print(f"  xref={xref} FT={ft} T={t} Rect={rect} P={p}")
    except:
        pass
print(f"  Total Widget xrefs found: {len(found)}")
