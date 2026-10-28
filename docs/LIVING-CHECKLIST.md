# قائمة المتابعة / Living checklist  (آخر تحديث 03:55 توقيت إسطنبول)

PR الدفعة: https://github.com/jonsnow-org/Ttbik/pull/504 (Batch 3) — **مدموج** (merge a356a602، كل فحوص CI خضراء). قائمة المتابعة: https://github.com/jonsnow-org/Ttbik/pull/505 (draft، لا تُدمج)

## Done (منجز)
| # | المتطلب | الدليل |
|---|---|---|
| 1 | Nova smoke test الفاشل: السبب الجذري + إصلاح + إزالة «slideshow» | السبب: الاختبار يعمل على نفس الـpush مع الاستوديو القديم (404 على speech) ويفحص الحجم فقط. الحل: `nova_media_probe.py` + 18 اختبار وحدة في CI (`nova-media-client-tests` أخضر) — #504 |
| 2 | فحص محتوى حقيقي: صورة غير سوداء (std)، صوت غير صامت، فيديو إطارات>1 وحركة | محلياً على الكود المدموج (CPU): صورة 512² std 41.9؛ كلام 4.25ث peak 1.0؛ فيديو AnimateDiff 8 إطارات motion 4.01 std 73.8 (probe_local.log). على الاستوديو المنشور: صورة std 41.9 ✔ وكلام 4.08ث ✔ (run 40606588053) |
| 3 | خطأ حقيقي وُجد وأُصلح: الـprobe كان يتجاهل أول `data: null` (heartbeat) في SSE فيعلق على الفيديو | commit "probe: skip SSE heartbeats…" + اختبارين |
| 4 | Sham v2 smoke: `No module named numpy` | خطوة pip install في `deploy-modelscope-sham-v2.yml` |
| 5 | SSRF لبحث الويب: العناوين العامة تمر؛ ثغرة IPv4-mapped (hex) مُصلحة | اختبارات `coderWeb.test.ts`؛ 198.18.0.1 من موزّع الصندوق محجوب صحيحاً (RFC2544) |
| 6 | أولوية طابور Pro/المالك حقيقية | `PriorityQueue` + 6 اختبارات في CI + `queuePriority` + اختبارات TS |
| 7 | دمج #381 و#384 (حل التعارضات مع الإبقاء على الطرفين) | داخل #504 |
| 8 | #376 نُقلت أجزاؤه المفيدة: مهلة شاملة واحدة، لا محاولات متسلسلة، موصلا Calendar/GitLab + زر اختبار + تجميع | داخل #504 + اختبارات shamStudio / coderBillingConnectors |
| 9 | #374: لا استطلاع متداخل، تطبيع الأخطاء، موافقة/رفض متجاوبة | داخل #504 |
| 10 | نوفا للجميع بحصة يومية: مجاني 3 صور/3 فيديو، Plus 20/8، Pro 60/20 (صوت 10/40/120)، المالك بلا حد، رسالة عربية مع الترقية، إعادة التصفير منتصف الليل (إسطنبول)، العدّ بعد النجاح المفحوص فقط | `coderMedia.ts` + `coderMediaQuota.test.ts` (10 اختبارات): المجاني 3 ثم الرابع مرفوض برسالة الترقية، المالك 6، شام يبقى للمالك فقط، البرومبت لا يقول owners-only. لا يوجد بوابة مالك في الكود؛ السبب كان استنتاج النموذج من البرومبت |
| 12 | دمج #504 | merge commit a356a602 في claude/free-services-marketplace-h6rwk2؛ build/check/guard/nova-media-client-tests/sham-media-cpu-tests ✅؛ tsc نظيف؛ jest 95 suites / 837 passed |
| 13 | فيديو Nova المنشور (2 CPU): إطارات>1 + حركة | run 40610890288 ✅: READY engine=AnimateDiff-Lightning؛ صورة std 41.9؛ كلام 4.08ث؛ فيديو 8 إطارات motion 2.31 frame_std 78.1 (84ث). فشل 40610358578 كان غياب ffmpeg على الـrunner → imageio-ffmpeg |
| 14 | #471 أُغلق بتعليق توضيحي (فيديو خارجي ممنوع) | https://github.com/jonsnow-org/Ttbik/pull/471 |
| 15 | #376 و#374 أُغلقا كـsuperseded بتعليق؛ #381/#384 مدموجان | تعليقات على الـPRs |
| 11 | مرحلتا 1-2 ودفعتا 1-2 (#502/#503 مدموجتان): قوائم المحادثات، إعدادات الذاكرة، CI معزول، Nova e2e، فصل شام/شام v2/نوفا، إعدادات لكل نموذج، مفاتيح المالك | PRs #486–#503 |

## Not done yet (لم يكتمل بعد)
| # | البند | الحالة / السبب |
|---|---|---|
| B | فيديو Sham v2 المنشور (إطارات>1 + حركة) | نشر ما بعد الدمج جارٍ (run 40611229169) ثم smoke؛ لا توكن في الصندوق فالفحص عبر workflows فقط |
| D | تشغيل probe على نوفا بعد نشر الكود المدموج (النشر 40611229273 جارٍ) + نشر الـcoder Studio (40611229163) | بعد انتهاء النشر |
| F | #237 (base main، يتعارض، أقدم من فرعنا، edge-tts ممنوع) | تُترك مفتوحة — في قائمة المراجعة |
| G | #184 | لا يُمس أبداً |
| H | إعادة تسمية البوت «SHAM AI» في BotFather | إجراء يدوي من المالك (لا صلاحية لنا) |
| I | ESLint لا يعمل في الصندوق | الاعتماد على tsc/jest/CI |

## Review list (PRs غير مدموجة)
- #471 (أُغلق بتعليق، ليس في القائمة المفتوحة): فيديو عبر HF Space خارجي ممنوع.
- #237 Promo videos: per-episode brand and CTA — base: main — 25 ملفاً، تعارض، الفرع العامل يحوي نسخاً أحدث (دمجه يُرجع episodes.json/Promo.tsx/README) + edge-tts ممنوع. تُترك.
- #184 Promo supervision (draft) — لا يُمس.
- #381/#384 مدموجان؛ #376/#374 أُغلقا superseded.
(القائمة الكاملة: /workspace/work/openprs.tsv)
