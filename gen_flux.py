#!/usr/bin/env python3
"""Flux Logo generator - 读 token 文件"""
import sys, json, time, os, textwrap
from urllib import request
from urllib.error import HTTPError

with open("/tmp/replicate_token.txt") as f:
    TOKEN = f.read().strip()

OUT = os.path.expanduser("~/Desktop/ecopilot/logo-replicate")
os.makedirs(OUT, exist_ok=True)

CONCEPTS = [
    ("ec-monogram", "EC 连笔字母",
     "Minimalist professional brand logo for EcoPilot. Abstract monogram merging letters E and C into one flowing continuous line. Smooth modern curves, elegant identity. Emerald green on pure white. Vector style, crisp edges, no text."),
    ("eco-stacked", "ECO 三模块",
     "Minimalist brand logo. Three geometric modules forming letters E, C, O in vertical stack. Clean corporate aesthetic, precise shapes. Single emerald green, pure white background. Vector style, no text."),
    ("angular-e", "锐角切割 E",
     "Bold minimalist brand logo. Letter E cut by sharp diagonal into angular geometric shape. Cut creates negative space suggesting letter C. Emerald green on white. Vector style, no text."),
    ("flowing-eco", "流动线条 ECO",
     "Elegant minimalist brand logo. Single continuous flowing line tracing E, C, O in one motion. Calligraphic yet geometric. Emerald green on pure white. Vector style, no text."),
    ("negative-e", "负空间 E",
     "Clever minimalist brand logo. Solid emerald green geometric shape with letter E as negative space carved out. Modern sophisticated minimal design. White background. Vector."),
    ("eco-rings", "ECO 三环",
     "Minimalist brand logo. Three interlocking rings forming letters E, C, O. Clean geometric corporate identity. Emerald green on pure white. Vector style, no text."),
    ("e-arrow", "E 箭头",
     "Minimalist brand logo. Letter E transformed into a forward-pointing arrow shape. Direction and motion feel. Emerald green on white. Vector style, no text."),
    ("eco-triangle", "ECO 三角",
     "Minimalist brand logo. Triangular arrangement of letters E, C, O at three vertices. Clean geometric connected by subtle lines. Emerald green on white. Vector style."),
]

def gen(cid, desc, prompt):
    data = json.dumps({
        "version": "black-forest-labs/flux-dev",
        "input": {
            "prompt": prompt,
            "num_inference_steps": 28,
            "width": 1024, "height": 1024,
            "num_outputs": 1,
        }
    }).encode()
    
    for attempt in range(2):
        try:
            req = request.Request(
                "https://api.replicate.com/v1/predictions", data=data,
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
                method="POST")
            with request.urlopen(req, timeout=60) as resp:
                r = json.loads(resp.read())
            
            get_url = r["urls"]["get"]
            for _ in range(20):
                time.sleep(3)
                req2 = request.Request(get_url, headers={"Authorization": f"Bearer {TOKEN}"})
                with request.urlopen(req2, timeout=20) as resp2:
                    s = json.loads(resp2.read())
                if s["status"] in ("succeeded", "failed", "canceled"):
                    break
            
            if s["status"] == "succeeded":
                imgs = s.get("output", [])
                if isinstance(imgs, list) and len(imgs) > 0:
                    path = os.path.join(OUT, f"{cid}.png")
                    request.urlretrieve(imgs[0], path)
                    print(f"  ✓ {cid} - {desc}")
                    return True
            print(f"  ✗ {cid}: {s.get('status')}")
        except Exception as e:
            print(f"  ⚠ {cid} attempt {attempt+1}: {str(e)[:60]}")
            time.sleep(5)
    return False

if __name__ == "__main__":
    print(f"Flux x {len(CONCEPTS)} concepts\n" + "="*40)
    for cid, desc, prompt in CONCEPTS:
        print(f"[{cid}] {desc}")
        gen(cid, desc, prompt)
    
    # HTML preview
    cards = []
    for cid, desc, _ in CONCEPTS:
        cards.append(f"""
<div class="card">
  <div class="card-img"><img src="{cid}.png" alt="{cid}"></div>
  <div class="card-body">
    <div class="id">{cid}</div>
    <div class="name">{desc}</div>
  </div>
</div>""")
    
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EcoPilot Flux</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:Inter,system-ui,sans-serif;background:#111;color:#eee;padding:40px}}
h1{{font-size:24px;font-weight:600;margin-bottom:4px}}
.sub{{font-size:13px;color:#888;margin-bottom:32px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}}
.card{{background:#1a1a1a;border-radius:14px;border:1px solid #333;overflow:hidden}}
.card-img{{display:flex;align-items:center;justify-content:center;padding:24px;background:#0a0a0a;min-height:280px}}
.card-img img{{max-width:100%;max-height:260px;object-fit:contain;border-radius:8px}}
.card-body{{padding:14px 18px 18px;border-top:1px solid #333}}
.card-body .id{{font-size:10px;color:#059669;font-weight:600}}
.card-body .name{{font-size:14px;font-weight:600;margin:2px 0}}
</style></head><body>
<h1>EcoPilot · Flux Logo</h1>
<p class="sub">8 concepts · Flux Dev · emerald green</p>
<div class="grid">{"".join(cards)}</div></body></html>"""
    
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(html)
    print(f"\n→ {OUT}/index.html")
