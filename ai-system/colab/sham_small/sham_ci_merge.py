"""
The GitHub-hosted merge + repair + evaluation job ("الدمج والتقييم على CPU").

Merging checkpoints is CPU work: until now it ran inside the chat-stage notebook and spent hours of the weekly
Kaggle GPU quota on it. This job does the same thing — the same repair stage, the same guarded merge, the same gate —
on the free GitHub Actions runner, and publishes the result to its OWN dataset `sham-merged-checkpoint`. It never
overwrites another lineage: the chat stage (and anything else) finds it by the `sham*` discovery rule and merges it
as one more source, through its own gate.

    1. base      the chat stage's checkpoint (else the multimodal stage's); our own merged lineage continues
                 only while no newer base appeared
    2. sources   every model dataset of the account (KNOWN_SOURCES + sham-crawl-* + any other sham* dataset),
                 each repaired (sham_repair) and merged only if it improves EVERY skill on the held-out gate
    3. gate      text (the general mixture), chat (held-out dialogues) and image/audio (fixed pairs), all held out
    4. report    before/after on the same held-out sets → Telegram (if the bot secrets exist)

    python sham_ci_merge.py
"""

from __future__ import annotations

import copy
import json
import os
import shutil
import time
from pathlib import Path

import torch

OWN = "sham-merged-checkpoint"
WORK = Path(os.environ.get("SHAM_WORK", "/tmp/sham_ci_merge"))
MAX_SOURCES_PER_RUN = 12


def _step_of(path: Path) -> int:
    return int(torch.load(path, map_location="cpu", weights_only=False, mmap=True).get("step") or 0)


def pick_base(fetch, own_name: str = OWN):
    """(checkpoint, folder, label, progress). Our merged lineage continues only while the main line has not moved on."""
    main = None
    for name, pattern in (("sham-chat-checkpoint", "final_chat.pt"), ("sham-multimodal-checkpoint", "final_multimodal.pt")):
        root = fetch(name)
        hits = sorted(root.rglob(pattern)) if root else []
        if hits:
            main = (hits[0], hits[0].parent, name)
            break
    own = fetch(own_name)
    own_ckpt = sorted(own.rglob("final_merged.pt")) if own else []
    progress = {}
    if own:
        for p in own.rglob("merge_progress.json"):
            try:
                progress = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
    if main is None:
        raise FileNotFoundError("لا توجد نقطة حفظ للمحادثة ولا للمرحلة الثانية.")
    main_step = _step_of(main[0])
    if own_ckpt and progress.get("base") == main[2] and int(progress.get("base_step", -1)) >= main_step:
        return own_ckpt[0], own_ckpt[0].parent, f"{own_name} (يكمل من ناتجه السابق)", progress
    return main[0], main[1], main[2], {"base": main[2], "base_step": main_step, "merged": {}}


def default_gate(model, tokenizer, base_dir: Path, device: str, build_media: bool = True):
    """Held-out batches per skill (text / chat / media). Never trained on by this job."""
    from sham_chat import batch_examples, build_chat_example, load_arabic_dialogues, split_holdout
    import sham_text_mix

    gate: dict = {}
    max_len = min(1024, model.cfg.max_seq_len)
    # text: a fixed-seed sample of the general mixture
    files = sham_text_mix.stream_mix(str(WORK / "gate_text"), max_documents=140, seed=4242, documents_per_file=70)
    text = "\n".join(Path(f).read_text(encoding="utf-8") for f in files if f.endswith(".txt"))
    ids = tokenizer.encode(text)
    L = min(512, max_len)
    wins = [ids[i:i + L] for i in range(0, len(ids) - L + 1, L)][:24]
    gate["text"] = [torch.tensor(wins[i:i + 4]) for i in range(0, len(wins) - 3, 4)][:6]
    # chat: held-out dialogues
    try:
        dialogues, _ = load_arabic_dialogues({}, 800)
        _, hold = split_holdout(dialogues, seed=7)
        ex = [build_chat_example(tokenizer.encode(q), tokenizer.encode(a), max_len=max_len) for q, a in hold]
        gate["chat"] = batch_examples(ex, 8)[:8]
    except Exception as exc:
        print(f"⚠ تعذّر ميزان المحادثة: {exc}")
    # media: the fixed image/audio pairs
    if build_media:
        try:
            from sham_data_sources import Ledger
            from sham_media_link import _examples, _pairs, collect_fixed_pairs
            from tokenizer_select import select_pretrained_tokenizer
            img = select_pretrained_tokenizer("image", base_dir)
            aud = select_pretrained_tokenizer("audio", base_dir)
            if img and aud:
                (itok, _s1, _), (atok, _s2, _) = img, aud
                itok, atok = itok.to("cpu").eval(), atok.to("cpu").eval()
                ledgers = {k: Ledger.load(k, name=f"ci_{k}") for k in ("image", "audio")}
                fixed = collect_fixed_pairs(("image", "audio"), ledgers, workdir=str(WORK / "fixed_pairs"),
                                            image_size=itok.cfg.image_size)
                media = []
                for kind, manifest in fixed.items():
                    pairs = _pairs(kind, manifest, tokenizer, itok if kind == "image" else atok)
                    gen, und = _examples(kind, pairs, True, tokenizer)   # returns (generation, understanding) lists, not one list
                    media += gen + und
                if media:
                    gate["media"] = batch_examples(media, 4)[:6]
        except Exception as exc:
            print(f"⚠ تعذّر ميزان الوسائط: {exc}")
    return {k: v for k, v in gate.items() if v}


