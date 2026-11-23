import pytest
import torch

from qalam import Qalam
from qalam.config import small_config, tiny_config
from qalam.data import Record, admit, chat_example, dedup, leak_report, pack
from qalam.tokenizer import QalamTokenizer

CORPUS = ["مرحبا بك في قلم، نموذج عربي وإنجليزي أصلي. Hello and welcome to Qalam, a native model.", "def add(a, b):\n    return a + b\n",
          "السلام عليكم ورحمة الله وبركاته", "The quick brown fox jumps over the lazy dog 12345 times."] * 40


@pytest.fixture(scope="module")
def tok() -> QalamTokenizer:
    return QalamTokenizer.train(CORPUS, vocab_size=300)


def test_byte_ids_come_first_and_everything_round_trips(tok):
    cfg = tiny_config()
    tok.check_contract(type(cfg)(**{**cfg.to_dict(), "text_vocab": tok.vocab_size}))
    assert tok.encode("A") == [65] and tok.encode(" ") == [32] and tok.encode("a")[0] == 97          # byte b has id b
    for text in ("مرحبا بك", "emoji 😀🙂 mix", "tab\tand\nnewline", "\x00\x01\x02 control", "日本語のテキスト", "naïve café — dash"):
        ids = tok.encode(text)
        assert tok.decode(ids) == text and max(ids) < tok.vocab_size and min(ids) >= 0
    assert tok.vocab_size == 300


def test_merges_compress_the_training_language(tok):
    assert tok.fertility(CORPUS[:4]) < 0.9                       # learned merges beat bytes (1.0)
    with pytest.raises(ValueError):
        QalamTokenizer.train(["x"], vocab_size=100)


def test_tokenizer_save_load_and_contract_mismatch(tok, tmp_path):
    tok.save(tmp_path / "t.json")
    again = QalamTokenizer.load(tmp_path / "t.json")
    assert again.encode("مرحبا Hello") == tok.encode("مرحبا Hello")
    with pytest.raises(ValueError):
        again.check_contract(small_config())                      # 300 tokens vs the model's 8192


def test_admission_rules():
    ok = Record("A fine sentence of text.", "wiki", "external_reviewed", "CC-BY-SA")
    assert admit(ok)[0]
    assert not admit(Record("text", "x", "commercial_model_output", "x"))[0]              # never
    assert not admit(Record("text", "x", "external_staged", "unknown"))[0]
    assert not admit(Record("   ", "x", "owner_curated"))[0]
    assert not admit(Record("write to me at someone@example.com", "x", "owner_curated"))[0]
    assert not admit(Record("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "x", "owner_curated"))[0]
    assert not admit(Record("hello", "x", "made_up"))[0]


def test_dedup_and_leaks():
    a = Record("The cat sat on the mat today.", "s", "owner_curated")
    b = Record("the CAT sat on the mat, today!", "s", "owner_curated")
    c = Record("Something else entirely different here.", "s", "owner_curated")
    kept, removed = dedup([a, b, c])
    assert len(kept) == 2 and removed == 1
    train = [Record("one two three four five six seven eight nine ten eleven twelve", "s", "owner_curated")]
    held = [Record("five six seven eight nine ten eleven twelve thirteen", "s", "owner_curated", split="held"),
            Record("completely unrelated words that share nothing at all with training", "s", "owner_curated", split="held")]
    rep = leak_report(train, held)
    assert rep["held_out"] == 2 and rep["leaked"] == [0]


def test_packing_keeps_documents_apart_and_pads():
    cfg = tiny_config()
    docs = [[1, 2, 3], [4, 5], list(range(10, 30))]
    p = pack(cfg, docs, seq_len=8)
    assert p["ids"].shape[1] == 9 and p["ids"].shape == p["segments"].shape == p["loss_mask"].shape
    flat = p["ids"].flatten().tolist()
    assert flat[:4] == [1, 2, 3, cfg.special_id("EOS")] and flat[4:7] == [4, 5, cfg.special_id("EOS")]
    assert p["segments"].flatten()[0] == 0 and p["segments"].flatten()[4] == 1
    assert (p["loss_mask"][p["segments"] == -1] == 0).all() and (p["ids"][p["segments"] == -1] == cfg.special_id("PAD")).all()
    with pytest.raises(ValueError):
        pack(cfg, [[1, 2]], 8, loss_masks=[[1]])


def test_packed_rows_train_and_documents_stay_independent():
    cfg = tiny_config()
    torch.manual_seed(1)
    m = Qalam(cfg).eval()
    p = pack(cfg, [[5, 6, 7, 8], [9, 10, 11]], seq_len=7)
    row = p["ids"][:1, :-1]
    seg = p["segments"][:1, :-1]
    logits, _ = m(row, segments=seg)
    assert row.tolist()[0][5:] == [9, 10] and seg.tolist()[0][5:] == [1, 1]
    alone, _ = m(torch.tensor([[9, 10]]))                                      # (the row's last token, 11, is only the target)
    assert torch.allclose(logits[:, 5:7], alone, atol=1e-5)                   # the second packed document equals itself alone


def test_chat_loss_only_on_assistant():
    cfg = tiny_config()
    enc = lambda s: [ord(c) % 200 for c in s]   # noqa: E731
    ids, mask = chat_example(cfg, enc, "be kind", [("user", "hi"), ("assistant", "hello"), ("user", "bye"), ("assistant", "ok")])
    assert len(ids) == len(mask) and sum(mask) == len("hello") + 1 + len("ok") + 1
    sp = cfg.special_id
    assert ids[0] == sp("SYSTEM") and mask[0] == 0 and ids.count(sp("USER")) == 2 and ids.count(sp("ASSISTANT")) == 2
    with pytest.raises(ValueError):
        chat_example(cfg, enc, "", [("robot", "x")])
