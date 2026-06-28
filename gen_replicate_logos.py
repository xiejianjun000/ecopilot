#!/usr/bin/env python3
"""用 Replicate Flux 生成 EcoPilot Logo"""
import os, json, time, subprocess, textwrap
from urllib import request
from urllib.error import HTTPError

TOKEN = "r8_8nr...MXNP"
OUT_DIR = os.path.expanduser("~/Desktop/ecopilot/logo-replicate")
os.makedirs(OUT_DIR, exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}

CONCEPTS = [
    {
        "id": "ec-monogram",
        "desc": "EC 连笔字母",
        "prompt": (
            "A minimalist professional brand logo. "
            "A clean abstract monogram combining letters E and C into one flowing continuous line. "
            "Smooth modern curves, elegant brand identity. "
            "Color is emerald green (#059669) on pure white background. "
            "Vector style, crisp edges, no text, no shadows, no gradients. "
            "Simple flat vector, professional corporate identity."
        ),
    },
    {
        "id": "eco-stacked",
        "desc": "ECO 三模块叠放",
        "prompt": (
            "Modern minimalist brand logo. "
            "Three geometric modules arranged vertically forming letters E, C, O. "
            "Clean corporate technology aesthetic. "
            "Precise 90-degree corners mixed with subtle rounded edges. "
            "Single emerald green (#059669) color, pure white background. "
            "Vector style, no text, no shadows, no gradients. "
            "Professional logo design, crisp edges."
        ),
    },
    {
        "id": "angular-e",
        "desc": "锐角切割 E",
        "prompt": (
            "Bold minimalist brand logo. "
            "Letter E dramatically cut by a sharp diagonal line. "
            "Angular geometric aesthetic, precision engineering feel. "
            "The cut creates negative space that hints at letter C. "
            "Single emerald green (#059669) color, pure white background. "
            "Vector style, no text, no shadows, no gradients. "
            "Corporate identity, clean edges."
        ),
    },
    {
        "id": "flowing-line",
        "desc": "流动线条 E+C+O",
        "prompt": (
            "Elegant minimalist brand logo. "
            "A single continuous flowing line that traces letters E, C, O "
            "in one smooth motion. Calligraphic yet geometric. "
            "Fluid curves suggesting data flow and monitoring. "
            "Professional corporate identity. "
            "Single emerald green (#059669) color, pure white background. "
            "Vector style, no text, no shadows, no gradients."
        ),
    },
    {
        "id": "negative-space",
        "desc": "负空间 E 形",
        "prompt": (
            "Clever minimalist brand logo. "
            "Negative space design: a solid emerald green geometric shape "
            "with letter E carved out as negative space. "
            "Modern, sophisticated, minimal. "
            "Single emerald green (#059669) color, pure white background. "
            "Vector style, no text, no shadows, no gradients."
        ),
    },
    {
        "id": "folded-origami",
        "desc": "折叠折纸 E",
        "prompt": (
            "Modern minimalist brand logo. "
            "Origami-inspired folded letter shapes creating 3D depth through "
            "angular fold lines on a flat 2D surface. "
            "Clean geometric folds suggesting precision and innovation. "
            "Single emerald green (#059669) color, pure white background. "
            "Vector style, no text, no shadows, no gradients."
        ),
    },
    {
        "id": "grid-intersect",
        "desc": "网格交织 E+C",
        "prompt": (
            "Technology brand logo. "
            "Letters E and C formed by intersecting grid lines, "
            "creating a data network visualization aesthetic. "
            "The intersection points suggest monitoring nodes. "
            "Clean emerald green (#059669) on pure white background. "
            "Vector style, no text, no shadows, no gradients."
        ),
    },
    {
        "id": "ring-wrap",
        "desc": "环形包裹 E",
        "prompt": (
            "Brand logo. "
            "Letter E partially wrapped by a circular arc (letter O). "
            "The arc opens on one side suggesting forward motion. "
            "Modern elegant corporate identity. "
            "Single emerald green (#059669) color, pure white background. "
            "Vector style, no text, no shadows, no gradients."
        ),
    },
]

