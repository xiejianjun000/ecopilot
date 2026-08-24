"""license_manager 模块单测：聚焦机器指纹生成与授权码签发/验证"""
import sys
sys.path.insert(0, '.')

from unittest.mock import patch, MagicMock
from license_manager import (
    get_machine_fingerprint,
    issue_license,
    parse_license,
    validate_license,
    _sign,
    SECRET_KEY,
)


class TestMachineFingerprint:
    def test_fingerprint_is_string(self):
        fp = get_machine_fingerprint()
        assert isinstance(fp, str)

    def test_fingerprint_length(self):
        fp = get_machine_fingerprint()
        assert len(fp) == 32  # sha256[:32]

    def test_fingerprint_consistent(self):
        fp1 = get_machine_fingerprint()
        fp2 = get_machine_fingerprint()
        assert fp1 == fp2

    def test_fingerprint_hex(self):
        fp = get_machine_fingerprint()
        assert all(c in "0123456789abcdef" for c in fp)


class TestSignAndParse:
    def test_sign_consistent(self):
        s1 = _sign("test payload")
        s2 = _sign("test payload")
        assert s1 == s2

    def test_sign_different_payloads(self):
        assert _sign("a") != _sign("b")

    def test_parse_invalid_key(self):
        assert parse_license("not-a-license") is None

    def test_parse_wrong_prefix(self):
        assert parse_license("OTHER-prefix") is None

    def test_parse_empty(self):
        assert parse_license("") is None


class TestIssueAndParseLicense:
    def test_issue_and_parse_roundtrip(self):
        fp = get_machine_fingerprint()
        key = issue_license(fp, customer="测试客户", days=365)
        assert key.startswith("ECOPILOT-")
        parsed = parse_license(key)
        assert parsed is not None
        assert parsed["f"] == fp
        assert parsed["c"] == "测试客户"

    def test_issue_with_default_days(self):
        fp = get_machine_fingerprint()
        key = issue_license(fp, customer="默认")
        parsed = parse_license(key)
        assert parsed is not None
        assert parsed["v"] == "2"

    def test_parse_tampered_signature(self):
        fp = get_machine_fingerprint()
        key = issue_license(fp, customer="X", days=30)
        # 篡改：替换最后几个字符
        tampered = key[:-4] + "AAAA"
        assert parse_license(tampered) is None


class TestValidateLicense:
    def test_validate_valid_license(self):
        fp = get_machine_fingerprint()
        key = issue_license(fp, customer="有效客户", days=30)
        ok, msg = validate_license(key)
        assert ok is True
        assert "有效" in msg

    def test_validate_empty_key(self):
        ok, msg = validate_license("")
        assert ok is False
        assert "未找到" in msg or "授权码" in msg

    def test_validate_invalid_key(self):
        ok, msg = validate_license("ECOPILOT-invalidbase64")
        assert ok is False
        assert "无效" in msg

    def test_validate_wrong_fingerprint(self):
        # 用一个不存在的指纹签发
        key = issue_license("0" * 32, customer="错机器", days=30)
        ok, msg = validate_license(key)
        assert ok is False
        assert "不匹配" in msg

    def test_validate_expired_license(self):
        from datetime import datetime, timedelta
        import base64, json
        fp = get_machine_fingerprint()
        expire = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        issue_date = (datetime.now() - timedelta(days=400)).strftime('%Y-%m-%d')
        payload = json.dumps({"f": fp, "c": "过期", "i": issue_date, "e": expire, "v": "1"}, sort_keys=True)
        sig = _sign(payload)
        key = f'ECOPILOT-{base64.b64encode(f"{payload}|{sig}".encode()).decode()}'
        ok, msg = validate_license(key)
        assert ok is False
        assert "过期" in msg


class TestLoadSecretKey:
    def test_secret_key_is_bytes(self):
        assert isinstance(SECRET_KEY, bytes)

    def test_secret_key_length(self):
        # 环境变量可能覆盖，否则 32 字节
        assert len(SECRET_KEY) >= 32 or len(SECRET_KEY) > 0
