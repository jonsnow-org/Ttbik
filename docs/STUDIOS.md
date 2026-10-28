# توزيع استوديوهات ModelScope (10 استوديوهات بعد #515) / Studio distribution

الأجهزة: free CPU `platform/2v-cpu-8g-mem` (2 vCPU، 7.88 GB RAM، قرص ~9.81 GiB) ما لم يُذكر. القياسات من `modelscope-inventory.yml` (run 40616626302) و`studio-logs.yml` و`deploy-modelscope-sham-v2-video.yml`.

| الاستوديو | النموذج المالك | الدور | الأوزان | القرص مستعمل/حر | RAM حر | الحالة |
|---|---|---|---|---|---|---|
| coder-inference-server (1) | Nova | مفكّر/وكيل الكود | Qwen3.5-4B Q4_K_M، سياق 65536 | 2.63 / 6.66 GiB | 1.6–2.6 GB من 7.88 | يعمل، طابور 0 |
| coder-inference-server-2 … -4 | Nova | نسخ طابور المبرمج | نفسها | 2.63 / 6.66 | 1.6–2.6 | تعمل |
| coder-inference-server-5 | Nova | نسخة الرؤية (vision) | Qwen3.5-4B + mmproj | 2.63 / 6.66 | 1.63 (الأضيق) | تعمل |
| nova-media-server | Nova | صورة SDXS + كلام Piper + فيديو AnimateDiff | SDXS، Piper ar، epiCRealism+AnimateDiff-Lightning | 4.85 / 4.44 | كافٍ (يحمل واحداً في كل مرة) | **مُتحقَّق حياً**: صورة 512² std 64.6 (غير سوداء، مطالبة الأسد)، كلام 4.16ث، فيديو 8 إطارات motion 2.31 (run 40620178551) |
| sham-v1-server | Sham القديم | دردشة + وسائط من رموزه | final_merged.pt (خطوة 61,555) | — | — | يعمل، لا يُمس |
| sham-v2-server | Sham v2 | دردشة + صورة SDXS + كلام Piper (بلا فيديو) | جسم نص ~4 GiB + media 2.0 GiB (SDXS 4 ملفات، Piper) | 6.07 / 3.22 GiB (حر 3297 MiB بعد إعادة النشر) | 7.1 GB حر عند الإقلاع، ~1.4 مع النموذج والتوليد | **سليم**: عربي 19ث/4ث، صورة std 44.1، كلام 4.41ث (runs 40636874849, 40637047098)؛ كان ينهار (502) عند الفيديو → أُخرج الفيديو منه |
| **sham-v2-video-server (جديد، #515)** | Sham v2 | فيديو حقيقي فقط | epiCRealism (fp16-sized) + AnimateDiff-Lightning من ModelScope، 2.9 GiB | 2.84 / 6.46 | 2.28 GB حر والخط محمّل | **مُتحقَّق حياً**: 8 إطارات motion 2.31 في 77ث (run 40628894315) |
| nova-inference-server | قديم (Nova legacy) | لا يستعمله أي بوت (`shamStudio.ts` يتجاهله)؛ يشغّل نسخة Sham قديمة | final_merged.pt | — | 16 GB RAM | **مرشّح للإيقاف/إعادة التوظيف** — قرار المالك (حذف/إيقاف استوديو إجراء لا نقوم به نحن) |

## لماذا هذا التوزيع
- الاستقلال: لا استوديو مشترك بين Nova وSham v2؛ Sham القديم له استوديوه. لكل نموذج استوديو وسائطه (Nova: nova-media-server؛ Sham v2: sham-v2-server للصورة/الكلام + sham-v2-video-server للفيديو).
- سبب الفصل: سجل sham-v2-server الحي أظهر اكتمال خطوات AnimateDiff (4/4، 31ث) ثم موت الاستوديو (502)؛ RAM الحر 1.4 من 8 GB مع نموذج النص، وخط الفيديو يستهلك 4.3–5.5 GB (قياس محلي RSS). القرص أيضاً لم يتّسع (حر 0.39 GiB بعد تنزيل أوزان الفيديو).
- نوفا: القرص ليس عائقاً (حر 6.66 و4.44 GiB)؛ لا حاجة لإعادة توزيع.
- توصية: إيقاف nova-inference-server (يحرر حصة استوديو) بعد موافقة المالك.