def run(fetch=None, publish=None, gate_builder=default_gate, sources=None, device: str = "cpu", publish_on_change: bool = True,
        max_sources: int = MAX_SOURCES_PER_RUN, auto_hook=None) -> dict:
    from checkpoint import load_checkpoint, save_checkpoint
    from sham_inputs import fetch_dataset, publish_dataset
    import sham_merge
    from sham_merge import KNOWN_SOURCES, batches_loss, guarded_merge, load_source
    from text_tokenizer import ShamTextTokenizer

    fetch, publish = fetch or fetch_dataset, publish or publish_dataset
    t0 = time.time()
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    ckpt, base_dir, label, progress = pick_base(fetch)
    model, step, _ = load_checkpoint(ckpt, map_location=device)
    tokenizer = ShamTextTokenizer.load(str(sorted(base_dir.rglob("sham_small_tokenizer.json"))[0]))
    print(f"نقطة الانطلاق: {label} — الخطوة {step:,}")
    # the repair stage compares foreign image/audio rows with the base's own tokenizers kept in /kaggle/working
    ref = Path("/kaggle/working")
    if ref.exists() and os.access(ref, os.W_OK):
        for f in ("sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt"):
            for src in base_dir.rglob(f):
                shutil.copy2(src, ref / f)
                break
    gate = gate_builder(model, tokenizer, base_dir, device)
    assert gate, "لا ميزان (لا نص ولا محادثة ولا وسائط) — لا دمج بلا ميزان"
    print("الميزان: " + ", ".join(f"{k}={len(v)} دفعة" for k, v in gate.items()))
    score = lambda m: {k: batches_loss(m, v, device) for k, v in gate.items()}
    before = score(model)

    merged = progress.setdefault("merged", {})
    candidates, report = [], []
    for name, pattern, rows in (sources if sources is not None else list(KNOWN_SOURCES)):
        if name in (label.split(" ")[0], "sham-chat-checkpoint", OWN):
            continue
        if len(candidates) >= max_sources:
            report.append(f"⏭ {name}: يؤجَّل للتشغيل القادم (الحد {max_sources} مصدراً في التشغيل)")
            continue
        root = fetch(name)
        if not root:
            continue
        loaded, why = load_source(root, pattern, model, tokenizer)
        if loaded is None:
            report.append(f"⏭ {name}: {why}")
            shutil.rmtree(root, ignore_errors=True)   # the runner's disk is small: keep only what is merged now
            continue
        other, other_step = loaded
        if merged.get(name, -1) >= other_step:
            report.append(f"⏭ {name}: الخطوة {other_step:,} جُرّبت سابقاً")
            shutil.rmtree(root, ignore_errors=True)
            continue
        candidates.append((f"{name} (خطوة {other_step:,})", other.to(device), rows))
        merged[name] = other_step
        shutil.rmtree(root, ignore_errors=True)
    changed = False
    if candidates:
        lines = guarded_merge(model, candidates, score)
        report += lines
        changed = any(l.startswith("✅") for l in lines)
    after = score(model)
    progress.update(base=progress.get("base", label), base_step=progress.get("base_step", step), merged=merged,
                    updated=time.time(), gate_before=before, gate_after=after)

    # settings Sham decides by itself from what it measures (sham_auto_config): the hook runs its experiment on the merged model and
    # returns the new settings; they travel inside merge_progress.json, which every notebook can read when it starts
    auto_changed = False
    if auto_hook is not None:
        try:
            new_auto, auto_line, candidate = auto_hook(model, tokenizer, progress.get("auto", {}))
            auto_changed = new_auto != progress.get("auto", {})
            progress["auto"] = new_auto
            report.append(auto_line)
            if candidate is not None:       # the copy trained on worked solutions + replay: adopted only if NO skill got worse
                after_c = score(candidate)
                worse = {k: (after[k], after_c[k]) for k in after if after_c.get(k, 1e9) > after[k] * 1.01}
                if not worse:
                    model, after, changed = candidate.to(device), after_c, True
                    progress["gate_after"] = after
                    report.append("✅ تُبنّيت نسخة التفكير المتسلسل: الميزان بعد = " + ", ".join(f"{k}={v:.3f}" for k, v in after.items()))
                else:
                    report.append("❌ نسخة التفكير المتسلسل رُفضت (ساءت مهارة على الميزان): "
                                  + ", ".join(f"{k} {a:.3f}→{b:.3f}" for k, (a, b) in worse.items()))
            del candidate
        except Exception as exc:
            report.append(f"⚠ تعذّر قرار الإعدادات الذاتية: {type(exc).__name__}: {str(exc)[:100]}")

    published = None
    if publish_on_change and (changed or auto_changed or not fetch(OWN)):
        up = WORK / "upload"
        up.mkdir()
        save_checkpoint(up / "final_merged.pt", model, step)
        tokenizer.save(str(up / "sham_small_tokenizer.json"))
        for f in ("image_tokenizer.pt", "audio_tokenizer.pt"):
            for src in base_dir.rglob(f):
                shutil.copy2(src, up / f)
                break
        (up / "merge_progress.json").write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")
        published = publish(up, OWN, f"merged on CPU (GitHub) from {label} at step {step:,}")
    elif not changed:
        report.append("لا دمج جديد — لا نسخة جديدة تُنشر")
        # the record of tried sources still has to survive: publish only the progress when something new was tried
    text = ("🧩 الدمج والتقييم على CPU (GitHub)\n" + f"الأساس: {label} (خطوة {step:,})\n"
            + "قبل: " + ", ".join(f"{k}={v:.3f}" for k, v in before.items())
            + "\nبعد: " + ", ".join(f"{k}={v:.3f}" for k, v in after.items()) + "\n" + "\n".join(report)
            + (f"\nنُشر إلى {published}" if published else "") + f"\n({(time.time() - t0) / 60:.0f} دقيقة)")
    print(text)
    return {"before": before, "after": after, "changed": changed, "published": published, "report": text,
            "model": model, "tokenizer": tokenizer}


