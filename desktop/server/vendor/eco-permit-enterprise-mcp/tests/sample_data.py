"""测试用样例数据：登录页 HTML 与重新申请列表 HTML（与真实结构一致）。"""

from __future__ import annotations

# 测试用 RSA 公钥（真实平台的 modulus/exponent 结构）
TEST_MODULUS = (
    "00804416b53989ef90d09586cf85f15e053f3367e28f0ed8325887521c048c0c"
    "bbdaff77fbc7aa0e1d5dd76b68e7672a645dde78665cfddf15485aefad2e4021"
    "44b32f2433f4616438cc9fb46262ac2d6772c15d2ba5d86a237d46015dcd4876"
    "d74f3f66c31d163d42af385621433f98e2284ff6a0139f483bbfd750c506f31665"
)
TEST_EXPONENT = "010001"
TEST_SALT = "GqRB"

LOGIN_PAGE_HTML = f"""
<html><body>
<form id="fm1" action="/cas/login" method="post">
  <input type="hidden" name="lt" value="LT-123456-example" />
  <input type="hidden" name="execution" value="e1s1" />
  <input type="hidden" name="_eventId" value="submit" />
  <input type="hidden" id="hid_modulus" value="{TEST_MODULUS}" />
  <input type="hidden" id="hid_exponent" value="{TEST_EXPONENT}" />
</form>
<script>
  $("#hideusername").val(RSAUtils.encryptedString(key, $("#username").val() + "{TEST_SALT}"));
</script>
</body></html>
"""

REAPPLY_TABLE_HTML = """
<html><body>
<table>
  <tr><td>序号</td><td>单位名称</td><td>审核状态</td><td>提交时间</td><td>操作</td></tr>
  <tr><td>1</td><td>冷水江钢铁有限责任公司</td><td>审批通过</td><td>2021-01-22</td><td>查看</td></tr>
  <tr><td>2</td><td>冷水江钢铁有限责任公司</td><td>审批中</td><td>2022-03-15</td><td>查看</td></tr>
  <tr><td>3</td><td>冷水江钢铁有限责任公司</td><td>未提交</td><td>2023-06-01</td><td>继续重新申请</td></tr>
  <tr><td>4</td><td>冷水江钢铁有限责任公司</td><td>审批通过</td><td>2024-11-30</td><td>查看</td></tr>
</table>
</body></html>
"""

__all__ = ["LOGIN_PAGE_HTML", "REAPPLY_TABLE_HTML", "TEST_MODULUS", "TEST_EXPONENT", "TEST_SALT"]
