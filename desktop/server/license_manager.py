"""
EcoPilot 授权管理 — 机器绑定 + 授权码验证

用法:
  企业:  python license_manager.py fingerprint    # 生成机器指纹
  管理:  python license_manager.py issue -f <指纹> -c <客户名> -d <天数>
  验证:  python license_manager.py verify

  每次启动时 chat_api.py 自动调用 validate_license() 验证
"""

import hashlib, hmac, json, os, platform, re, subprocess, sys, time, uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

LICENSE_DIR = Path.home() / ".ecopilot-home"
LICENSE_FILE = LICENSE_DIR / "license.key"
STATE_FILE = LICENSE_DIR / ".runtime_state"
SECRET_KEY_FILE = LICENSE_DIR / ".license_secret"


@dataclass
class LicenseState:
    """v2 许可证运行时状态"""
    valid: bool = False
    customer: str = ""
    expire: str = ""
    days_left: int = 0
    tier: str = "free"            # free | pro_trial | pro | enterprise
    report_quota: int = 0         # -1=无限, N=剩余N份
    reports_used: int = 0         # 已使用份数
    trial_days: int = 0           # 试用天数, 0=非试用
    can_chat: bool = False        # 是否可用对话功能
    can_report: bool = False      # 是否可用报告生成
    version: str = "1"            # payload 版本号


