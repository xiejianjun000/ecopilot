#!/usr/bin/env python3
"""
EcoPilot Logo Generator v1
用 SDXL 生成品牌 Logo 概念图。
Intel i9 / 32GB / MPS 后端
"""
import torch, os, json, datetime, textwrap
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler
from PIL import Image
import numpy as np

OUT_DIR = os.path.expanduser("~/Desktop/ecopilot/logo-gen-outputs")
os.makedirs(OUT_DIR, exist_ok=True)

# ── 模型加载 ──
MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0"
print(f"Loading {MODEL_ID} ...")
pipe = StableDiffusionXLPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.float32,
    use_safetensors=True,
    variant="fp16",
    add_watermarker=False,
)
pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
pipe = pipe.to("mps")
pipe.enable_attention_slicing()
print("Model loaded on MPS")

# ── 提示词模板 ──
BRAND = "EcoPilot"
COLOR_HEX = "#059669"

NEGATIVE = (
    "text, watermark, signature, bad anatomy, ugly, blurry, low quality, "
    "low resolution, distorted, deformed, messy, crowded, cluttered, "
    "leaf, tree, globe, earth, generic nature icon, stock icon style, "
    "flat vector, cartoon, clipart, 3D render, photorealistic, "
    "neon, gradient background, noisy background"
)

CONCEPTS = [
    # 概念1：EC 连笔字母变形
    {
        "id": "01-ec-ligature",
        "prompt": (
            "Minimalist brand logo design for 'EcoPilot', an environmental compliance software company. "
            "A clean abstract monogram combining letters E and C into one flowing continuous line. "
            "Smooth modern curves, professional corporate identity, elegant single-line construction. "
            f"Color: rich emerald green #{COLOR_HEX[1:]}, no background, "
            "white or transparent surrounding space. "
            "Vector style, crisp edges, dark background for contrast."
        ),
    },
    # 概念2：ECO 三模块
    {
        "id": "02-eco-modules",
        "prompt": (
            "Modern minimalist brand logo for 'EcoPilot' software. "
            "Three geometric modules arranged to form the letters E, C, O "
            "in a modular grid system. Clean corporate technology aesthetic. "
            "Precise 90-degree corners mixed with subtle rounded edges. "
            "Interlocking shapes suggesting system architecture. "
            f"Monochromatic emerald green #{COLOR_HEX[1:]}, "
            "dark background, professional logo design style."
        ),
    },
    # 概念3：锐角切割字母
    {
        "id": "03-angular-cut",
        "prompt": (
            "Bold brand logo for 'EcoPilot'. "
            "Letter E dramatically cut by a sharp diagonal line. "
            "Angular geometric aesthetic, precision engineering feel. "
            "The cut creates negative space that hints at letter C. "
            "Dark background, single emerald green color. "
            "Corporate identity, tech-forward, confident, clean edges."
        ),
    },
    # 概念4：流动线条
    {
        "id": "04-flowing-line",
        "prompt": (
            "Elegant brand logo for 'EcoPilot' software. "
            "A single continuous flowing line that traces letters E, C, O "
            "in one smooth motion. Calligraphic yet geometric. "
            "Fluid curves suggesting environmental monitoring and data flow. "
            "Professional corporate identity. "
            f"Single emerald green line on dark background, minimalist."
        ),
    },
    # 概念5：负空间字母
    {
        "id": "05-negative-space",
        "prompt": (
            "Clever brand logo for 'EcoPilot'. "
            "Negative space design: a solid emerald green geometric shape "
            "with letter E carved out as negative space. "
            "The carved shape also suggests environmental protection. "
            "Modern, sophisticated, minimal. "
            "Dark background, premium brand identity style."
        ),
    },
    # 概念6：折叠/折纸
    {
        "id": "06-folded-origami",
        "prompt": (
            "Modern brand logo for 'EcoPilot' software company. "
            "Origami-inspired folded letter E, creating 3D depth through "
            "angular fold lines on a flat 2D surface. Isometric perspective. "
            "Clean geometric folds suggesting precision and innovation. "
            f"Single emerald green color, dark background, professional logo."
        ),
    },
    # 概念7：科技网格交织
    {
        "id": "07-grid-intertwine",
        "prompt": (
            "Technology brand logo for 'EcoPilot'. "
            "Letters E and C formed by intersecting grid lines, "
            "creating a data network visualization aesthetic. "
            "The intersection points suggest monitoring nodes. "
            f"Clean emerald green grid on dark background, "
            "tech-forward professional logo, minimalist."
        ),
    },
    # 概念8：环形包裹
    {
        "id": "08-ring-wrap",
        "prompt": (
            "Brand logo for 'EcoPilot'. "
            "Letter E partially wrapped by a circular arc (letter O). "
            "The arc opens on one side suggesting forward motion. "
            "Modern elegant corporate identity. "
            f"Single emerald green, dark background, "
            "clean lines, professional logo design."
        ),
    },
    # 概念9：堆叠对比
    {
        "id": "09-stacked-contrast",
        "prompt": (
            "Bold brand logo for 'EcoPilot' software. "
            "Three horizontal bars of decreasing length stacked vertically, "
            "connected by a vertical bar on the left (abstract letter E). "
            "A curved C shape wraps around the right side. "
            "Modern minimalist corporate logo. "
            f"Single emerald green #{COLOR_HEX[1:]}, dark background."
        ),
    },
    # 概念10：编织/交缠
    {
        "id": "10-braid-weave",
        "prompt": (
            "Premium brand logo for 'EcoPilot'. "
            "Two interlocking ribbons forming letters E and C in a braided pattern. "
            "The weave suggests integration and interconnection. "
            "Elegant fluid lines, modern corporate identity. "
            f"Monochromatic emerald green, dark background, "
            "sophisticated minimalist logo design."
        ),
    },
]

