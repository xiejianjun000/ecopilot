"""常量定义：URL、业务枚举、默认值。

集中管理所有外部 URL 与业务枚举（searchType / businessType / applyType /
registerType / changeType），供服务层与工具层统一引用，避免散落魔法字符串。
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# 平台根与关键 URL（BASE 在 config 中可被 PERMIT_BASE_URL 覆盖）
# ---------------------------------------------------------------------------
DEFAULT_BASE_URL = "https://permit.mee.gov.cn"

# CAS 单点登录跳转目标（登录成功后跳转至此建立应用会话）
LICENSE_REDIRECT_PATH = "/permitExt/outside/LicenseRedirect"

# 内部 Struts2 模块统一前缀（研究报告 §模块4：POST /permitExt/syssb/...）
INTERNAL_PREFIX = "/permitExt"

# 监测记录独立子系统（模块 14，REST，UTF-8 JSON）
MONITOR_SSO_URL = "https://wryjc.cnemc.cn/eap/SingleSignOnXKZ"
MONITOR_API_BASE = "https://wryjc.cnemc.cn/hb"

# 执行报告 / 统一报表 Vue SPA（模块 13/17）
PERMITREP_PATH = "/permitrep"

# 公开「许可信息公开」查询（无需登录，结果表含许可证有效期限/发证日期）
PUBLIC_LICENSE_INFO_PATH = "/perxxgkinfo/syssb/xkgg/xkgg!licenseInformation.action"


# ---------------------------------------------------------------------------
# 业务枚举
# ---------------------------------------------------------------------------
class SearchType:
    """许可证业务列表「审核状态」枚举（模块 4/5/6/7 通用）。"""

    ALL = "ZT_0"          # 全部
    UNSUBMITTED = "ZT_1"  # 未提交
    SUBMITTED = "ZT_2"    # 已提交等待受理
    APPROVING = "ZT_3"    # 审批中
    APPROVED = "ZT_4"     # 审批通过
    REJECTED = "ZT_5"     # 审批不通过
    SUPPLEMENT = "ZT_7"   # 补正
    NOT_ACCEPTED = "ZT_8"  # 不予受理

    VALUES = {
        "ZT_0": "全部",
        "ZT_1": "未提交",
        "ZT_2": "已提交等待受理",
        "ZT_3": "审批中",
        "ZT_4": "审批通过",
        "ZT_5": "审批不通过",
        "ZT_7": "补正",
        "ZT_8": "不予受理",
    }


class BusinessType:
    """执行报告 / 统一报表业务类型枚举（模块 13/17）。"""

    REPORT = "RT"         # 执行报告
    UNIFIED = "ENV"       # 统一报表（试运行）

    VALUES = {
        "RT": "执行报告",
        "ENV": "统一报表",
    }


class ApplyType:
    """许可证申请子项枚举（模块 3）。"""

    FIRST = "first"               # 首次申请
    SUPPLEMENT = "supplement"     # 补充申请
    RECTIFICATION = "rectification"  # 整改后申请

    VALUES = {
        "first": "首次申请",
        "supplement": "补充申请",
        "rectification": "整改后申请",
    }


class RegisterType:
    """排污登记子项枚举（模块 10）。"""

    REGISTER = "register"   # 排污登记
    BCBG = "bcbg"           # 登记变更
    DJYX = "djyx"           # 登记延续
    CANCEL = "cancel"       # 登记注销

    VALUES = {
        "register": "排污登记",
        "bcbg": "登记变更",
        "djyx": "登记延续",
        "cancel": "登记注销",
    }


class ChangeType:
    """许可证变更子项枚举（模块 5）。"""

    BASIC = "basic"   # 基本信息变更
    OTHER = "other"   # 其他情况变更

    VALUES = {
        "basic": "许可证基本信息变更",
        "other": "许可证变更（其他情况）",
    }


# ---------------------------------------------------------------------------
# 内部模块 action 端点（相对 INTERNAL_PREFIX）
# ---------------------------------------------------------------------------
class Endpoints:
    """内部 Struts2 action 端点常量。

    ``itemTypeID`` / ``itemtype`` / ``searchItem`` 为模块固定查询参数。
    """

    # 模块 3：许可证申请预检
    CHECK_REGISTER = "/syssb/ckxm/ckxm!checkRegister.action"    # 检查统一社会信用代码
    CHECK_IS_CANCEL = "/syssb/ckxm/ckxm!checkIscancelNew.action"  # 检查是否已注销
    ZGHSQ_LIST = "/syssb/bctb/zghsq!list.action"                # 整改后申请列表

    # 模块 2：自主验收预检
    CHECK_ENTER = "/syssb/ckxm/ckxm!checkEnter.action"

    # 模块 4：重新申请
    REAPPLY_LIST = "/syssb/ckxm/ckxm!listCxsq.action"
    # 模块 5：变更
    CHANGE_LIST = "/syssb/ckxm/ckxm!listBcbg.action"
    # 模块 6：调整
    ADJUST_LIST = "/syssb/ckxm/ckxm!listTz.action"
    # 模块 7：延续
    RENEW_LIST = "/syssb/ckxm/ckxm!listBcyx.action"
    # 模块 8：补办（遗失声明）
    REISSUE_LIST = "/syssb/xkzbb/xkzbb!listYssm.action"
    REISSUE_DETAIL = "/syssb/xkzbb/xkzbb!showYssm.action"          # 遗失声明查看
    # 模块 9：土壤管理（涉重登记）
    SOIL_LIST = "/syssb/sqdj/sqdj!listSqdjZc.action"
    SOIL_DETAIL = "/syssb/sqdj/sqdj!editSqdjZc.action"             # 涉重登记详情/编辑
    SOIL_COMMENT = "/syssb/sqdj/sqdj!showcommentSqdj.action"       # 涉重登记审批意见
    # 模块 11：信息公开
    DISCLOSURE_LIST = "/syssb/xxgk/xxgk!list.action"
    DISCLOSURE_DETAIL = "/syssb/xxgk/xxgk!show.action"             # 信息公开详情
    DISCLOSURE_FEEDBACK = "/syssb/xxgk/xxgk!showCcfkPageList.action"  # 公众反馈
    DISCLOSURE_OPINION = "/syssb/xxgk/xxgk!getSpyj.action"         # 审批意见
    # 模块 12：台账记录（返回 ticket）
    LEDGER = "/tzjl/tzjl!tzjl.action"
    # 模块 14：监测记录（返回监测子系统 SSO tokenId 表单）
    JCJL = "/jcjl/jcjl!jcjl.action"

    # 模块 10：排污登记（Velocity 子页面，需先经 REGISTER_SSO 建立 jsessionid）
    REGISTER_SSO = "/register/sso/autoLoginExt.vm"                  # SSO 自动登录入口（?userCode=）
    REGISTER_LIST = "/register/registration/list.vm"
    REGISTER_DETAIL = "/register/registration/edit.vm"              # 登记详情/编辑（?sqdjid=）
    REGISTER_BCBG = "/register/bcbg/listDjbg.vm"
    REGISTER_DJYX = "/register/bcbg/listDjyx.vm"
    REGISTER_CANCEL = "/register/cancel/list.vm"


# ---------------------------------------------------------------------------
# itemtype / itemTypeID / searchItem 固定值（来自研究报告）
# ---------------------------------------------------------------------------
ITEM_REAPPLY = ("XZXKTYPE_A", "TYPEI", None)
ITEM_CHANGE_BASIC = ("XZXKTYPE_C", "TYPEC", "TYPEC_2")
ITEM_CHANGE_OTHER = ("XZXKTYPE_A", "TYPEC", "TYPEC_1")
ITEM_ADJUST = ("XZXKTYPE_A", "TYPEK", None)
ITEM_RENEW = ("XZXKTYPE_D", "TYPED", None)


# ---------------------------------------------------------------------------
# 许可证详情卡片（模块 4/5/6/7「查看」详情 = 许可证 20 卡）
#
# 详情页 URL 形如：
#   {base}/permitExt/syssb/wysb/hpsp/hpsp!pwxkInfo.action
#       ?dataid={dataid}&operate=readonly&cardid=card1&itemtypeid=XZXKTYPE_A
#
# action_path 到完整 URL 的映射见 PlaywrightDriver._license_card_url：
#   hpsp!*            -> /permitExt/syssb/wysb/hpsp/{path}
#   hpsp/*            -> /permitExt/syssb/wysb/{path}
#   cpcn*             -> /permitExt/syssb/cpcn/{path}
#   ../*              -> /permitExt/common/{path[3:]}
# ---------------------------------------------------------------------------
LICENSE_CARDS = [
    ("card50", "阅读填报指南", "hpsp!guid.action"),
    ("card1", "排污单位基本情况", "hpsp!pwxkInfo.action"),
    ("card2", "主要产品及产能", "cpcn!product.action"),
    ("card3", "产品及产能补充", "cpcn-extend!product.action"),
    ("card4", "原辅材料及燃料", "hpsp/yfrl/yuan-fu-ran-liao!fuel.action"),
    ("card5", "排污节点及治理设施", "hpsp!zlss.action"),
    ("card6", "大气排放口", "hpsp/dqinfo!airDischargePort.action"),
    ("card7", "有组织排放信息", "hpsp/airyzz!gasGroup.action"),
    ("card8", "无组织排放信息", "hpsp/wzzpfxx/wzzpfxx!noGroupDischarge.action"),
    ("card9", "大气排放总许可量", "hpsp!gasEnterprise.action"),
    ("card10", "水排放口", "hpsp/fsinfo!swrwInfo.action"),
    ("card11", "水排放信息", "hpsp/waterpfxx!waterGroup.action"),
    ("card12", "固体废物管理信息", "hpsp/gtfw/gtfw!gtfqwpfInfo.action"),
    ("card13", "工业噪声排放信息", "hpsp/sound/sound!soundInfo.action"),
    ("card14", "自行监测要求", "hpsp/zxjc/zxjc!waterFqwrw.action"),
    ("card15", "台账记录要求", "hpsp/hjgltz/hjgltz!account.action"),
    ("card16", "补充登记信息", "hpsp/bcdj!registration.action"),
    ("card17", "地方增加内容", "hpsp!partContent.action"),
    ("card18", "相关附件", "../filecontrol/file-control!sbclopen.action?wysbtype=PWXKZFILE"),
    ("card19", "提交申请", "hpsp!accept.action"),
]

# 许可证详情数据卡（排除阅读指南 / 附件 / 提交申请，只读数据正文）
LICENSE_DATA_CARDS = [c[0] for c in LICENSE_CARDS if c[0] not in ("card50", "card18", "card19")]


# ---------------------------------------------------------------------------
# 模块 14 监测记录 API（REST，GET + csrfToken）
# ---------------------------------------------------------------------------
MONITOR_CURRENT_USER = "/problemRegister/currentUser"
MONITOR_ENTERPRISE_INFO = "/hbSjcjQyJcxx/fasfgx"                  # 企业监测信息
MONITOR_MONTH_STATUS = "/hbSjcjQyJgtj/getQyJcqkOfMonthToToday"    # 月度监测情况
MONITOR_MONTH_DATA = "/hbSjcjQyJgtj/getQySjqkOfMonth"             # 月度数据情况
MONITOR_MANUAL_RECORDS = "/hbSjcjQySglr/querySgjg"                # 手工监测结果明细
MONITOR_ONLINE_RECORDS = "/hbSjcjQyZxlr/selectQyJcxxJgTree"       # 在线监测数据明细
MONITOR_DAY_STAT = "/hbSjcjQyJgtj/tjCurrentQyOfOneDay"            # 当日监测统计


# ---------------------------------------------------------------------------
# 18 模块菜单定义（company_menu 静态来源）
# ---------------------------------------------------------------------------
MODULE_MENU = [
    {"no": 1, "state": "hpsburl", "name": "环评申报（试用）", "group": "环境影响评价", "restricted": True, "reason": "JS challenge 反爬（HTTP 412），预留"},
    {"no": 2, "state": "zzysurl", "name": "自主验收", "group": "环境影响评价", "restricted": False, "reason": ""},
    {"no": 3, "state": "xkzsq", "name": "许可证申请", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 4, "state": "xkzsq", "name": "许可证重新申请", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 5, "state": "xkzsq", "name": "许可证变更", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 6, "state": "xkzsq", "name": "许可证调整", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 7, "state": "xkzzx", "name": "许可证延续", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 8, "state": "xkzbb", "name": "许可证补办", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 9, "state": "soil", "name": "土壤管理", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 10, "state": "sqdj", "name": "排污登记", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 11, "state": "xkzsq", "name": "信息公开", "group": "许可证业务", "restricted": False, "reason": ""},
    {"no": 12, "state": "tzjl", "name": "台账记录", "group": "许可证执行记录", "restricted": False, "reason": ""},
    {"no": 13, "state": "zxbg", "name": "执行报告", "group": "许可证执行记录", "restricted": False, "reason": ""},
    {"no": 14, "state": "jcjl", "name": "监测记录", "group": "许可证执行记录", "restricted": False, "reason": ""},
    {"no": 15, "state": "gzgd", "name": "改正规定", "group": "许可证执行记录", "restricted": True, "reason": "系统返回「暂未启用」"},
    {"no": 16, "state": "zdjkurl", "name": "自动监控", "group": "许可证执行记录", "restricted": True, "reason": "需滑块拼图 + 独立账号，预留"},
    {"no": 17, "state": "zxbg", "name": "统一报表（试运行）", "group": "许可证执行记录", "restricted": False, "reason": ""},
    {"no": 18, "state": "hpsburl", "name": "碳排放报送（内部测试）", "group": "碳排放情况", "restricted": True, "reason": "内部测试系统 + headless 拦截，预留"},
]

RESTRICTED_STATES = {m["state"] for m in MODULE_MENU if m["restricted"]}


# ---------------------------------------------------------------------------
# HTTP 默认值
# ---------------------------------------------------------------------------
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