def _load_secret_key() -> bytes:
    """从 ~/.ecopilot-home/.license_secret 读取密钥；
    文件不存在时生成随机 32 字节密钥并写入，权限 600。
    仅从文件读取，不支持环境变量覆盖（防止被绕过）。"""
    LICENSE_DIR.mkdir(parents=True, exist_ok=True)
    if SECRET_KEY_FILE.exists():
        try:
            data = SECRET_KEY_FILE.read_bytes()
            if len(data) >= 32:
                return data
        except Exception:
            pass
    # 首次运行：生成随机 32 字节密钥
    import secrets as _secrets
    key = _secrets.token_bytes(32)
    # 以 600 权限写入（O_CREAT 模式限制，Unix 平台）
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    try:
        fd = os.open(str(SECRET_KEY_FILE), flags, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(key)
    except OSError:
        # Windows 不支持 fd 权限，回退到普通写入后尝试 chmod
        SECRET_KEY_FILE.write_bytes(key)
        try:
            os.chmod(str(SECRET_KEY_FILE), 0o600)
        except OSError:
            pass
    return key


SECRET_KEY = _load_secret_key()

DEBUG_PROCS = ["gdb","lldb","ptrace","strace","dtrace","frida","hopper","ida","radare2","ollydbg","x64dbg","windbg","debugger"]
_cached = LicenseState()

# ── 机器指纹 ────────────────────────────────────────────────────────────────

def _mac_addrs() -> str:
    """稳定的硬件标识（uuid.getnode() 在某些环境返回随机值，需 fallback 到 ioreg）"""
    node = uuid.getnode()
    # 检测 uuid.getnode() 是否返回随机值（multicast bit 设置）
    if (node & 0x010000000000) == 0:
        # 真实 MAC 地址，使用它
        return ':'.join(f'{(node>>(40-8*i))&0xff:02x}' for i in range(6))
    # uuid.getnode() 返回随机值，fallback 到系统硬件标识
    try:
        if sys.platform == 'darwin':
            r = subprocess.run(['ioreg','-d2','-c','IOPlatformExpertDevice'],
                               capture_output=True, text=True, timeout=5)
            m = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', r.stdout)
            if m: return m.group(1)
        elif sys.platform.startswith('linux'):
            return Path('/etc/machine-id').read_text().strip()
        elif sys.platform == 'win32':
            r = subprocess.run(['wmic','csproduct','get','UUID'], capture_output=True, text=True, timeout=5, shell=True)
            lines = [l.strip() for l in r.stdout.split('\n') if l.strip() and 'UUID' not in l]
            if lines: return lines[0]
    except: pass
    return str(node)

def _board_serial() -> str:
    try:
        if sys.platform == 'darwin':
            r = subprocess.run(['system_profiler','SPHardwareDataType'], capture_output=True, text=True, timeout=5)
            for line in r.stdout.split('\n'):
                if 'Serial Number' in line or 'Hardware UUID' in line:
                    return line.split(':')[-1].strip()
        elif sys.platform.startswith('linux'):
            return Path('/sys/class/dmi/id/product_uuid').read_text().strip()
        elif sys.platform == 'win32':
            r = subprocess.run(['wmic','baseboard','get','serialnumber'], capture_output=True, text=True, timeout=5, shell=True)
            return r.stdout.strip().split('\n')[-1].strip()
    except: pass
    return ''

def get_machine_fingerprint() -> str:
    raw = '|'.join([_mac_addrs(), _board_serial(), platform.node(), platform.system(), platform.machine()])
    return hashlib.sha256(raw.encode()).hexdigest()[:32]

# ── 授权码签发/验证 ────────────────────────────────────────────────────────

def _sign(payload: str) -> str:
    return hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest()

def issue_license(fingerprint: str, customer: str = "", days: int = 365,
                  tier: str = "pro", report_quota: int = -1, trial_days: int = 0) -> str:
    """签发 v2 许可证: 支持套餐等级 + 报告配额 + 试用天数"""
    expire = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')
    issue_date = datetime.now().strftime('%Y-%m-%d')
    # v2 payload: 新增 tier / report_quota / reports_used / trial_days
    payload = json.dumps({
        "f": fingerprint, "c": customer, "i": issue_date, "e": expire, "v": "2",
        "tier": tier, "report_quota": report_quota, "reports_used": 0,
        "trial_days": trial_days,
    }, sort_keys=True)
    sig = _sign(payload)
    import base64
    return f'ECOPILOT-{base64.b64encode(f"{payload}|{sig}".encode()).decode()}'


def parse_license(key: str) -> Optional[dict]:
    try:
        if not key.startswith('ECOPILOT-'): return None
        import base64
        decoded = base64.b64decode(key[9:]).decode()
        payload_str, sig = decoded.rsplit('|', 1)
        if not hmac.compare_digest(sig, _sign(payload_str)): return None
        return json.loads(payload_str)
    except: return None

def validate_license(key: str) -> tuple[bool, str]:
    """验证许可证，同时更新 LicenseState 缓存"""
    global _cached
    if not key or not key.strip():
        _cached = LicenseState()
        return False, '未找到授权码。请将授权码放入 ~/.ecopilot-home/license.key'

    p = parse_license(key.strip())
    if not p:
        _cached = LicenseState()
        return False, '授权码无效（签名验证失败）'

    current = get_machine_fingerprint()
    if p.get('f') != current:
        _cached = LicenseState()
        return False, f'授权码不匹配当前机器\n指纹: {current}'

    try:
        exp = datetime.strptime(p['e'], '%Y-%m-%d')
        if datetime.now() > exp:
            _cached = LicenseState()
            return False, f'授权已过期 {(datetime.now()-exp).days} 天 ({p["e"]})'
    except ValueError:
        _cached = LicenseState()
        return False, f'日期格式错误: {p["e"]}'

    _check_time()
    days_left = (datetime.strptime(p['e'], '%Y-%m-%d') - datetime.now()).days

    # v2 payload 字段（兼容 v1 旧格式）
    tier = p.get('tier', 'pro')
    quota = p.get('report_quota', -1)
    used = p.get('reports_used', 0)
    trial = p.get('trial_days', 0)
    ver = p.get('v', '1')

    # 试用到期自动降级为 chat-only
    is_trial_expired = False
    if trial > 0:
        try:
            issue_dt = datetime.strptime(p['i'], '%Y-%m-%d')
            trial_end = issue_dt + timedelta(days=trial)
            if datetime.now() > trial_end:
                is_trial_expired = True
        except: pass

    quota_left = max(0, quota - used) if quota >= 0 else -1
    can_report = (not is_trial_expired) and (quota_left != 0)
    can_chat = tier in ("pro_trial", "pro", "enterprise") or (tier == "free" and ver == "1")

    _cached = LicenseState(
        valid=True, customer=p.get('c', ''), expire=p['e'],
        days_left=days_left, tier=tier, report_quota=quota,
        reports_used=used, trial_days=trial,
        can_chat=can_chat, can_report=can_report, version=ver,
    )
    return True, f'授权有效 (客户: {p.get("c","未知")}, 套餐: {tier}, 剩余 {days_left} 天)'


def _check_time():
    LICENSE_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    if STATE_FILE.exists():
        try:
            last = json.loads(STATE_FILE.read_text()).get('last_check', 0)
            # 时间回拨超过1小时（忽略NTP微调）
            if now < last - 3600:
                pass  # 记录但不阻断
        except: pass
    STATE_FILE.write_text(json.dumps({"last_check": now, "last_startup": datetime.now().isoformat()}))

def get_license_status() -> dict:
    return {
        "valid": _cached.valid,
        "customer": _cached.customer,
        "expire": _cached.expire,
        "days_left": _cached.days_left,
        "tier": _cached.tier,
        "report_quota": _cached.report_quota,
        "reports_used": _cached.reports_used,
        "quota_left": max(0, _cached.report_quota - _cached.reports_used) if _cached.report_quota >= 0 else -1,
        "trial_days": _cached.trial_days,
        "can_chat": _cached.can_chat,
        "can_report": _cached.can_report,
        "version": _cached.version,
    }

def get_license_state() -> LicenseState:
    """获取当前完整的 LicenseState 对象"""
    return _cached

def bump_report_usage() -> bool:
    """报告生成后递增 usage 计数，同时更新本地 license.key payload"""
    global _cached
    if not _cached.valid or not _cached.can_report:
        return False
    if _cached.report_quota >= 0:
        _cached.reports_used += 1
        _cached.can_report = (_cached.report_quota - _cached.reports_used) > 0 or _cached.report_quota < 0
        # 回写 license.key（更新 reports_used）
        _rewrite_license()
    return True

def _rewrite_license():
    """将当前 LicenseState 回写到 license.key 文件中"""
    if not _cached.valid:
        return
    payload = json.dumps({
        "f": get_machine_fingerprint(),
        "c": _cached.customer, "i": "", "e": _cached.expire, "v": _cached.version,
        "tier": _cached.tier, "report_quota": _cached.report_quota,
        "reports_used": _cached.reports_used, "trial_days": _cached.trial_days,
    }, sort_keys=True)
    sig = _sign(payload)
    import base64
    key = f'ECOPILOT-{base64.b64encode(f"{payload}|{sig}".encode()).decode()}'
    try:
        LICENSE_FILE.write_text(key)
    except: pass

def apply_new_license(key: str) -> bool:
    """应用新许可证（升级/续费场景）"""
    ok, _ = validate_license(key)
    if ok:
        _rewrite_license()
    return ok

# ── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(description='EcoPilot 授权管理')
    sp = p.add_subparsers(dest='cmd')

    sp.add_parser('fingerprint', help='生成机器指纹')

    ip = sp.add_parser('issue', help='签发授权码（管理员）')
    ip.add_argument('--fingerprint','-f', required=True)
    ip.add_argument('--customer','-c', default='')
    ip.add_argument('--days','-d', type=int, default=365)

    vp = sp.add_parser('verify', help='验证授权码')
    vp.add_argument('--license','-l', help='授权码（默认从 license.key 读取）')

    args = p.parse_args()

    if args.cmd == 'fingerprint':
        fp = get_machine_fingerprint()
        print(f'机器指纹: {fp}')
        print(f'主机名:   {platform.node()}')
        print(f'系统:     {platform.system()} {platform.machine()}')
        print(f'\n请将此指纹发送给管理员以获取授权码')

    elif args.cmd == 'issue':
        key = issue_license(args.fingerprint, args.customer, args.days)
        print(f'授权码:\n{key}')
        pl = parse_license(key)
        if pl: print(f'\n客户: {pl.get("c")}\n有效期: {pl["i"]} ~ {pl["e"]}\n绑定: {pl["f"]}')
        # 若签发目标即本机，自动写入 license.key，避免手动保存遗漏
        if args.fingerprint == get_machine_fingerprint():
            LICENSE_DIR.mkdir(parents=True, exist_ok=True)
            LICENSE_FILE.write_text(key + '\n')
            print(f'\n✅ 指纹与本机一致，授权码已自动写入 {LICENSE_FILE}')
        else:
            print(f'\n提示: 目标指纹非本机，请将授权码发送至目标机器并保存为 {LICENSE_FILE}')

    elif args.cmd == 'verify':
        if args.license: k = args.license
        elif LICENSE_FILE.exists(): k = LICENSE_FILE.read_text().strip()
        else: print('❌ 未找到 license.key'); sys.exit(1)
        ok, msg = validate_license(k)
        print(f'{"✅" if ok else "❌"} {msg}')
        sys.exit(0 if ok else 1)

    else: p.print_help()
