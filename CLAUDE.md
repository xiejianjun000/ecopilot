# EcoPilot 排污许可平台 - 登录与许可证读取测试

## 当前状况

执行报告导出已经全部完成：
- 2024 Q1-Q4 + 年报 ✅
- 2025 Q1-Q3 + 年报 ✅  
- 2026 Q1 ✅
- hash 污染修复方案已验证通过

## 现在要做的：测试 permit_scraper.py 的登录 + 许可证读取

之前你做了很多版本的 permit-v*.py 测试脚本，现在直接在 `/Users/mac/Desktop/ecopilot/desktop/server/` 目录下，用原来的 permit_scraper.py 和 license_reader.py 做完整测试。

### Step 1: 清理环境

```bash
pkill -9 -f "playwright\|chrome-headless\|chat_api" 2>/dev/null
lsof -i :8002 && pkill -9 -f "chat_api" 2>/dev/null || true
```

### Step 2: 测试直接调用 permit_scraper 登录

```bash
cd /Users/mac/Desktop/ecopilot/desktop/server

python3 -c "
import asyncio
from permit_scraper import start_login_session, submit_login, close_session

async def test():
    s = await start_login_session()
    print(f'Page URL: {s.page.url}')
    print(f'Captcha base64 length: {len(s.captcha_base64)}')
    print(f'Login ok')

asyncio.run(test())
"
```

### Step 3: 如果上述正常，测试完整登录+许可证读取

```python
# 关键：先通过 read_license_full 读取完整的20项许可证数据
import asyncio
from permit_scraper import start_login_session, submit_login, refresh_captcha, close_session
from license_reader import read_license_full

async def test():
    # 登录（需要处理验证码）
    s = await start_login_session()
    # ... 输入验证码等
    result = await read_license_full(s.session_id)
    print(result)

asyncio.run(test())
```

### 已知问题
1. CAS 验证码需要手动识别或用 Kimi Vision API（quick_login 函数）
2. 注意 Playwright headless 模式可能被 CAS 安全检测拦截
3. 许可证 dataid 需要从变更列表获取（`_get_dataid` 函数已实现）
