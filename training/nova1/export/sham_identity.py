"""Nova AI identity (Nova 1, by the Sham team) in the model files themselves: GGUF metadata (general.*) and the chat template stored in the tokenizer.

Used by export_gguf.sh on the Nova 1 GGUFs it produces, and by rebrand_gguf.py on a GGUF that is already being served.
What changes in a GGUF:
  * general.name / basename / organization / version / description / finetune / size_label -> Nova AI values;
  * provenance keys of the original upload (base_model.*, tags, repo_url, quantized_by, imatrix file and dataset names) are left out;
  * general.license and general.license.link are kept (Apache-2.0 asks that the licence travels with redistributed copies);
  * tokenizer.chat_template: a default system text naming another provider's model, if the template has one, is removed;
    nothing else is added to the template;
  * architecture, tokenizer and tensor data are copied unchanged, so llama.cpp loads the file exactly as before.
"""
import re
from pathlib import Path

META = {
    "general.name": "Nova AI (Nova 1)",
    "general.basename": "nova-ai-nova-1",
    "general.organization": "Sham",
    "general.version": "1",
    "general.finetune": "coder",
    "general.description": "Nova AI coding model (Nova 1), developed by the Sham team.",
}
DROP_PREFIXES = ("general.base_model.", "general.dataset.")
DROP_KEYS = ("general.tags", "general.repo_url", "general.url", "general.quantized_by", "general.source.url", "general.source.repo_url",
             "general.source.huggingface.repository", "quantize.imatrix.file", "quantize.imatrix.dataset")

# default system texts that some chat templates (e.g. Qwen2 / Qwen2.5) print when the conversation has no system message
DEFAULT_SYSTEM = re.compile(
    r"You are (?:Qwen|Tongyi Qianwen)[^'\"<]*?(?:Alibaba(?: Group| Cloud)?)\.(?: You are a helpful assistant\.)?"
    r"|You are a helpful assistant(?: created| developed| trained)? by [A-Z][\w ]{1,30}\.",
    re.I)


def clean_chat_template(tpl: str) -> str:
    """Removes a built-in default system text that names another provider; an emptied system turn is removed as a whole."""
    out = DEFAULT_SYSTEM.sub("", tpl)
    # '<|im_start|>system\n<|im_end|>\n' printed on its own (the former default turn) -> nothing
    out = re.sub(r"\{\{-?\s*'<\|im_start\|>system\\n<\|im_end\|>\\n'\s*-?\}\}", "", out)
    return out


def clean_tokenizer_dir(path: str | Path) -> bool:
    """Cleans the chat template saved with a Hugging Face tokenizer (chat_template.jinja and/or tokenizer_config.json)."""
    import json
    path, changed = Path(path), False
    jinja = path / "chat_template.jinja"
    if jinja.exists():
        t = jinja.read_text()
        c = clean_chat_template(t)
        if c != t:
            jinja.write_text(c)
            changed = True
    cfg = path / "tokenizer_config.json"
    if cfg.exists():
        d = json.loads(cfg.read_text())
        t = d.get("chat_template")
        if isinstance(t, str) and clean_chat_template(t) != t:
            d["chat_template"] = clean_chat_template(t)
            cfg.write_text(json.dumps(d, ensure_ascii=False, indent=2))
            changed = True
    return changed


def rebrand_gguf(src: str | Path, dst: str | Path, meta: dict | None = None) -> dict:
    """Writes a copy of src to dst with Nova AI metadata and a cleaned chat template; returns what changed."""
    import gguf
    from gguf.scripts.gguf_new_metadata import MetadataDetails, copy_with_new_metadata

    meta = {**META, **(meta or {})}
    reader = gguf.GGUFReader(str(src), "r")
    arch = reader.fields[gguf.Keys.General.ARCHITECTURE].contents()
    new = {k: MetadataDetails(gguf.GGUFValueType.STRING, v) for k, v in meta.items()}
    remove = [n for n in reader.fields if n.startswith(DROP_PREFIXES) or n in DROP_KEYS]
    tpl_field = reader.fields.get(gguf.Keys.Tokenizer.CHAT_TEMPLATE)
    template_changed = False
    if tpl_field is not None:
        tpl = tpl_field.contents()
        cleaned = clean_chat_template(tpl)
        template_changed = cleaned != tpl
        new[gguf.Keys.Tokenizer.CHAT_TEMPLATE] = MetadataDetails(gguf.GGUFValueType.STRING, cleaned)
    if "general.size_label" in reader.fields:
        new["general.size_label"] = MetadataDetails(gguf.GGUFValueType.STRING, reader.fields["general.size_label"].contents())
    writer = gguf.GGUFWriter(str(dst), arch=arch, endianess=reader.endianess)
    alignment = reader.fields.get("general.alignment")
    if alignment is not None:
        writer.data_alignment = alignment.contents()
    copy_with_new_metadata(reader, writer, new, remove)
    return {"arch": arch, "set": sorted(meta), "removed": sorted(remove), "chat_template_changed": template_changed}