def generate_logo(concept):
    cid = concept["id"]
    prompt = concept["prompt"]
    
    # 调整为更短的宽高比适合 Logo
    width, height = 640, 640
    
    prompt_full = prompt
    
    print(f"\n── {cid} ──")
    print(f"Generating...")
    
    with torch.no_grad():
        image = pipe(
            prompt=prompt_full,
            negative_prompt=NEGATIVE,
            width=width,
            height=height,
            num_inference_steps=30,
            guidance_scale=7.5,
        ).images[0]
    
    fname = f"{cid}.png"
    fpath = os.path.join(OUT_DIR, fname)
    image.save(fpath)
    print(f"  Saved: {fpath} ({image.size})")
    
    # 也保存一个小图做缩略图
    thumb = image.copy()
    thumb.thumbnail((300, 300))
    thumb_fname = f"{cid}_thumb.png"
    thumb_fpath = os.path.join(OUT_DIR, thumb_fname)
    thumb.save(thumb_fpath)
    
    return fpath

if __name__ == "__main__":
    print(f"EcoPilot Logo Generator")
    print(f"Output: {OUT_DIR}")
    print(f"Device: MPS (Intel i9 + 32GB)")
    print(f"Concepts: {len(CONCEPTS)}")
    print("=" * 50)
    
    results = []
    for c in CONCEPTS:
        path = generate_logo(c)
        results.append({"id": c["id"], "path": path})
    
    # 生成预览 HTML
    html_parts = ["""<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EcoPilot Logo Gen Outputs</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#1a1b1e;color:#d2d3e0;padding:40px}
h1{font-size:24px;font-weight:600;margin-bottom:8px;letter-spacing:-0.3px}
.sub{font-size:13px;color:#858699;margin-bottom:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.card{background:#212234;border-radius:14px;border:1px solid #2a2c31;overflow:hidden}
.card-img{display:flex;align-items:center;justify-content:center;padding:20px;background:#111;min-height:280px}
.card-img img{max-width:100%;max-height:260px;object-fit:contain;border-radius:8px}
.card-body{padding:16px 20px 20px;border-top:1px solid #2a2c31}
.card-body .id{font-size:10px;color:#059669;font-weight:600;letter-spacing:0.4px}
.card-body .prompt{font-size:11px;color:#858699;line-height:1.5;margin-top:6px}
</style></head><body>
<h1>EcoPilot · SDXL 生成 Logo</h1>
<p class="sub">10 个概念方向 · MPS (Intel i9) · emerald #059669</p>
<div class="grid">"""]
    
    for c in CONCEPTS:
        cid = c["id"]
        prompt_short = textwrap.shorten(c["prompt"], width=150, placeholder="...")
        html_parts.append(f"""
<div class="card">
  <div class="card-img">
    <img src="{cid}.png" alt="{cid}">
  </div>
  <div class="card-body">
    <div class="id">{cid}</div>
    <div class="prompt">{prompt_short}</div>
  </div>
</div>""")
    
    html_parts.append("</div></body></html>")
    
    html_path = os.path.join(OUT_DIR, "index.html")
    with open(html_path, "w") as f:
        f.write("\n".join(html_parts))
    
    print(f"\nPreview: {html_path}")
    print("Done!")
