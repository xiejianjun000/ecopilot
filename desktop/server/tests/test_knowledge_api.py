"""knowledge_api 模块单测：聚焦 _parse_frontmatter / _serialize_frontmatter"""
import sys
sys.path.insert(0, '.')

from knowledge_api import _parse_frontmatter, _serialize_frontmatter


class TestParseFrontmatter:
    def test_parse_valid_frontmatter(self):
        text = '---\ntitle: "Test"\ncategory: "法规"\n---\nbody text'
        fm, body = _parse_frontmatter(text)
        assert fm["title"] == "Test"
        assert fm["category"] == "法规"
        assert body == "body text"

    def test_parse_no_frontmatter(self):
        text = "just body text without frontmatter"
        fm, body = _parse_frontmatter(text)
        assert fm == {}
        assert body == text

    def test_parse_frontmatter_with_list_tags(self):
        text = (
            "---\n"
            'title: "Doc"\n'
            "tags:\n"
            '  - "法规"\n'
            '  - "环保"\n'
            "---\n"
            "content"
        )
        fm, body = _parse_frontmatter(text)
        assert fm["title"] == "Doc"
        assert fm["tags"] == ["法规", "环保"]
        assert body == "content"

    def test_parse_frontmatter_single_quotes(self):
        text = "---\ntitle: 'Single'\n---\nbody"
        fm, body = _parse_frontmatter(text)
        assert fm["title"] == "Single"
        assert body == "body"

    def test_parse_frontmatter_inline_list(self):
        text = "---\ntags: [a, b, c]\n---\nbody"
        fm, body = _parse_frontmatter(text)
        assert fm["tags"] == ["a", "b", "c"]
        assert body == "body"

    def test_parse_empty_frontmatter(self):
        # 空的 frontmatter（分隔符间无内容）不匹配正则 ^---\n(.*?)\n---\n
        # 因为正则要求 \n---\n 前至少有内容，整个文本原样返回为 body
        text = "---\n---\nbody"
        fm, body = _parse_frontmatter(text)
        assert fm == {}
        assert body == text  # 原样返回


class TestSerializeFrontmatter:
    def test_serialize_dict_to_frontmatter(self):
        fm = {"title": "Test", "category": "法规"}
        result = _serialize_frontmatter(fm)
        assert result.startswith("---")
        assert result.endswith("---")
        assert 'title: "Test"' in result
        assert 'category: "法规"' in result

    def test_serialize_empty_dict(self):
        assert _serialize_frontmatter({}) == ""

    def test_serialize_list_field(self):
        fm = {"tags": ["a", "b"]}
        result = _serialize_frontmatter(fm)
        assert "tags:" in result
        assert '  - "a"' in result
        assert '  - "b"' in result

    def test_serialize_bool_field(self):
        fm = {"enabled": True, "disabled": False}
        result = _serialize_frontmatter(fm)
        assert "enabled: true" in result
        assert "disabled: false" in result

    def test_serialize_int_field(self):
        fm = {"count": 42}
        result = _serialize_frontmatter(fm)
        assert "count: 42" in result

    def test_serialize_skips_empty_values(self):
        fm = {"title": "Keep", "empty_str": "", "none_val": None}
        result = _serialize_frontmatter(fm)
        assert 'title: "Keep"' in result
        assert "empty_str" not in result
        assert "none_val" not in result


class TestRoundTrip:
    def test_round_trip_simple(self):
        original = "---\ntitle: \"RT\"\ncategory: \"法规\"\n---\nbody"
        fm, body = _parse_frontmatter(original)
        serialized = _serialize_frontmatter(fm)
        fm2, body2 = _parse_frontmatter(serialized + "\n" + body)
        assert fm2["title"] == fm["title"]
        assert fm2["category"] == fm["category"]
        assert body2 == body

    def test_round_trip_with_list(self):
        original = (
            "---\n"
            'title: "Doc"\n'
            "tags:\n"
            '  - "法规"\n'
            '  - "环保"\n'
            "---\n"
            "content"
        )
        fm, body = _parse_frontmatter(original)
        serialized = _serialize_frontmatter(fm)
        fm2, _ = _parse_frontmatter(serialized + "\n" + body)
        assert fm2["tags"] == fm["tags"]
