"""permit_parser 模块单测：聚焦 parse_permit_from_cards"""
import sys
sys.path.insert(0, '.')

from permit_parser import parse_permit_from_cards, _extract_by_regex, _infer_mgmt_level


class TestParsePermitFromCards:
    def test_parse_valid_card1(self, sample_card1_data):
        cards = {"card1": sample_card1_data}
        result = parse_permit_from_cards(cards)
        assert result["enterpriseName"] == "测试钢铁有限公司"
        assert result["creditCode"] == "91110000MA01ABCD2X"
        assert result["permitNumber"] == "91110000MA01ABCD2X00001"
        assert result["issuingAuthority"] == "XX市生态环境局"
        assert result["legalRepresentative"] == "张三"
        assert result["address"] == "XX省XX市XX区XX路1号"
        assert result["industryCategory"] == "黑色金属冶炼"
        assert result["industryCode"] == "C3110"
        assert result["managementLevel"] == "重点管理"
        assert result["phone"] == "13800138000"
        assert result["email"] == "test@example.com"
        assert result["postalCode"] == "100000"
        assert result["validFrom"] == "2023-01-01"
        assert result["validTo"] == "2028-01-01"
        assert result["issueDate"] == "2023-01-01"

    def test_parse_empty_input(self):
        result = parse_permit_from_cards({})
        assert result["enterpriseName"] == ""
        assert result["creditCode"] == ""
        assert result["managementLevel"] == "重点管理"  # 默认推断
        assert result["emissionOutlets"] == []

    def test_parse_missing_fields(self):
        cards = {"card1": {"text": "仅有些不完整的文本", "tables": []}}
        result = parse_permit_from_cards(cards)
        assert result["enterpriseName"] == ""
        assert result["creditCode"] == ""
        assert result["permitNumber"] == ""

    def test_parse_air_emission_outlets(self, sample_card6_data):
        cards = {"card6": sample_card6_data}
        result = parse_permit_from_cards(cards)
        outlets = result["emissionOutlets"]
        assert len(outlets) >= 1
        assert any(o["code"] == "DA001" for o in outlets)

    def test_parse_water_emission_outlets(self):
        cards = {
            "card10": {
                "text": "DW001 废水总排口 COD≤50 mg/L",
                "tables": [],
            }
        }
        result = parse_permit_from_cards(cards)
        outlets = result["emissionOutlets"]
        assert any(o["code"] == "DW001" for o in outlets)

    def test_management_level_inference_steel(self):
        result = {"managementLevel": "未知", "industryCategory": "钢铁", "enterpriseName": ""}
        _infer_mgmt_level(result)
        assert result["managementLevel"] == "重点管理"

    def test_management_level_inference_food(self):
        result = {"managementLevel": "未知", "industryCategory": "食品加工", "enterpriseName": ""}
        _infer_mgmt_level(result)
        assert result["managementLevel"] == "简化管理"

    def test_management_level_already_set(self):
        result = {"managementLevel": "简化管理", "industryCategory": "钢铁", "enterpriseName": ""}
        _infer_mgmt_level(result)
        assert result["managementLevel"] == "简化管理"

    def test_result_has_all_expected_keys(self, sample_card1_data):
        result = parse_permit_from_cards({"card1": sample_card1_data})
        expected_keys = {
            "enterpriseName", "creditCode", "permitNumber", "issuingAuthority",
            "issueDate", "validFrom", "validTo", "industryCategory", "industryCode",
            "managementLevel", "address", "legalRepresentative", "phone", "email",
            "emissionOutlets", "managementRequirements",
        }
        assert expected_keys.issubset(set(result.keys()))


class TestExtractByRegex:
    def test_extract_simple(self):
        text = "名称：测试公司"
        result = _extract_by_regex(text, [r'名称[：:\s]*([^\n]+)'])
        assert result == "测试公司"

    def test_extract_no_match(self):
        result = _extract_by_regex("无匹配文本", [r'不存在[：:\s]*(\w+)'])
        assert result == ""

    def test_extract_multiple_patterns(self):
        text = "邮箱：test@example.com"
        result = _extract_by_regex(
            text,
            [r'电话[：:\s]*(\d+)', r'邮箱[：:\s]*([\w.@]+)'],
        )
        assert result == "test@example.com"
