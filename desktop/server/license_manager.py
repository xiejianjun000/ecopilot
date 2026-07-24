"""
EcoPilot 授权管理 — 机器绑定 + 授权码验证

用法:
  企业:  python license_manager.py fingerprint    # 生成机器指纹
  管理:  python license_manager.py issue -f <指纹> -c <客户名> -d <天数>
  验证:  python license_manager.py verify

  每次启动时 chat_api.py 自动调用 validate_license() 验证
"""

import hashlib, hmac, json, os, platform, re, subprocess, sys, time, uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

LICENSE_DIR = Path.home() / ".ecopilot-home"
LICENSE_FILE = LICENSE_DIR / "license.key"
STATE_FILE = LICENSE_DIR / ".runtime_state"
SECRET_KEY_FILE = LICENSE_DIR / ".license_secret"


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
_cached = {"valid": False, "customer": "", "expire": ""}

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

def issue_license(fingerprint: str, customer: str = "", days: int = 365) -> str:
    expire = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')
    issue_date = datetime.now().strftime('%Y-%m-%d')
    payload = json.dumps({"f": fingerprint, "c": customer, "i": issue_date, "e": expire, "v": "1"}, sort_keys=True)
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
    if not key or not key.strip():
        return False, '未找到授权码。请将授权码放入 ~/.ecopilot-home/license.key'

    p = parse_license(key.strip())
    if not p: return False, '授权码无效（签名验证失败）'

    current = get_machine_fingerprint()
    if p.get('f') != current:
        return False, f'授权码不匹配当前机器\n指纹: {current}'

    try:
        exp = datetime.strptime(p['e'], '%Y-%m-%d')
        if datetime.now() > exp:
            return False, f'授权已过期 {(datetime.now()-exp).days} 天 ({p["e"]})'
    except ValueError:
        return False, f'日期格式错误: {p["e"]}'

    _check_time()
    _cached.update({"valid": True, "customer": p.get('c',''), "expire": p['e']})
    days_left = (datetime.strptime(p['e'], '%Y-%m-%d') - datetime.now()).days
    return True, f'授权有效 (客户: {p.get("c","未知")}, 剩余 {days_left} 天)'

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
    days = 0
    if _cached['expire']:
        try: days = (datetime.strptime(_cached['expire'],'%Y-%m-%d')-datetime.now()).days
        except: pass
    return {"valid": _cached['valid'], "customer": _cached['customer'], "expire": _cached['expire'], "days_left": days}

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

    elif args.cmd == 'verify':
        if args.license: k = args.license
        elif LICENSE_FILE.exists(): k = LICENSE_FILE.read_text().strip()
        else: print('❌ 未找到 license.key'); sys.exit(1)
        ok, msg = validate_license(k)
        print(f'{"✅" if ok else "❌"} {msg}')
        sys.exit(0 if ok else 1)

    else: p.print_help()