def probe_hook(model, tokenizer, previous: dict):
    """Experiment on a COPY (publishes nothing) → the reasoning share Sham decides to train with from now on."""
    import sham_auto_config
    import sham_reasoning_probe
    pr = sham_reasoning_probe.probe(model, tokenizer, "cpu")
    new = sham_auto_config.decide_reasoning(pr, previous)
    candidate = pr.pop("trial", None) if (pr.get("ok") and new.get("reasoning_share", 0) > 0) else None
    if pr.get("ok"):
        line = (f"🔬 مسبار التفكير المتسلسل ({pr['steps']} خطوة، {pr['minutes']} د): خسارة الحلول {pr['before']['reason_loss']:.2f}→"
                f"{pr['after']['reason_loss']:.2f} | نص {pr['before']['text_loss']:.2f}→{pr['after']['text_loss']:.2f} | إصابة "
                f"{pr['before']['exact']:.0%}→{pr['after']['exact']:.0%} ⇒ قرار تلقائي: حصة التفكير المتسلسل {new.get('reasoning_share', 0):.0%}")
    else:
        line = f"🔬 مسبار التفكير المتسلسل لم يكتمل ({pr.get('error', '؟')}) — القرار السابق باقٍ: {previous.get('reasoning_share', 0):.0%}"
    return new, line, candidate


