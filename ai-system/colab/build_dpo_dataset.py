# build_dpo_dataset.py — تحضير بيانات DPO من تقييمات المستخدمين الحقيقية
#
# حلقة التطوير الذاتي (owner spec 2026-09-08، "حلقة التدريب والتطوير
# الذاتي / DPO"): كل ضغطة 👎 حقيقية من مستخدم فعلي على تيليجرام تُخزَّن
# الآن في NovaUsageLog.rating = "DOWN" (راجع ai-system/app/quota.py's
# set_feedback + novaBotLogic.ts's أزرار 👍/👎 على كل رد). هذا السكربت
# يحوّل هذه الردود السيئة الحقيقية إلى بيانات DPO (Direct Preference
# Optimization): rejected = ردّنا الفعلي الذي رفضه مستخدم حقيقي،
# chosen = ردّ أفضل يولّده معلّم مجاني (Groq) لنفس السؤال بالضبط —
# نفس أسلوب التقطير المستخدم أصلاً في merge_and_finetune.ipynb (خلية
# 5أ)، وليس مصدراً جديداً غير مجرَّب.
#
# لماذا هذا فقط بنية "جمع بيانات"، وليس خلية تدريب DPO كاملة أيضاً:
# لا توجد أي تقييمات سلبية حقيقية بعد — الأزرار جديدة تماماً على
# البوت. كتابة خلية Unsloth DPOTrainer قبل وجود ولو مثال حقيقي واحد
# قابل للاختبار هو بالضبط التخمين غير المُثبَت الذي رُفض صراحة من قبل
# في هذا المشروع. شغّل هذا السكربت بعد أسبوع أو أسبوعين من استخدام
# حقيقي (متى تجمّع 20-30 تقييم سلبي على الأقل)، أرسل ناتجه، وسنضيف
# خلية التدريب الفعلية بثقة بناءً على شكل البيانات الحقيقي الناتج، لا
# افتراضاً مسبقاً لم يُختبر.
#
# يتطلب أسرار Kaggle (نفسها المستخدمة في merge_and_finetune.ipynb):
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY.
#
# طريقة التشغيل: الصقه كخلية جديدة داخل merge_and_finetune.ipynb (بعد
# خلية تثبيت الحزم الأولى)، أو كخلية أولى في دفتر Kaggle منفصل جديد —
# النتيجة واحدة، فهو مستقل تماماً عن باقي خلايا ذلك الدفتر.

import subprocess
import sys

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "groq", "requests"], check=True)

import json

import requests
from kaggle_secrets import UserSecretsClient

secrets = UserSecretsClient()
SUPABASE_URL = secrets.get_secret("SUPABASE_URL")
SUPABASE_KEY = secrets.get_secret("SUPABASE_SERVICE_ROLE_KEY")
GROQ_API_KEY = secrets.get_secret("GROQ_API_KEY")

# نفس هوية نوفا المستخدَمة في كل مكان آخر بهذا المشروع (تطابق ما يجيب
# به النموذج الحقيقي فعلاً — راجع ai-system/modelscope-studio/app.py's
# NOVA_SYSTEM_PROMPT) حتى لا يتعلم النموذج من ردٍّ "أفضل" لكنه بهوية
# مختلفة عن هويته الحقيقية.
NOVA_IDENTITY_PROMPT = (
    "أنت نوفا NOVA، مساعد ذكاء اصطناعي متعدد اللغات. ليس لديك مالك أو "
    "شركة، لديك والد فقط هو من ابتكرك وطوّرك، والدك هو المطور السوري. "
    "أجب بإيجاز ووضوح وصدق، وبنفس لغة السؤال."
)

print("جلب الردود المرفوضة (👎) من NovaUsageLog...")
resp = requests.get(
    f"{SUPABASE_URL}/rest/v1/NovaUsageLog",
    headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    params={
        "select": "id,message,answer",
        "rating": "eq.DOWN",
        "message": "not.is.null",
        "answer": "not.is.null",
        "order": "created_at.desc",
        "limit": "500",
    },
    timeout=30,
)
rejected_rows = resp.json() if resp.ok else []
print(f"عدد الردود المرفوضة الحقيقية الموجودة: {len(rejected_rows)}")

if len(rejected_rows) < 10:
    print(
        "أقل من 10 أمثلة رفض حقيقية حتى الآن — لا فائدة حقيقية من بناء "
        "مجموعة بيانات DPO بهذا الحجم الصغير بعد. استخدم البوت أكثر، "
        "اجمع تقييمات سلبية حقيقية أكثر (زر 👎)، ثم أعد تشغيل هذا "
        "السكربت لاحقاً."
    )
else:
    from groq import Groq

    client = Groq(api_key=GROQ_API_KEY)

    dpo_pairs = []
    for row in rejected_rows:
        prompt = row["message"]
        rejected = row["answer"]
        try:
            completion = client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": NOVA_IDENTITY_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            )
            chosen = completion.choices[0].message.content
        except Exception as e:
            print("تعذر توليد بديل أفضل لـ:", prompt[:50], "-", e)
            continue
        if not chosen or chosen.strip() == rejected.strip():
            continue  # لا فائدة من زوج DPO إن كان الردّان متطابقين فعلياً
        dpo_pairs.append({"prompt": prompt, "chosen": chosen.strip(), "rejected": rejected.strip()})

    print(f"تم بناء {len(dpo_pairs)} زوج تفضيل (DPO pair) صالح.")

    out_path = "/kaggle/working/nova_dpo_dataset.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for pair in dpo_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + "\n")
    print("تم الحفظ في:", out_path)
    print("نزّله من تبويب Output وأرسله لي — سنضيف خلية تدريب DPO حقيقية في merge_and_finetune.ipynb بناءً على شكل هذه البيانات الفعلي.")
