# دليل توليد المراحل — Abyss Block

> **الفلسفة:** مرحلة جيدة = عدد بلاطات قليل + أفخاخ نادرة (≤3 من كل نوع) + عدد خطوات كبير.
> مثال مثالي: 20 بلاطة، 7 أفخاخ، 30+ خطوة.

---

## الأوامر الأساسية

### توليد مراحل مباشرة → `levels/`

```bash
node scripts/generate-all.mjs
```

### توليد متغيرات متعددة لكل مرحلة → `levels-variants/`

```bash
node scripts/generate-variants.mjs
```

### دمج المتغيرات في تسلسل مرقّم → `levels-pruned/`

```bash
node scripts/prune-variants.mjs
```

---

## متغيرات البيئة الكاملة


| المتغير       | الافتراضي | الوصف                                          |
| ------------- | --------- | ---------------------------------------------- |
| `LEVEL_COUNT` | `20`      | عدد المراحل (حد أدنى 5)                        |
| `TOP_K`       | `5`       | أفضل كم متغير يُحفظ لكل مرحلة *(variants فقط)* |
| `EVOLUTION_N` | `20`      | عدد المرشحين يُجرَّب لكل مرحلة                 |
| `BASE_SEED`   | عشوائي    | البذرة الأساسية للتوليد                        |
| `DIFF_MIN`    | `2.5`     | صعوبة أول مرحلة                                |
| `DIFF_MAX`    | `7.5`     | صعوبة آخر مرحلة                                |
| `DIFF_SIGMA`  | `1.2`     | تساهل مطابقة الهدف (أصغر = أصرم)               |
| `DIR_DEG`     | `20`      | اتجاه توجيه المسار بالدرجات                    |
| `CROSS_WIDTH` | `3`       | نصف عرض الممر                                  |
| `LEVELS_OUT`  | `levels/` | مجلد الإخراج                                   |


---

## أمثلة عملية

### 1. توليد 20 مرحلة سريعاً (للاختبار)

```bash
LEVEL_COUNT=20 EVOLUTION_N=10 node scripts/generate-all.mjs
```

سريع (~30 ثانية). كل مرحلة تُجرَّب 10 مرشحين فقط، الجودة أقل قليلاً.

---

### 2. توليد 50 مرحلة بجودة عالية

```bash
LEVEL_COUNT=50 EVOLUTION_N=40 BASE_SEED=12345 node scripts/generate-all.mjs
```

- `LEVEL_COUNT=50` → 50 ملف في `levels/`
- `EVOLUTION_N=40` → كل مرحلة تختار أفضل مرشح من 40 محاولة
- `BASE_SEED=12345` → نتائج قابلة للتكرار (نفس البذرة = نفس المراحل دائماً)

---

### 3. توليد 50 مرحلة واستخراج أفضل 5 متغيرات لكل منها

**الخطوة 1 — توليد المتغيرات:**

```bash
LEVEL_COUNT=50 TOP_K=5 EVOLUTION_N=40 BASE_SEED=12345 \
  node scripts/generate-variants.mjs
```

المخرج: مجلد `levels-variants/` يحتوي على `50 × 5 = 250` ملف بصيغة `{slot}_{rank}.json`.

```
levels-variants/
  1_1.json   ← أفضل متغير للمرحلة 1
  1_2.json
  1_3.json
  1_4.json
  1_5.json   ← خامس أفضل متغير للمرحلة 1
  2_1.json
  ...
  50_5.json
```

**الخطوة 2 — ترقيم تسلسلي للاستخدام في اللعبة:**

```bash
INPUT_DIR=levels-variants OUTPUT_DIR=levels-pruned \
  node scripts/prune-variants.mjs
```

المخرج: `levels-pruned/` يحتوي 250 ملف مرقّمة `1.json → 250.json` بترتيب متصاعد للصعوبة.

---

### 4. التحكم في مستوى الصعوبة

الصعوبة تتدرج خطياً من `DIFF_MIN` إلى `DIFF_MAX`.
المقياس من 0 إلى 10، وأقصى قيمة قابلة للتحقيق عملياً ~8.5.

```bash
# مراحل سهلة جداً للمبتدئين (1.5 → 4.0)
DIFF_MIN=1.5 DIFF_MAX=4.0 LEVEL_COUNT=20 node scripts/generate-all.mjs

# مراحل متوسطة (3.0 → 6.0)
DIFF_MIN=3.0 DIFF_MAX=6.0 LEVEL_COUNT=20 node scripts/generate-all.mjs

# أقصى صعوبة (5.0 → 7.5)
DIFF_MIN=5.0 DIFF_MAX=7.5 LEVEL_COUNT=20 node scripts/generate-all.mjs
```

> **ملاحظة:** القيم فوق 7.5 نادراً ما تتحقق لأن المراحل الأبسط (قليلة البلاطات) لا تستطيع الوصول إليها.

---

### 5. التحكم في تدرج الصعوبة (DIFF_SIGMA)

