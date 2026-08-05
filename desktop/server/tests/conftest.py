"""pytest 全局 fixtures"""
import sys
import os
from pathlib import Path

# 将 server 根目录加入 sys.path，使测试可直接 import 各模块
_SERVER_ROOT = str(Path(__file__).resolve().parent.parent)
if _SERVER_ROOT not in sys.path:
    sys.path.insert(0, _SERVER_ROOT)

import pytest


@pytest.fixture
def sample_frontmatter_text():
    """包含 frontmatter 的示例 Markdown 文本"""
    return '---\ntitle: "Test"\ncategory: "法规"\n---\nbody text'


@pytest.fixture
def sample_card1_data():
    """card1 排污单位基本情况示例数据"""
    return {
        "name": "排污单位基本情况",
        "text": (
            "排污单位名称：测试钢铁有限公司\n"
            "统一社会信用代码：91110000MA01ABCD2X\n"
            "许可证编号：91110000MA01ABCD2X00001\n"
            "发证机关：XX市生态环境局\n"
            "法定代表人：张三\n"
            "生产经营场所地址：XX省XX市XX区XX路1号\n"
            "行业类别：黑色金属冶炼\n"
            "行业代码：C3110\n"
            "有效期限：2023-01-01 至 2028-01-01\n"
            "发证日期：2023-01-01\n"
            "管理类别：重点管理\n"
            "联系电话：13800138000\n"
            "电子邮箱：test@example.com\n"
            "邮政编码：100000\n"
        ),
        "tables": [],
    }


@pytest.fixture
def sample_card6_data():
    """card6 大气排放口示例数据"""
    return {
        "name": "大气排放口",
        "text": "DA001 烧结机头烟囱 SO2≤100 mg/m3 NOx≤200 mg/m3",
        "tables": [
            {"rows": [["DA001", "烧结机头烟囱", "SO2≤100 mg/m3"]]},
        ],
    }
