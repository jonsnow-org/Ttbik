import json
import tempfile
import unittest
from pathlib import Path

from sham_intelligence_lab.verifiers import safe_arithmetic, verify_arithmetic, numeric_match
from sham_intelligence_lab.generators import generate_curriculum
from sham_intelligence_lab.splits import split_by_group, assert_no_group_leakage
from sham_intelligence_lab.mixture import balanced_mix
from sham_intelligence_lab.uncertainty import calibration_report
from sham_intelligence_lab.gates import evaluate_gate, GatePolicy
from sham_intelligence_lab.pipeline import build_dataset
from sham_intelligence_lab.distillation import verify_example
from sham_intelligence_lab.generators import evidence_examples, logic_examples
from sham_intelligence_lab.eval_harness import score_predictions


class LabTests(unittest.TestCase):
    def test_safe_arithmetic(self):
        self.assertEqual(safe_arithmetic("2 + 3 * 4"), 14)
        for bad in ("__import__('os')", "x + 1", "(1).__class__", "1 / 0"):
            with self.assertRaises(Exception): safe_arithmetic(bad)
        self.assertTrue(verify_arithmetic("8 * 7", "56").passed)

    def test_arabic_digits_and_ambiguous(self):
        self.assertTrue(numeric_match(12, "١٢").passed)
        self.assertFalse(numeric_match(12, "12 أو 13").passed)

    def test_generator_reproducible(self):
        a=generate_curriculum(9,3); b=generate_curriculum(9,3)
        self.assertEqual([x.sample_id for x in a],[x.sample_id for x in b])
        self.assertTrue(all(x.validate() is None for x in a))
        checked=[verify_example(x) for x in logic_examples(31,9)+evidence_examples(32,20,2)]
        self.assertEqual(sum(r.get("passed") is False for r in checked),0,checked)

    def test_splits_grouped(self):
        data=generate_curriculum(8,5)
        parts=split_by_group(data,seed=10)
        assert_no_group_leakage(parts)

    def test_mixture(self):
        data=generate_curriculum(2,4)
        chosen, report=balanced_mix(data,natural_share=.7,seed=2)
        self.assertEqual(len(chosen),len({x.sample_id for x in chosen}))
        self.assertIn("tasks",report)
        self.assertEqual(report["unverified_teacher_excluded"],0)

    def test_calibration(self):
        r=calibration_report([.9,.8,.2,.1],[True,True,False,False])
        self.assertLess(r.ece,.2)

    def test_gate_rejects_regression_and_missing_ece(self):
        base={t:{"loss":1.0,"accuracy":.7} for t in ("reasoning","evidence","uncertainty","natural_sft")}
        cand={t:{"loss":.98,"accuracy":.72} for t in base}
        cand["uncertainty"]["ece"]=.2
        result=evaluate_gate(base,cand,{t:150 for t in base},policy=GatePolicy(min_macro_improvement=.005,max_ece=.12))
        self.assertFalse(result["accepted"])

    def test_gate_accepts_prediction_evaluator_shape(self):
        tasks=("reasoning","evidence","uncertainty","natural_sft")
        baseline={"tasks":{t:{"loss":1.0,"accuracy":.70,"n":150} for t in tasks}}
        candidate={"tasks":{t:{"loss":.90,"accuracy":.72,"n":150} for t in tasks}}
        candidate["tasks"]["uncertainty"]["ece"]=.05
        result=evaluate_gate(baseline,candidate,policy=GatePolicy(min_examples_per_task=100))
        self.assertTrue(result["accepted"],result["failures"])

    def test_build_pipeline(self):
        with tempfile.TemporaryDirectory() as td:
            r=build_dataset(td,seed=5,count_per_task=2)
            self.assertGreater(r["total"],0)
            self.assertTrue((Path(td)/"train.jsonl").exists())
            self.assertTrue((Path(td)/"test.jsonl").exists())
            self.assertTrue((Path(td)/"build_report.json").exists())
            self.assertTrue((Path(td)/"distillation/stage_2_verifiable_reasoning.jsonl").exists())
            self.assertGreater(len((Path(td)/"test.jsonl").read_text().splitlines()),0)

    def test_unreviewed_teacher_is_quarantined(self):
        with tempfile.TemporaryDirectory() as td:
            source=Path(td)/"teacher.jsonl"
            source.write_text('{"prompt":"احسب 2+2","target":"4","task":"reasoning","teacher_id":"demo","verifier":"safe_arithmetic","verification":{"expression":"2+2"},"metadata":{"reviewed":false}}\n',encoding="utf-8")
            out=Path(td)/"out"
            report=build_dataset(str(out),seed=3,count_per_task=1,teacher_jsonl=str(source))
            self.assertEqual(report["teacher_quarantine"],1)
            self.assertEqual(report["distillation_stages"]["stage_1_behavior"]["examples"],0)
            quarantined=(out/"quarantine/teacher_unreviewed.jsonl").read_text(encoding="utf-8").strip()
            self.assertTrue(quarantined)

    def test_prediction_evaluator(self):
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/"data"
            build_dataset(str(out),seed=12,count_per_task=3)
            rows=[]
            for line in (out/"test.jsonl").read_text(encoding="utf-8").splitlines():
                ex=json.loads(line)
                verifier=ex["verifier"]
                row={"sample_id":ex["sample_id"],"confidence":0.9,"loss":0.2,"abstained":False}
                if verifier=="safe_arithmetic":
                    from sham_intelligence_lab.verifiers import safe_arithmetic
                    row["prediction"]=str(safe_arithmetic(ex["verification"]["expression"]))
                elif verifier=="numeric_match":
                    row["prediction"]=str(ex["verification"]["expected"])
                elif verifier=="evidence_substring":
                    row["answer"]=ex["verification"]["answer"]
                    row["source_id"]=ex["verification"]["source_id"]
                    row["prediction"]=row["answer"]
                elif verifier=="abstain_expected":
                    row["prediction"]="لا تتوفر المعلومة"; row["abstained"]=True
                elif verifier=="logical_entailment":
                    row["prediction"]=ex["target"]
                else:
                    row["human_correct"]=True; row["prediction"]=ex["target"]
                rows.append(row)
            pred=Path(td)/"predictions.jsonl"
            pred.write_text("".join(json.dumps(x,ensure_ascii=False)+"\n" for x in rows),encoding="utf-8")
            result=score_predictions(str(out/"test.jsonl"),str(pred))
            self.assertGreater(result["scored_predictions"],0)
            self.assertIsNotNone(result["calibration"])
            for task_metrics in result["tasks"].values():
                if task_metrics["n"]:
                    self.assertIsNotNone(task_metrics["ece"])

    def test_teacher_verifier_rejects_bad_answer(self):
        from sham_intelligence_lab.schema import example_from_teacher
        ex=example_from_teacher(prompt="احسب 2+2",target="5",task="reasoning",teacher_id="demo",
            verifier="safe_arithmetic",verification={"expression":"2+2"},
            metadata={"reviewed":True,"verification_status":"passed"})
        self.assertFalse(verify_example(ex)["passed"])


if __name__=="__main__": unittest.main()
