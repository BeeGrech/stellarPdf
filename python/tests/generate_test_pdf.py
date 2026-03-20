"""
Generate a fixture PDF used by UI and integration tests.

The PDF contains:
  Page 1 — AcroForm fields (text, checkbox, radio x2, dropdown)
  Page 2 — Flat visual fields (drawn box + underline) and redaction target text

Run:
  python python/tests/generate_test_pdf.py [output_path]

Default output: tests/fixtures/test_form.pdf
"""

import sys
import os
import fitz  # PyMuPDF


def _add_text_field(page, name, rect, label_pos, label):
    page.insert_text(label_pos, label, fontsize=11, fontname="helv", color=(0, 0, 0))
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w.field_name = name
    w.rect = fitz.Rect(*rect)
    w.field_value = ""
    w.border_color = (0, 0, 0)
    w.border_width = 1
    page.add_widget(w)


def _add_checkbox(page, name, rect, label_pos, label):
    page.insert_text(label_pos, label, fontsize=11, fontname="helv", color=(0, 0, 0))
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_CHECKBOX
    w.field_name = name
    w.rect = fitz.Rect(*rect)
    w.field_value = "Off"
    w.border_color = (0, 0, 0)
    w.border_width = 1
    page.add_widget(w)


def _add_radio(page, name, rect):
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_RADIOBUTTON
    w.field_name = name
    w.rect = fitz.Rect(*rect)
    w.field_value = "Off"
    w.border_color = (0, 0, 0)
    w.border_width = 1
    page.add_widget(w)


def _add_combobox(page, name, rect, label_pos, label, choices):
    page.insert_text(label_pos, label, fontsize=11, fontname="helv", color=(0, 0, 0))
    w = fitz.Widget()
    w.field_type = fitz.PDF_WIDGET_TYPE_COMBOBOX
    w.field_name = name
    w.rect = fitz.Rect(*rect)
    w.field_value = ""
    w.choice_values = choices
    w.border_color = (0, 0, 0)
    w.border_width = 1
    page.add_widget(w)


def generate(out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    doc = fitz.open()

    # ── Page 1: AcroForm fields ───────────────────────────────────────────────
    p1 = doc.new_page(width=612, height=792)
    p1.insert_text((50, 60), "Stellar PDF — Test Form (Page 1)",
                   fontsize=16, fontname="helv", color=(0, 0, 0))

    _add_text_field(p1, "full_name",
                    rect=(150, 95, 450, 120),
                    label_pos=(50, 115), label="Full Name:")

    _add_text_field(p1, "email",
                    rect=(150, 135, 450, 160),
                    label_pos=(50, 155), label="Email:")

    _add_checkbox(p1, "subscribe",
                  rect=(220, 180, 240, 200),
                  label_pos=(50, 197), label="Subscribe to updates:")

    p1.insert_text((50, 240), "Plan:", fontsize=11, fontname="helv", color=(0, 0, 0))
    p1.insert_text((160, 240), "Basic", fontsize=11, fontname="helv", color=(0, 0, 0))
    _add_radio(p1, "plan", rect=(148, 226, 158, 242))

    p1.insert_text((260, 240), "Pro", fontsize=11, fontname="helv", color=(0, 0, 0))
    _add_radio(p1, "plan", rect=(248, 226, 258, 242))

    _add_combobox(p1, "country",
                  rect=(150, 270, 350, 295),
                  label_pos=(50, 290), label="Country:",
                  choices=["United States", "Canada", "United Kingdom", "Other"])

    # ── Page 2: Visual fields + redaction target ──────────────────────────────
    p2 = doc.new_page(width=612, height=792)
    p2.insert_text((50, 60), "Stellar PDF — Visual Fields (Page 2)",
                   fontsize=16, fontname="helv", color=(0, 0, 0))

    # Drawn box — visual text field
    p2.insert_text((50, 115), "Notes:", fontsize=11, fontname="helv", color=(0, 0, 0))
    p2.draw_rect(fitz.Rect(120, 95, 480, 125), color=(0, 0, 0), fill=None, width=1)

    # Underline — visual underline field
    p2.insert_text((50, 175), "Signature:", fontsize=11, fontname="helv", color=(0, 0, 0))
    p2.draw_line((150, 180), (450, 180), color=(0, 0, 0), width=1)

    # Redaction target — known text that tests verify is removed after redaction
    p2.insert_text((50, 250), "REDACT_TARGET: secret-value-1234",
                   fontsize=12, fontname="helv", color=(0.8, 0, 0))
    p2.insert_text((50, 275),
                   "(The line above should be permanently removed after redaction.)",
                   fontsize=9, fontname="helv", color=(0.4, 0.4, 0.4))

    doc.save(out_path, deflate=True)
    doc.close()
    print(f"Generated: {out_path}")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/test_form.pdf"
    generate(out)
