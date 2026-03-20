"""Unit tests for pdf_server helpers."""

import fitz

from pdf_server import _widget_type_str, _xref_refs


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