`DIFF_SIGMA` يتحكم في مدى تساهل انتقاء المرشح مقارنةً بهدف الصعوبة.

```bash
# تدرج حاد جداً — كل مرحلة تطابق هدفها بدقة (لكن احتمالية فشل أعلى)
DIFF_SIGMA=0.5 EVOLUTION_N=50 node scripts/generate-all.mjs

# تدرج معتدل (الافتراضي)
DIFF_SIGMA=1.2 node scripts/generate-all.mjs

# تدرج متساهل — يُفضّل puzzle_efficiency على مطابقة الهدف
DIFF_SIGMA=2.5 node scripts/generate-all.mjs
```

**العلاقة بين DIFF_SIGMA و EVOLUTION_N:**

- `DIFF_SIGMA` صغيرة → زِد `EVOLUTION_N` لتعويض احتمالية الفشل
- `DIFF_SIGMA` كبيرة → يمكن تقليل `EVOLUTION_N` للسرعة

---

### 6. توليد موجة لعبة كاملة بـ 50 مرحلة

سيناريو كامل: 50 مرحلة، أفضل 5 متغيرات لكل منها، مُرتَّبة للعبة.

```bash
# 1. توليد المتغيرات (يأخذ ~5 دقائق)
LEVEL_COUNT=50 TOP_K=5 EVOLUTION_N=40 BASE_SEED=99999 \
  DIFF_MIN=2.5 DIFF_MAX=7.5 \
  node scripts/generate-variants.mjs

# 2. دمجها في تسلسل نهائي
INPUT_DIR=levels-variants OUTPUT_DIR=levels-pruned \
  node scripts/prune-variants.mjs

# النتيجة: 250 مرحلة في levels-pruned/
```

---

## فهم مخرجات التقرير

عند التشغيل يظهر تقرير مثل:

```
  ✓ 14  tgt=5.921  got=5.85  Δ=-0.07  fit=7.14  mv=16  ti=20  10×4  3f/2c/1m  evo=26/50 (5)
```


| الرمز       | المعنى                                           |
| ----------- | ------------------------------------------------ |
| `tgt=5.921` | الصعوبة المستهدفة لهذه المرحلة                   |
| `got=5.85`  | الصعوبة الفعلية المحسوبة                         |
| `Δ=-0.07`   | الفرق عن الهدف (أقرب لصفر = أدق)                 |
| `fit=7.14`  | `puzzle_efficiency` — جودة التصميم (أعلى = أفضل) |
| `mv=16`     | عدد الخطوات للحل الأمثل                          |
| `ti=20`     | عدد البلاطات                                     |
| `10×4`      | أبعاد الخريطة (عرض × طول)                        |
| `3f/2c/1m`  | أفخاخ: 3 fragile / 2 crumbling / 1 moving        |
| `evo=26/50` | المرشح الفائز كان رقم 26 من 50                   |
| `(5)`       | عدد المحاولات الداخلية في المحرك                 |


---

## مراحل التوليد (Phases)

تنقسم المراحل تلقائياً بحسب `LEVEL_COUNT` على 5 مراحل:


| المرحلة      | الوزن | الميكانيك                    | نطاق الصعوبة |
| ------------ | ----- | ---------------------------- | ------------ |
| `hard_start` | 25%   | fragile + crumbling          | 4–6          |
| `precision`  | 25%   | fragile + crumbling          | 5–7          |
| `moving`     | 25%   | fragile + crumbling + moving | 6–9          |
| `islands`    | 15%   | fragile + crumbling + portal | 7–9          |
| `abyss`      | 10%   | كل الميكانيك                 | 9–10         |


مثال لـ `LEVEL_COUNT=20`:

```
hard_start  → slots 1–5
precision   → slots 6–10
moving      → slots 11–15
islands     → slots 16–18
abyss       → slots 19–20
```

---

## قواعد الجودة المُطبَّقة تلقائياً

كل مرحلة تخضع لهذه الفلاتر قبل الحفظ:

- **≤ 3 fragile tiles** و **≤ 3 crumbling tiles** — لا أفخاخ مفرطة
- **لا بلاطة معزولة** — كل بلاطة لها جار واحد على الأقل
- **الحل أمثل** — BFS واعٍ بحالة crumbling يجد أقصر مسار حقيقي
- **تحقق مزدوج** — يُشغَّل `simulateLevel` على الملف النهائي قبل كتابته

---

## نصائح سريعة

**نفس المراحل دائماً:**

```bash
BASE_SEED=42 node scripts/generate-all.mjs
```

**توليد سريع للاختبار فقط:**

```bash
LEVEL_COUNT=5 EVOLUTION_N=5 node scripts/generate-all.mjs
```

**زيادة الجودة على حساب الوقت:**

```bash
EVOLUTION_N=100 LEVEL_COUNT=20 node scripts/generate-all.mjs
```

**مجلد إخراج مخصص:**

```bash
LEVELS_OUT=my-levels node scripts/generate-all.mjs
```

