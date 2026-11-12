import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import import_hf_sources as importer
from sham_intelligence_lab.distillation import ingest_teacher_jsonl
from sham_intelligence_lab.pipeline import load_natural_jsonl


class DataExpansionTests(unittest.TestCase):
    def test_aya_import_keeps_only_arabic_human_pairs(self):
        row = {"inputs": "ما عاصمة المغرب؟", "targets": "الرباط.",
               "language_code": "arb", "annotation_type": "original-annotations"}
        result = importer.convert_row("aya_human", row, 4, "default")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["source_kind"], "natural")
        self.assertEqual(result[0]["target"], "الرباط.")
        english = importer.convert_row("aya_human", {**row, "language_code": "eng"}, 5, "default")
        self.assertEqual(english, [])

    def test_jais_sft_excludes_separate_thinking_fields(self):
        row = {"messages": [
            {"role": "user", "content": "ما ناتج 2 + 2؟", "think": None},
            {"role": "assistant", "content": "الناتج 4.", "think": "طريق تفكير مطول لا يجب نسخه"}
        ], "category": "math", "conv_index": 9}
        result = importer.convert_row("jais3_sft", row, 2, "arabic-txt360-3efforts-sft")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["target"], "الناتج 4.")
        self.assertNotIn("طريق تفكير", json.dumps(result, ensure_ascii=False))
        self.assertFalse(result[0]["metadata"]["reviewed"])

    def test_think_trace_is_stripped_from_openr1_style_messages(self):
        text = "<think>private reasoning that must not be copied</think>Final answer: 42"
        self.assertEqual(importer._strip_think(text), "Final answer: 42")
        self.assertEqual(importer._strip_think("<think>unclosed trace"), "")

    def test_public_teacher_sample_is_parseable_and_unreviewed(self):
        sample = ROOT / "data/samples/teacher_outputs_public_sample.jsonl"
        rows, report = ingest_teacher_jsonl(sample)
        self.assertEqual(report["rejected"], [])
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(row.source_kind == "teacher" for row in rows))
        self.assertTrue(all(row.metadata.get("teacher_output_is_unverified") for row in rows))

    def test_gpt6_teacher_seed_is_parseable_and_large_variety(self):
        sample = ROOT / "data/samples/gpt6_teacher_seed.jsonl"
        rows, report = ingest_teacher_jsonl(sample)
        self.assertEqual(report["rejected"], [])
        self.assertGreaterEqual(len(rows), 25)
        self.assertEqual({row.metadata.get("authoring_method") for row in rows}, {"gpt6-session"})
        self.assertTrue(all(row.source_kind == "teacher" for row in rows))

    def test_mixed_aya_collection_pair_is_not_auto_classified_as_natural(self):
        row = {"inputs": "سؤال تجريبي", "targets": "إجابة تجريبية", "task_name": "translation"}
        result = importer.convert_row("aya_collection_config", row, 8, "north_levantine_arabic")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["record_type"], "review_required_pair")
        self.assertEqual(result[0]["source_kind"], "unclassified")

    def test_aya_human_sample_loads_through_natural_adapter(self):
        sample = ROOT / "data/samples/aya_human_arabic_sample.jsonl"
        rows, errors = load_natural_jsonl([str(sample)])
        self.assertEqual(errors, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].source_kind, "natural")

    def test_raw_corpus_is_not_auto_labelled_human_natural(self):
        row = {"text": "هذا نص عربي تجريبي طويل بما يكفي ليكون سجلاً خاماً ضمن اختبار تصنيف مصدر البيانات."}
        result = importer.convert_row("jais3_cc", row, 11, "arabic-txt360-cc")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["source_kind"], "corpus_candidate")
        self.assertTrue(result[0]["origin_review_required"])


if __name__ == "__main__":
    unittest.main()