def run_replicate(prompt, cid, retries=2):
    """调用 Replicate Flux API"""
    data = json.dumps({
        "version": "black-forest-labs/flux-dev",
        "input": {
            "prompt": prompt,
            "num_inference_steps": 28,
            "guidance_scale": 7.5,
            "width": 1024,
            "height": 1024,
            "num_outputs": 1,
        }
    }).encode()
    
    for attempt in range(retries):
        try:
            req = request.Request(
                "https://api.replicate.com/v1/predictions",
                data=data, headers=HEADERS, method="POST"
            )
            with request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read())
            
            # 等待完成
            get_url = result["urls"]["get"]
            while True:
                time.sleep(3)
                req2 = request.Request(get_url, headers=HEADERS)
                with request.urlopen(req2, timeout=30) as resp2:
                    status = json.loads(resp2.read())
                if status["status"] in ("succeeded", "failed", "canceled"):
                    break
            
            if status["status"] == "succeeded":
                output_urls = status["output"]
                if isinstance(output_urls, list) and len(output_urls) > 0:
                    # 下载
                    img_url = output_urls[0]
                    out_path = os.path.join(OUT_DIR, f"{cid}.png")
                    request.urlretrieve(img_url, out_path)
                    print(f"  ✓ {cid}: {out_path}")
                    return out_path
            else:
                print(f"  ✗ {cid}: {status.get('error', status['status'])}")
        except Exception as e:
            print(f"  ⚠ {cid} attempt {attempt+1}: {e}")
            time.sleep(5)
    return None

if __name__ == "__main__":
    print(f"Generating {len(CONCEPTS)} EcoPilot logos via Flux...")
    print("=" * 50)
    
    results = []
    for c in CONCEPTS:
        print(f"\n[{c['id']}] {c['desc']}")
        path = run_replicate(c["prompt"], c["id"])
        if path:
            results.append(c)
    
    # 生成预览 HTML
    html_parts = ["""<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EcoPilot Flux Logos</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#1a1b1e;color:#d2d3e0;padding:40px}
h1{font-size:24px;font-weight:600;margin-bottom:8px}
.sub{font-size:13px;color:#858699;margin-bottom:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.card{background:#212234;border-radius:14px;border:1px solid #2a2c31;overflow:hidden}
.card-img{display:flex;align-items:center;justify-content:center;padding:20px;background:#111;min-height:300px}
.card-img img{max-width:100%;max-height:280px;object-fit:contain;border-radius:8px}
.card-body{padding:16px 20px 20px;border-top:1px solid #2a2c31}
.card-body .id{font-size:10px;color:#059669;font-weight:600;letter-spacing:0.4px;margin-bottom:2px}
.card-body .name{font-size:14px;font-weight:600;margin-bottom:4px}
.card-body .prompt{font-size:11px;color:#858699;line-height:1.5}
</style></head><body>
<h1>EcoPilot · Flux 生成 Logo</h1>
<p class="sub">8 个概念方向 · Replicate Flux Dev · emerald #059669</p>
<div class="grid">"""]
    
    for c in CONCEPTS:
        cid = c["id"]
        img_path = f"{cid}.png"
        prompt_short = textwrap.shorten(c["prompt"], width=120, placeholder="...")
        html_parts.append(f"""
<div class="card">
  <div class="card-img">
    <img src="{img_path}" alt="{cid}" onerror="this.outerHTML='<div style=padding:60px;color:#555;font-size:13px>生成失败</div>'">
  </div>
  <div class="card-body">
    <div class="id">{cid}</div>
    <div class="name">{c['desc']}</div>
    <div class="prompt">{prompt_short}</div>
  </div>
</div>""")
    
    html_parts.append("</div></body></html>")
    html_path = os.path.join(OUT_DIR, "index.html")
    with open(html_path, "w") as f:
        f.write("\n".join(html_parts))
    
    print(f"\nPreview: {html_path}")
