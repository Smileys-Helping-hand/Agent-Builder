"""
Fine-tunes a LoRA adapter on what Agent Builder's agents were rewarded for.

    python finetune.py --data data/rl --out data/rl/adapters/<name> [--base Qwen/Qwen2.5-Coder-7B-Instruct] [--steps 200]
    python finetune.py --check     # proves the stack trains: a few steps on a tiny model

Data (written by Reinforcement.exportDataset):
    sft.jsonl  {"messages": [{"role": "user", ...}, {"role": "assistant", ...}], "reward": …}   the best-rewarded answers
    dpo.jsonl  {"prompt": …, "chosen": …, "rejected": …}                                        preferred over rejected

Supervised fine-tuning (SFT) on the best answers first; then preference training (DPO) when there are
enough pairs. QLoRA (4-bit base, LoRA r=16) so a 7B model fits an 8 GB card. The adapter and a
report.json land in --out; Agent Builder turns that into an Ollama model when Ollama can load it.

Prints one JSON line per event ({"event": ...}) so the server can follow it.
"""
import argparse
import json
import os
import sys
import time


def say(event, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/rl")
    parser.add_argument("--out", default=None)
    parser.add_argument("--base", default="Qwen/Qwen2.5-Coder-7B-Instruct")
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--min-sft", type=int, default=50)
    parser.add_argument("--min-dpo", type=int, default=30)
    parser.add_argument("--check", action="store_true", help="a few real steps on a tiny model, to prove the stack trains")
    args = parser.parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer

    say("stack", torch=torch.__version__, cuda=torch.cuda.is_available(), gpu=torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)

    sft_rows = read_jsonl(os.path.join(args.data, "sft.jsonl"))
    dpo_rows = read_jsonl(os.path.join(args.data, "dpo.jsonl"))
    if args.check:
        base = "Qwen/Qwen2.5-0.5B-Instruct"
        if not sft_rows:
            sft_rows = [
                {"messages": [{"role": "user", "content": "What does WAL mode do in SQLite?"}, {"role": "assistant", "content": "It lets readers keep reading while one writer commits."}]},
                {"messages": [{"role": "user", "content": "Name a compactified extra dimension theory."}, {"role": "assistant", "content": "Kaluza-Klein theory."}]},
            ]
        steps = 3
    else:
        base = args.base
        steps = args.steps
        if len(sft_rows) < args.min_sft:
            say("not-enough-data", sft=len(sft_rows), needed=args.min_sft)
            return 2

    out = args.out or os.path.join(args.data, "adapters", time.strftime("%Y%m%d-%H%M%S") + ("-check" if args.check else ""))
    os.makedirs(out, exist_ok=True)
    say("loading", base=base, examples=len(sft_rows), pairs=len(dpo_rows))

    quant = {}
    if torch.cuda.is_available() and not args.check:
        from transformers import BitsAndBytesConfig

        quant = {
            "quantization_config": BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True),
            "device_map": "auto",
        }
    tokenizer = AutoTokenizer.from_pretrained(base)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(base, torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32, **quant)
    if not quant and torch.cuda.is_available():
        model = model.to("cuda")
    lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM", target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])

    from trl import SFTConfig, SFTTrainer

    sft = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=Dataset.from_list([{"messages": r["messages"]} for r in sft_rows]),
        peft_config=lora,
        args=SFTConfig(
            output_dir=os.path.join(out, "sft"),
            max_steps=steps,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=1 if args.check else 8,
            learning_rate=2e-4,
            logging_steps=1,
            save_strategy="no",
            report_to=[],
            gradient_checkpointing=not args.check,
            max_length=2048,
            bf16=torch.cuda.is_available(),
        ),
    )
    say("sft-start", steps=steps)
    result = sft.train()
    losses = [log["loss"] for log in sft.state.log_history if "loss" in log]
    say("sft-done", loss_first=losses[0] if losses else None, loss_last=losses[-1] if losses else None, runtime=result.metrics.get("train_runtime"))

    dpo_done = False
    if not args.check and len(dpo_rows) >= args.min_dpo:
        from trl import DPOConfig, DPOTrainer

        dpo = DPOTrainer(
            model=sft.model,
            processing_class=tokenizer,
            train_dataset=Dataset.from_list([{"prompt": r["prompt"], "chosen": r["chosen"], "rejected": r["rejected"]} for r in dpo_rows]),
            args=DPOConfig(output_dir=os.path.join(out, "dpo"), max_steps=max(50, steps // 2), per_device_train_batch_size=1, gradient_accumulation_steps=8, learning_rate=5e-6, beta=0.1, logging_steps=5, save_strategy="no", report_to=[], bf16=torch.cuda.is_available()),
        )
        say("dpo-start", pairs=len(dpo_rows))
        dpo.train()
        dpo.model.save_pretrained(os.path.join(out, "adapter"))
        dpo_done = True
    else:
        sft.model.save_pretrained(os.path.join(out, "adapter"))
    tokenizer.save_pretrained(os.path.join(out, "adapter"))

    report = {"base": base, "check": args.check, "sft_examples": len(sft_rows), "dpo_pairs": len(dpo_rows), "dpo": dpo_done, "steps": steps, "loss_first": losses[0] if losses else None, "loss_last": losses[-1] if losses else None, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    say("done", out=out, **report)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # the server reads this line, not a traceback
        say("error", message=str(error)[:1000])
        raise
