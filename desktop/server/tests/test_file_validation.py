"""File upload security: magic byte validation tests"""
import pytest
from core.config import validate_file_magic as _validate_file_magic


class TestValidateFileMagic:
    def test_pdf_valid(self):
        ok, msg = _validate_file_magic(b"%PDF-1.4\ncontent", ".pdf")
        assert ok is True

    def test_pdf_spoofed(self):
        ok, msg = _validate_file_magic(b"evil content", ".pdf")
        assert ok is False
        assert "不匹配" in msg

    def test_png_valid(self):
        ok, msg = _validate_file_magic(b"\x89PNG\r\n\x1a\ncontent", ".png")
        assert ok is True

    def test_jpg_valid(self):
        ok, msg = _validate_file_magic(b"\xff\xd8\xff\xe0content", ".jpg")
        assert ok is True

    def test_gif_valid(self):
        ok, msg = _validate_file_magic(b"GIF89acontent", ".gif")
        assert ok is True

    def test_docx_valid(self):
        ok, msg = _validate_file_magic(b"PK\x03\x04content", ".docx")
        assert ok is True

    def test_empty_file(self):
        ok, msg = _validate_file_magic(b"", ".pdf")
        assert ok is False
        assert "为空" in msg

    def test_too_small(self):
        ok, msg = _validate_file_magic(b"a", ".pdf")
        assert ok is False
        assert "过小" in msg

    def test_txt_skips_validation(self):
        ok, msg = _validate_file_magic(b"plain text", ".txt")
        assert ok is True

    def test_csv_skips_validation(self):
        ok, msg = _validate_file_magic(b"col1,col2", ".csv")
        assert ok is True

    def test_unknown_ext_skips(self):
        ok, msg = _validate_file_magic(b"data", ".unknown")
        assert ok is True
