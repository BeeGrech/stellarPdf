"""Unit tests for pdf_server helpers and handlers."""

import os
import tempfile

import fitz
import pytest

import pdf_server
from pdf_server import (
    _widget_type_str,
    _xref_refs,
    handle_open,
    handle_get_fields,
    handle_fill_form,
    handle_save,
    handle_undo,
    handle_add_redaction,
    handle_apply_redactions,
    handle_insert_text,
)
from tests.generate_test_pdf import generate as generate_pdf


# ── Fixture ───────────────────────────────────────────────────────────────────

@pytest.fixture()
def fixture_pdf(tmp_path):
    """Fresh copy of the test fixture PDF for each test."""
    path = str(tmp_path / "test_form.pdf")
    generate_pdf(path)
    return path


@pytest.fixture(autouse=True)
def reset_server_state(fixture_pdf):
    """Open the fixture and reset all global server state before each test."""
    handle_open({"path": fixture_pdf})
    pdf_server.undo_stack.clear()
    pdf_server.pending_redactions.clear()
    pdf_server.redaction_counter = 0
    yield
    if pdf_server.doc:
        pdf_server.doc.close()
        pdf_server.doc = None


# ── Handler tests ─────────────────────────────────────────────────────────────

class TestHandleOpen:
    def test_returns_page_count(self, fixture_pdf):
        result = handle_open({"path": fixture_pdf})
        assert result["page_count"] == 2

    def test_doc_is_loaded(self):
        assert pdf_server.doc is not None
        assert len(pdf_server.doc) == 2

    def test_replaces_existing_doc(self, fixture_pdf):
        handle_open({"path": fixture_pdf})
        assert pdf_server.doc is not None


class TestHandleGetFields:
    def test_page1_has_acroform_fields(self):
        result = handle_get_fields({"page_index": 0})
        fields = result["fields"]
        assert len(fields) > 0
        names = [f["name"] for f in fields]
        assert "full_name" in names
        assert "email" in names

    def test_field_has_required_keys(self):
        result = handle_get_fields({"page_index": 0})
        f = result["fields"][0]
        assert "name" in f
        assert "type" in f
        assert "rect" in f
        assert "value" in f

    def test_page2_has_no_acroform_fields(self):
        result = handle_get_fields({"page_index": 1})
        assert result["fields"] == []


class TestHandleFillForm:
    def test_fill_text_field(self):
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "Jane Doe"}]})
        page = pdf_server.doc[0]
        values = {w.field_name: w.field_value for w in page.widgets()}
        assert values["full_name"] == "Jane Doe"

    def test_fill_multiple_fields(self):
        handle_fill_form({"page_index": 0, "fields": [
            {"name": "full_name", "value": "Alice"},
            {"name": "email", "value": "alice@example.com"},
        ]})
        page = pdf_server.doc[0]
        values = {w.field_name: w.field_value for w in page.widgets()}
        assert values["full_name"] == "Alice"
        assert values["email"] == "alice@example.com"

    def test_fill_takes_snapshot(self):
        before = len(pdf_server.undo_stack)
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "Bob"}]})
        assert len(pdf_server.undo_stack) == before + 1

    def test_fill_checkbox(self):
        handle_fill_form({"page_index": 0, "fields": [{"name": "subscribe", "value": "Yes"}]})
        page = pdf_server.doc[0]
        values = {w.field_name: w.field_value for w in page.widgets()}
        assert values["subscribe"] == "Yes"


class TestHandleSave:
    def test_save_writes_file(self, tmp_path):
        out = str(tmp_path / "saved.pdf")
        import shutil
        shutil.copy(pdf_server.original_path, out)
        handle_open({"path": out})
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "Saved"}]})
        handle_save({"path": out})
        assert os.path.exists(out)

    def test_save_persists_field_value(self, tmp_path):
        out = str(tmp_path / "saved.pdf")
        import shutil
        shutil.copy(pdf_server.original_path, out)
        handle_open({"path": out})
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "Persisted"}]})
        handle_save({"path": out})
        # Verify by reopening with a fresh fitz instance
        check = fitz.open(out)
        values = {w.field_name: w.field_value for w in check[0].widgets()}
        check.close()
        assert values["full_name"] == "Persisted"

    def test_save_reopens_doc(self, tmp_path):
        out = str(tmp_path / "saved.pdf")
        import shutil
        shutil.copy(pdf_server.original_path, out)
        handle_open({"path": out})
        handle_save({"path": out})
        assert pdf_server.doc is not None


class TestHandleUndo:
    def test_undo_empty_stack_returns_not_ok(self):
        pdf_server.undo_stack.clear()
        result = handle_undo({})
        assert result["ok"] is False

    def test_undo_reverts_fill(self):
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "Before"}]})
        handle_undo({})
        page = pdf_server.doc[0]
        values = {w.field_name: w.field_value for w in page.widgets()}
        assert values.get("full_name", "") == ""

    def test_undo_decrements_stack(self):
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "A"}]})
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "B"}]})
        assert len(pdf_server.undo_stack) == 2
        handle_undo({})
        assert len(pdf_server.undo_stack) == 1

    def test_undo_returns_remaining_count(self):
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "X"}]})
        handle_fill_form({"page_index": 0, "fields": [{"name": "full_name", "value": "Y"}]})
        result = handle_undo({})
        assert result["ok"] is True
        assert result["remaining"] == 1


