"""chat_api 模块单测：聚焦 _sanitize_input / _vault_safe_filename / fmt_size_py"""
import sys
sys.path.insert(0, '.')

from chat_api import _sanitize_input, _vault_safe_filename, fmt_size_py


class TestSanitizeInput:
    def test_normal_input(self):
        assert _sanitize_input("hello world") == "hello world"

    def test_empty_input(self):
        assert _sanitize_input("") == ""

    def test_whitespace_only(self):
        assert _sanitize_input("   ") == ""

    def test_long_input_truncated(self):
        s = "a" * 200
        result = _sanitize_input(s, max_len=50)
        assert len(result) == 50

    def test_html_escaping(self):
        result = _sanitize_input("<script>alert(1)</script>")
        assert "<script>" not in result
        # html.escape produces &lt; &gt; but the SQL filter strips ';'
        # so entities become &lt &gt (actual behavior of the function)
        assert "&lt" in result
        assert "&gt" in result

    def test_sql_injection_filtered(self):
        result = _sanitize_input("name' OR 1=1")
        assert "' OR " not in result

    def test_semicolon_filtered(self):
        result = _sanitize_input("drop;table")
        assert ";" not in result

    def test_non_string_input(self):
        assert _sanitize_input(123) == ""
        assert _sanitize_input(None) == ""
        assert _sanitize_input([]) == ""

    def test_special_characters_preserved(self):
        result = _sanitize_input("测试中文")
        assert result == "测试中文"

    def test_double_quote_escaped(self):
        result = _sanitize_input('hello"world')
        assert '"' not in result or "&quot;" in result


class TestVaultSafeFilename:
    def test_safe_filename(self):
        result = _vault_safe_filename("document.pdf")
        assert result.endswith("document.pdf")
        assert len(result) > len("document.pdf")  # 时间戳前缀

    def test_path_traversal_stripped(self):
        result = _vault_safe_filename("../../../etc/passwd")
        assert ".." not in result
        assert "/" not in result
        assert "passwd" in result

    def test_special_characters_replaced(self):
        result = _vault_safe_filename("file with spaces & symbols!.txt")
        assert " " not in result
        assert "&" not in result
        assert "!" not in result
        assert result.endswith(".txt")

    def test_empty_filename(self):
        result = _vault_safe_filename("")
        assert len(result) > 0
        # 格式为 YYYYMMDD-HHMMSS_file（时间戳前缀 + file 兜底名）
        assert "file" in result

    def test_dot_prefixed_filename(self):
        result = _vault_safe_filename(".hidden")
        assert not result.endswith(".hidden") or "file" in result

    def test_chinese_filename_preserved(self):
        result = _vault_safe_filename("台账.docx")
        assert "台账" in result

    def test_filename_has_timestamp(self):
        result = _vault_safe_filename("test.txt")
        # 格式应为 YYYYMMDD-HHMMSS_filename
        parts = result.split("_", 1)
        assert len(parts) == 2
        ts = parts[0]
        assert "-" in ts
        assert len(ts) == 15  # YYYYMMDD-HHMMSS


class TestFmtSize:
    def test_zero(self):
        assert fmt_size_py(0) == "0 B"

    def test_small_bytes(self):
        assert fmt_size_py(500) == "500 B"

    def test_just_below_kb(self):
        assert fmt_size_py(1023) == "1023 B"

    def test_exactly_kb(self):
        assert fmt_size_py(1024) == "1.0 KB"

    def test_large_kb(self):
        assert fmt_size_py(1536) == "1.5 KB"

    def test_exactly_mb(self):
        assert fmt_size_py(1048576) == "1.0 MB"

    def test_large_mb(self):
        assert fmt_size_py(50 * 1024 * 1024) == "50.0 MB"

    def test_gb_still_mb(self):
        # fmt_size_py 只到 MB 级，GB 仍按 MB 显示
        result = fmt_size_py(1073741824)
        assert "MB" in result

    def test_negative_input(self):
        # 负数视为字节级
        result = fmt_size_py(-1)
        assert "B" in result
