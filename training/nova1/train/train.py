"""Nova 1 LoRA training (Unsloth; falls back to plain TRL + PEFT when Unsloth is not installed).

    pip install -r requirements.txt
    python train/train.py --config train/config.yaml --out out/nova1-lora [--resume]

Free, interruptible GPUs (Colab free T4, Lightning free credits): use train/config.colab.yaml with
    python train/train.py --config train/config.colab.yaml --hub-repo <hf-user>/nova1-lora-ckpt --max-minutes 200 --resume
Checkpoints are pushed to that private Hugging Face repo (folder last-checkpoint) while training, the run stops cleanly
before the session limit, and the next session (same command, any machine) downloads last-checkpoint and continues.
Needs HF_TOKEN (a write token of the owner's HF account) in the environment / Colab secrets.

Rows are chat JSONL ({"messages": [...], "tools"?: [...]}) rendered with the Qwen3.5 chat template, so tool calls are trained in
exactly the format the model will see when served. Loss is on assistant turns only.
"""
import argparse
import json
from pathlib import Path

import yaml
from datasets import load_dataset

ap = argparse.ArgumentParser()
ap.add_argument("--config", default="train/config.yaml")
ap.add_argument("--out", default="out/nova1-lora")
ap.add_argument("--resume", action="store_true")
ap.add_argument("--max-steps", type=int, default=-1, help="set to e.g. 30 for a smoke run")
ap.add_argument("--hub-repo", default="", help="private HF model repo that receives checkpoints (resume across sessions)")
ap.add_argument("--max-minutes", type=float, default=0, help="save and stop after this many minutes (0 = no limit)")
a = ap.parse_args()
C = yaml.safe_load(Path(a.config).read_text())

try:
    from unsloth import FastLanguageModel
    model, tok = FastLanguageModel.from_pretrained(
        model_name=C["base_model"], max_seq_length=C["max_seq_length"], load_in_4bit=False, load_in_16bit=True, full_finetuning=False)
    model = FastLanguageModel.get_peft_model(
        model, r=C["lora"]["r"], lora_alpha=C["lora"]["alpha"], lora_dropout=C["lora"]["dropout"], bias="none",
        target_modules=C["lora"]["target_modules"], use_gradient_checkpointing="unsloth", random_state=C["train"]["seed"],
        max_seq_length=C["max_seq_length"])
except ImportError:
    import torch
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(C["base_model"])
    model = AutoModelForCausalLM.from_pretrained(C["base_model"], dtype=torch.bfloat16, device_map="auto")   # text model only
    model.gradient_checkpointing_enable()
    model = get_peft_model(model, LoraConfig(r=C["lora"]["r"], lora_alpha=C["lora"]["alpha"], lora_dropout=C["lora"]["dropout"],
                                             target_modules=C["lora"]["target_modules"], task_type="CAUSAL_LM"))

import time  # noqa: E402

from transformers import TrainerCallback  # noqa: E402
from trl import SFTConfig, SFTTrainer  # noqa: E402

T0 = time.time()


class StopBeforeLimit(TrainerCallback):
    """Ends the run with a saved (and pushed) checkpoint before a free session is cut off."""

    def on_step_end(self, args, state, control, **kw):
        if a.max_minutes and (time.time() - T0) / 60 >= a.max_minutes:
            control.should_save = True
            control.should_training_stop = True
        return control


def hub_resume() -> str | None:
    """Fetches last-checkpoint from the hub repo (if any) so a new session continues where the last one stopped."""
    local = Path(a.out) / "last-checkpoint"
    if a.hub_repo:
        from huggingface_hub import snapshot_download
        try:
            snapshot_download(a.hub_repo, allow_patterns=["last-checkpoint/*"], local_dir=a.out)
        except Exception as e:  # first session: nothing pushed yet
            print("no checkpoint on hub yet:", str(e)[:120])
    if local.exists() and (local / "trainer_state.json").exists():
        return str(local)
    ckpts = sorted(Path(a.out).glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[1]))
    return str(ckpts[-1]) if ckpts else None



def render(row):
    tools = row.get("tools")
    msgs = row["messages"]
    for m in msgs:                       # the template expects arguments as objects
        for c in m.get("tool_calls") or []:
            f = c["function"]
            if isinstance(f.get("arguments"), str):
                try:
                    f["arguments"] = json.loads(f["arguments"])
                except ValueError:
                    pass
    return {"messages": msgs, **({"tools": tools} if tools else {})}


import torch  # noqa: E402

_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()   # T4/P100 have no bf16: train in fp16 there

ds = load_dataset("json", data_files=C["data"]["train"], split="train").map(render)
split = ds.train_test_split(test_size=C["data"]["holdout_share"], seed=C["train"]["seed"])
T = C["train"]
trainer = SFTTrainer(
    model=model,
    processing_class=tok,
    train_dataset=split["train"],
    eval_dataset=split["test"],
    args=SFTConfig(
        output_dir=a.out, max_length=C["max_seq_length"], num_train_epochs=T["epochs"], max_steps=a.max_steps,
        learning_rate=T["lr"], lr_scheduler_type=T["scheduler"], warmup_ratio=T["warmup_ratio"], weight_decay=T["weight_decay"],
        per_device_train_batch_size=T["per_device_batch"], gradient_accumulation_steps=T["grad_accum"], optim=T["optim"],
        packing=T["packing"], assistant_only_loss=T["assistant_only_loss"], seed=T["seed"], logging_steps=10,
        save_steps=T["save_steps"], eval_strategy="steps", eval_steps=T["eval_steps"], save_total_limit=3, report_to="none",
        bf16=_bf16, fp16=not _bf16, dataset_num_proc=2,
        push_to_hub=bool(a.hub_repo), hub_model_id=a.hub_repo or None, hub_strategy="checkpoint", hub_private_repo=True),
    callbacks=[StopBeforeLimit()],
)
start = hub_resume() if a.resume else None
print("resuming from", start) if start else print("starting fresh")
trainer.train(resume_from_checkpoint=start)
if a.max_minutes and (time.time() - T0) / 60 >= a.max_minutes and trainer.state.global_step < trainer.state.max_steps:
    print(f"stopped at step {trainer.state.global_step}/{trainer.state.max_steps}; run the same command again to continue")
    raise SystemExit(0)
model.save_pretrained(a.out)
tok.save_pretrained(a.out)
print("saved LoRA adapter to", a.out)
