#!/usr/bin/env python3
"""生成 20 个 EcoPilot Logo 概念"""
import sys, json, time, os, base64
from urllib import request
from urllib.error import HTTPError

with open("/tmp/replicate_token.txt") as f:
    TOKEN = f.read().strip()

OUT = os.path.expanduser("~/Desktop/ecopilot/logo-replicate-20")
os.makedirs(OUT, exist_ok=True)

CONCEPTS = [
    ("01-ec-ligature", "EC 连笔字母",
     "Minimalist professional brand logo. Abstract monogram merging E and C into one flowing continuous line. Smooth curves. Emerald green on white. Vector, no text."),
    ("02-eco-triangle", "ECO 三角顶点",
     "Minimalist brand logo. Letters E, C, O at three vertices of a triangle connected by thin lines. Emerald green on white. Vector style."),
    ("03-angular-cut", "锐角切割 E",
     "Bold brand logo. Letter E dramatically cut by sharp diagonal line creating negative space C. Angular geometric. Emerald green on white. Vector."),
    ("04-eco-stacked", "ECO 竖排叠放",
     "Minimalist brand logo. Letters E, C, O stacked vertically, decreasing in size. Tiered hierarchy. Emerald green on white. Vector."),
    ("05-flowing-line", "流动线条 ECO",
     "Elegant brand logo. Single continuous flowing line tracing E, C, O in one smooth motion. Fluid calligraphic. Emerald green on white. Vector."),
    ("06-ring-wrap", "环形包裹 E",
     "Brand logo. Letter E partially wrapped by a circular arc O. Arc opens on one side. Modern elegant. Emerald green on white. Vector."),
    ("07-negative-space", "负空间 E",
     "Clever brand logo. Solid emerald green shape with letter E carved as negative space. Minimal sophisticated. Emerald green on white. Vector."),
    ("08-folded-e", "折叠折纸 E",
     "Modern brand logo. Origami folded letter E creating 3D depth through angular fold lines. Precision feel. Emerald green on white. Vector."),
    ("09-grid-eco", "网格 ECO",
     "Technology brand logo. Letters E, C, O formed by intersecting grid lines. Data network aesthetic. Emerald green on white. Vector."),
    ("10-e-arrow", "E 箭头",
     "Brand logo. Letter E transformed into forward-pointing arrow. Motion and direction. Emerald green on white. Vector."),
    ("11-e-ribbon", "E 飘带",
     "Elegant brand logo. Letter E as a flowing ribbon with curved tails. Graceful motion. Emerald green on white. Vector."),
    ("12-eco-overlap", "ECO 重叠",
     "Modern brand logo. Letters E, C, O overlapping with semi-transparency. Depth and interconnection. Emerald green on white. Vector."),
    ("13-eco-rings", "ECO 三环",
     "Minimalist brand logo. Three interlocking rings E, C, O. Connected system feel. Emerald green on white. Vector."),
    ("14-e-x-cut", "E X 切割",
     "Bold brand logo. Letter E split into two halves by diagonal X-like cut. Tension and balance. Emerald green on white. Vector."),
    ("15-e-dot", "E 点线",
     "Minimalist brand logo. Letter E built from connected dots and thin lines. Tech data feel. Emerald green on white. Vector."),
    ("16-eco-circle", "ECO 圆内分布",
     "Brand logo. Letters E, C, O distributed inside a circular boundary. Contained system. Emerald green on white. Vector."),
    ("17-e-ladder", "E 阶梯",
     "Brand logo. Letter E as stacked horizontal bars forming a ladder-like structure. Progressive. Emerald green on white. Vector."),
    ("18-e-brush", "E 笔触",
     "Artistic brand logo. Letter E drawn with a single bold brushstroke. Handcrafted feel. Emerald green on white. Vector."),
    ("19-eco-diamond", "ECO 菱形排列",
     "Brand logo. Letters E, C, O arranged in diamond formation. Precious and precise. Emerald green on white. Vector."),
    ("20-e-slash", "E 斜切",
     "Modern brand logo. Letter E constructed from bold diagonal slashes. Dynamic energy. Emerald green on white. Vector."),
]

def gen_one(cid, desc, prompt, retries=3):
    data = json.dumps({
        "version": "black-forest-labs/flux-dev",
        "input": {
            "prompt": prompt,
            "num_inference_steps": 28,
            "width": 1024, "height": 1024,
            "num_outputs": 1,
        }
    }).encode()
    
    for attempt in range(retries):
        try:
            req = request.Request(
                "https://api.replicate.com/v1/predictions", data=data,
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
                method="POST")
            with request.urlopen(req, timeout=60) as resp:
                r = json.loads(resp.read())
            
            get_url = r["urls"]["get"]
            for _ in range(15):
                time.sleep(2.5)
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
            time.sleep(5)
        except HTTPError as e:
            if e.code == 429:
                print(f"  ⏳ {cid} rate limit, waiting 20s...")
                time.sleep(20)
                continue
            if e.code == 500:
                print(f"  ⏳ {cid} model error, retrying...")
                time.sleep(10)
                continue
            print(f"  ✗ {cid}: HTTP {e.code}")
            time.sleep(5)
        except Exception as e:
            print(f"  ⚠ {cid}: {str(e)[:50]}")
            time.sleep(5)
    return False

if __name__ == "__main__":
    print(f"20 Flux Logo concepts\n" + "="*40)
    
    for cid, desc, prompt in CONCEPTS:
        print(f"[{cid}] {desc}")
        gen_one(cid, desc, prompt)
    
    # HTML
    cards = "\n".join([
        f"""
<div class="card">
  <div class="card-img"><img src="{cid}.png" alt="{cid}"></div>
  <div class="card-body">
    <div class="id">{cid}</div>
    <div class="name">{desc}</div>
  </div>
</div>""" for cid, desc, _ in CONCEPTS
    ])
    
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EcoPilot 20 Logos</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:Inter,system-ui,sans-serif;background:#0d0d0d;color:#eee;padding:32px}}
h1{{font-size:22px;font-weight:600;margin-bottom:4px}}
.sub{{font-size:12px;color:#666;margin-bottom:28px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}}
.card{{background:#161616;border-radius:12px;border:1px solid #2a2a2a;overflow:hidden}}
.card-img{{display:flex;align-items:center;justify-content:center;padding:20px;background:#0a0a0a;min-height:240px}}
.card-img img{{max-width:100%;max-height:220px;object-fit:contain;border-radius:6px}}
.card-body{{padding:12px 16px 16px;border-top:1px solid #2a2a2a}}
.card-body .id{{font-size:10px;color:#059669;font-weight:600}}
.card-body .name{{font-size:13px;font-weight:600;margin:2px 0}}
</style></head><body>
<h1>EcoPilot · 20 Logo Concepts</h1>
<p class="sub">Flux Dev · emerald green #059669</p>
<div class="grid">{cards}</div></body></html>"""
    
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(html)
    print(f"\n→ {OUT}/index.html")