def main():
    res = run(auto_hook=probe_hook)
    try:   # real-source soak of the endless text pipeline on this (small, 7 GB) runner: evidence before CPU sessions may use it
        import sham_pipeline_soak
        res["soak"] = sham_pipeline_soak.soak(float(os.environ.get("SHAM_SOAK_SECONDS", "420")))
    except Exception as exc:
        print(f"soak: {exc}")
    try:
        from telegram_report import send_telegram_message
        send_telegram_message(os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID"), res["report"][:4000])
    except Exception as exc:
        print(f"telegram: {exc}")


if __name__ == "__main__":
    import sys

    # no Kaggle credentials (the PR checker runs every changed module with a scrubbed environment) = nothing real to merge: self-test
    if (len(sys.argv) > 1 and sys.argv[1] == "--selftest") or not (os.environ.get("KAGGLE_USERNAME") or os.environ.get("KAGGLE_API_TOKEN")):
        import tempfile

        from checkpoint import save_checkpoint
        from model import ShamSmall, ShamSmallConfig
        from text_tokenizer import ShamTextTokenizer

        torch.manual_seed(0)
        cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=64)
        tok_path = Path(__file__).with_name("sham_general_tokenizer.json")
        td = Path(tempfile.mkdtemp())
        WORK = td / "work"
        main_m, good = ShamSmall(cfg), ShamSmall(cfg)
        target = {n: p.detach().clone() for n, p in good.named_parameters()}
        # "main" is a noisy version of the better source, so merging the source in helps on a gate made from it
        with torch.no_grad():
            for n, p in main_m.named_parameters():
                p.copy_(target[n] + 0.5 * torch.randn_like(p))
        d = {}
        for name, m, fname in (("sham-chat-checkpoint", main_m, "final_chat.pt"), ("sham-crawl-good", good, "final.pt")):
            (td / name).mkdir()
            save_checkpoint(td / name / fname, m, 5)
            shutil.copy(tok_path, td / name / "sham_small_tokenizer.json")
            d[name] = td / name
        pubs = []
        fetch = lambda n: d.get(n)
        publish = lambda up, name, msg: (pubs.append((name, sorted(p.name for p in Path(up).iterdir()))), name)[1]

        def gate_builder(model, tokenizer, base_dir, device):
            g = torch.Generator().manual_seed(1)
            with torch.no_grad():
                ids = torch.randint(0, 2000, (4, 32), generator=g)
            return {"text": [ids]}

        # the gate: loss of a model on fixed ids — a model closer to "good" must not be worse; use the good model's own
        # predictions as targets so that merging toward it lowers the loss
        def gate_builder2(model, tokenizer, base_dir, device):
            with torch.no_grad():
                ids = torch.randint(0, 2000, (4, 32))
                logits = good(ids)[0]
                labels = logits.argmax(-1)
            return {"text": [(ids, labels)]}

        res = run(fetch=fetch, publish=publish, gate_builder=gate_builder2,
                  sources=[("sham-crawl-good", "final*.pt", [(0, 42256)])])
        assert res["changed"] and res["after"]["text"] < res["before"]["text"], res
        assert pubs and pubs[0][0] == OWN and "final_merged.pt" in pubs[0][1] and "merge_progress.json" in pubs[0][1], pubs
        # a verdict Sham reached by itself travels in merge_progress.json and is published even when nothing was merged
        pubs.clear()
        up_dir = {}
        publish2 = lambda up, name, msg: (up_dir.update(json=json.loads((Path(up) / "merge_progress.json").read_text(encoding="utf-8"))),
                                          pubs.append(name), name)[1]
        res2 = run(fetch=fetch, publish=publish2, gate_builder=gate_builder2, sources=[],
                   auto_hook=lambda m, t, prev: ({"reasoning_share": 0.1}, "line", None))
        assert not res2["changed"] and pubs == [OWN] and up_dir["json"]["auto"] == {"reasoning_share": 0.1}, (res2, pubs, up_dir)
        assert "line" in res2["report"]
        # the trained copy is ADOPTED only when no skill got worse on the gate; a worse one is refused
        pubs.clear()
        res3 = run(fetch=fetch, publish=publish, gate_builder=gate_builder2, sources=[],
                   auto_hook=lambda m, t, prev: ({"reasoning_share": 0.1}, "line", copy.deepcopy(good)))
        assert res3["changed"] and res3["after"]["text"] < res3["before"]["text"] and "تُبنّيت" in res3["report"], res3
        pubs.clear()
        torch.manual_seed(5)
        ruined = copy.deepcopy(good)
        with torch.no_grad():
            for p_ in ruined.parameters():
                p_.add_(3.0 * torch.randn_like(p_))
        res4 = run(fetch=fetch, publish=publish, gate_builder=gate_builder2, sources=[],
                   auto_hook=lambda m, t, prev: ({"reasoning_share": 0.1}, "line", ruined))
        assert not res4["changed"] and "رُفضت" in res4["report"], res4
        print("sham_ci_merge self-test OK")
    else:
        main()
