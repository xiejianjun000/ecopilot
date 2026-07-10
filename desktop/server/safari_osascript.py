"""
Safari 原生 AppleScript 驱动 — 绕过 safari-mcp 多窗口问题
直接通过 osascript do JavaScript 操作 Safari 的指定标签页
"""
import subprocess, json, time, re
from pathlib import Path

def find_permit_tab():
    """找到包含 permit.mee.gov.cn 的第一个标签页。返回 (window_index, tab_index)。"""
    script = '''
    tell application "Safari"
      repeat with w from 1 to count of windows
        repeat with t from 1 to count of tabs of window w
          try
            if URL of tab t of window w contains "permit.mee.gov.cn" and URL of tab t of window w does not contain "min_tzjl" and URL of tab t of window w does not contain "cas/login" then
              return (w as string) & "," & (t as string) & "," & (name of tab t of window w as string)
            end if
          end try
        end repeat
      end repeat
      return "not_found"
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=15)
    output = result.stdout.strip()
    if output == "not_found":
        return None, None, None
    parts = output.split(",")
    return int(parts[0]), int(parts[1]), parts[2] if len(parts) > 2 else ""

def focus_tab(win_idx, tab_idx):
    """聚焦到指定标签页。"""
    script = f'''
    tell application "Safari"
      set current tab of window {win_idx} to tab {tab_idx} of window {win_idx}
      set index of window {win_idx} to 1
      activate
    end tell
    '''
    subprocess.run(["osascript", "-e", script], capture_output=True, timeout=10)
    time.sleep(1)

def navigate(win_idx, tab_idx, url):
    """在指定标签页中导航。"""
    script = f'''
    tell application "Safari"
      set URL of tab {tab_idx} of window {win_idx} to "{url}"
    end tell
    '''
    subprocess.run(["osascript", "-e", script], capture_output=True, timeout=30)
    time.sleep(4)

def eval_js(win_idx, tab_idx, js_code):
    """在指定标签页执行 JavaScript 并返回结果。"""
    # Escape the JS for AppleScript
    escaped = js_code.replace('\\', '\\\\').replace('"', '\\"')
    script = f'''
    tell application "Safari"
      do JavaScript "{escaped}" in tab {tab_idx} of window {win_idx}
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)
    return result.stdout.strip()

def eval_json(win_idx, tab_idx, js_code):
    """执行 JS 并解析为 JSON 对象。"""
    raw = eval_js(win_idx, tab_idx, js_code)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except:
        return raw

def extract_tables(win_idx, tab_idx):
    """提取当前页面的所有表格。"""
    js = """
    (function(){
      return JSON.stringify(Array.from(document.querySelectorAll('table')).map(function(t){
        return {rows: Array.from(t.querySelectorAll('tr')).slice(0,100).map(function(r){
          return Array.from(r.querySelectorAll('td,th')).map(function(c){
            return c.innerText.trim().substring(0,200);
          });
        })};
      }).filter(function(t){return t.rows.length>1 && t.rows.some(function(r){return r.some(function(c){return c.length>2})})}));
    })()
    """
    raw = eval_js(win_idx, tab_idx, js)
    try:
        return json.loads(raw)
    except:
        return []

def extract_body(win_idx, tab_idx):
    """提取 body 文本。"""
    js = 'document.body?document.body.innerText.substring(0,15000):""'
    return eval_js(win_idx, tab_idx, js)

# ═══ 测试 ═══
if __name__ == "__main__":
    print("🔍 Safari AppleScript 驱动测试")

    w, t, name = find_permit_tab()
    if not w:
        print("❌ 未找到 permit 标签页")
        exit(1)

    print(f"✅ 找到标签页: window={w}, tab={t}, title={name}")

    focus_tab(w, t)
    text = extract_body(w, t)
    print(f"📄 Dashboard text ({len(text)} chars):")
    print(text[:1000])
