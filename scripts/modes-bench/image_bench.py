"""SDXS (Sham v2's image model) on a CPU runner: time and look at 1 / 2 / 4 steps and 512 / 640 / 768 px. Weights are fetched once for this measurement only (the product itself ships them inside the Studio).
Usage: python image_bench.py <out dir>"""
import os, sys, time, json
import torch
from diffusers import AutoPipelineForText2Image
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
from huggingface_hub import snapshot_download
p = snapshot_download("IDKiro/sdxs-512-dreamshaper")
torch.set_num_threads(2)           # the Studio has 2 vCPU: same thread count, so the RATIOS carry over
pipe = AutoPipelineForText2Image.from_pretrained(p, torch_dtype=torch.bfloat16, safety_checker=None)
pipe.set_progress_bar_config(disable=True)
prompts = {"horse": "a white horse standing in a green field, photo", "lion": "a lion resting on a rock at sunset, detailed fur"}
rows = []
pipe("warm", num_inference_steps=1, guidance_scale=0.0, height=256, width=256)
for name, pr in prompts.items():
    for size in (512, 640, 768):
        for steps in (1, 2, 4):
            g = torch.Generator().manual_seed(0)
            t0 = time.time()
            img = pipe(pr, num_inference_steps=steps, guidance_scale=0.0, height=size, width=size, generator=g).images[0]
            dt = round(time.time() - t0, 1)
            img.save(f"{out}/{name}_{size}_s{steps}.png")
            rows.append(dict(prompt=name, size=size, steps=steps, seconds=dt)); print(rows[-1], flush=True)
json.dump(rows, open(f"{out}/times.json", "w"))