class TestHandleRedaction:
    def test_add_redaction_returns_id(self):
        result = handle_add_redaction({"page_index": 1, "rect": [50, 230, 400, 260]})
        assert "id" in result
        assert result["id"].startswith("redact_")

    def test_add_redaction_stored_in_pending(self):
        handle_add_redaction({"page_index": 1, "rect": [50, 230, 400, 260]})
        assert 1 in pdf_server.pending_redactions
        assert len(pdf_server.pending_redactions[1]) == 1

    def test_apply_redactions_takes_snapshot(self):
        handle_add_redaction({"page_index": 1, "rect": [50, 230, 400, 260]})
        before = len(pdf_server.undo_stack)
        handle_apply_redactions({})
        assert len(pdf_server.undo_stack) == before + 1

    def test_apply_redactions_clears_pending(self):
        handle_add_redaction({"page_index": 1, "rect": [50, 230, 400, 260]})
        handle_apply_redactions({})
        assert len(pdf_server.pending_redactions) == 0

    def test_apply_redactions_removes_text(self, tmp_path):
        handle_add_redaction({"page_index": 1, "rect": [40, 230, 560, 265]})
        handle_apply_redactions({})
        out = str(tmp_path / "redacted.pdf")
        handle_save({"path": out})
        check = fitz.open(out)
        text = check[1].get_text()
        check.close()
        assert "secret-value-1234" not in text


class TestRedactionSecurity:
    """Verify redaction burns content out of the document, not just covers it."""

    def test_text_gone_from_memory_after_apply(self):
        # In-memory check: get_text() must not return the secret after apply_redactions()
        handle_add_redaction({"page_index": 1, "rect": [40, 237, 560, 265]})
        handle_apply_redactions({})
        text = pdf_server.doc[1].get_text()
        assert "secret-value-1234" not in text

    def test_raw_bytes_scrubbed_after_save(self, tmp_path):
        # Binary scan: the secret must not appear as plaintext bytes in the saved file.
        # An annotation-only "redaction" (no content removal) leaves the original
        # content stream intact; this catches that failure mode.
        handle_add_redaction({"page_index": 1, "rect": [40, 237, 560, 265]})
        handle_apply_redactions({})
        out = str(tmp_path / "redacted_binary.pdf")
        handle_save({"path": out})
        raw = open(out, "rb").read()
        assert b"secret-value-1234" not in raw

    def test_redaction_does_not_affect_other_page(self):
        # Redacting page 2 must not corrupt page 1 form fields.
        handle_add_redaction({"page_index": 1, "rect": [40, 237, 560, 265]})
        handle_apply_redactions({})
        result = handle_get_fields({"page_index": 0})
        names = [f["name"] for f in result["fields"]]
        assert "full_name" in names
        assert "email" in names


class TestHandleInsertText:
    def test_insert_text_takes_snapshot(self):
        before = len(pdf_server.undo_stack)
        handle_insert_text({"page_index": 0, "x": 100, "y": 400, "text": "Hello", "fontsize": 12})
        assert len(pdf_server.undo_stack) == before + 1

    def test_inserted_text_appears_in_page(self, tmp_path):
        handle_insert_text({"page_index": 0, "x": 100, "y": 400, "text": "InsertedText", "fontsize": 12})
        out = str(tmp_path / "inserted.pdf")
        handle_save({"path": out})
        check = fitz.open(out)
        text = check[0].get_text()
        check.close()
        assert "InsertedText" in text


# ── Helper tests ──────────────────────────────────────────────────────────────

class TestXrefRefs:
    def test_empty(self):
        assert _xref_refs("") == []
        assert _xref_refs(None) == []

    def test_single_ref(self):
        assert _xref_refs("[42 0 R]") == [42]

    def test_multiple_refs(self):
        assert _xref_refs("[5 0 R 8 0 R 99 0 R]") == [5, 8, 99]

    def test_no_matches(self):
        assert _xref_refs("[]") == []
        assert _xref_refs("not a pdf ref array") == []


class TestWidgetTypeStr:
    def test_known_types(self):
        assert _widget_type_str(fitz.PDF_WIDGET_TYPE_TEXT) == "text"
        assert _widget_type_str(fitz.PDF_WIDGET_TYPE_CHECKBOX) == "checkbox"
        assert _widget_type_str(fitz.PDF_WIDGET_TYPE_RADIOBUTTON) == "radio"

    def test_select_types(self):
        assert _widget_type_str(fitz.PDF_WIDGET_TYPE_LISTBOX) == "select"
        assert _widget_type_str(fitz.PDF_WIDGET_TYPE_COMBOBOX) == "select"

    def test_unknown(self):
        assert _widget_type_str(-999) == "unknown"
