# دليل توليد المراحل — Abyss Block

## الاستخدام السريع

```bash
# توليد بالإعدادات الافتراضية (20 مرحلة، 20 جيلاً)
node scripts/generate-all.mjs

# جودة عالية: 500 جيل لكل مرحلة
EVOLUTION_N=500 node scripts/generate-all.mjs

# تثبيت البذرة لنتائج قابلة للتكرار
BASE_SEED=12345 EVOLUTION_N=500 node scripts/generate-all.mjs

# تخصيص كامل
BASE_SEED=777 EVOLUTION_N=200 LEVEL_COUNT=30 DIFF_MIN=2.0 DIFF_MAX=10.0 DIFF_SIGMA=1.0 \
  node scripts/generate-all.mjs
```

---

## جميع متغيرات البيئة

| المتغير | الافتراضي | الوصف |
|---------|-----------|-------|
| `EVOLUTION_N` | `20` | عدد المرشحين لكل مرحلة. كلما زاد = ترتيب أفضل + وقت أكثر |
| `LEVEL_COUNT` | `20` | عدد المراحل المراد توليدها (مدى: 5–100) |
| `DIFF_MIN` | `3.5` | صعوبة المرحلة الأولى (1.0–9.0) |
| `DIFF_MAX` | `9.5` | صعوبة المرحلة الأخيرة (DIFF_MIN+1 – 10.0) |
| `DIFF_SIGMA` | `1.2` | تسامح مطابقة الهدف. أصغر = أصرم في الترتيب (انظر الجدول أدناه) |
| `BASE_SEED` | عشوائي | بذرة التوليد. نفس البذرة + نفس الإعدادات = نفس النتائج |
| `DIR_DEG` | `20` | اتجاه نمو المسار بالدرجات من الشرق (`0`=شرق، `90`=جنوب) |
| `CROSS_WIDTH` | `3` | نصف عرض الممر العرضي. قيمة أصغر = مراحل أضيق وأصعب |
| `LEVELS_OUT` | `levels/` | مسار مجلد ملفات JSON المُنتَجة |

---

## التحكم بالجودة: EVOLUTION_N

### المبدأ

لكل مرحلة (slot)، يولّد المحرك `EVOLUTION_N` مرشحاً بـ seeds مختلفة، ويختار الأفضل بمعيار مزدوج:

```
selection_score = puzzle_efficiency × (0.25 + 0.75 × proximity_to_target)

proximity = exp(-(score - target)² / (2 × DIFF_SIGMA²))
```

الـ `0.25` هو حد أدنى: حتى لو لا يوجد مرشح قريب من الهدف، يُختار الأكفأ.

### أثر EVOLUTION_N على الجودة والوقت

| `EVOLUTION_N` | وقت التوليد (20 مرحلة) | متوسط \|Δ\| عن الهدف | OUT OF ORDER المتوقعة |
|---|---|---|---|
| `1` | ~5 ثوان | ~1.5 | 8–12 مرحلة |
| `20` | ~60 ثانية | ~0.30 | 4–6 مراحل |
| `50` | ~3 دقائق | ~0.20 | 2–4 مراحل |
| `100` | ~6 دقائق | ~0.15 | 1–3 مراحل |
| `300` | ~18 دقيقة | ~0.10 | 0–2 مراحل |
| `500` | ~28 دقيقة | ~0.07 | 0–1 مراحل |
| `1000` | ~55 دقيقة | ~0.05 | 0 مراحل (شبه مضمون) |

> **النقطة المثلى:** بين `200` و`500`. فوق `1000` العائد ضئيل جداً.

---

## التحكم بالترتيب: DIFF_SIGMA

`DIFF_SIGMA` يتحكم في مدى قبول المرشحين البعيدين عن الهدف.

| `DIFF_SIGMA` | التأثير |
|---|---|
| `0.5` | صارم جداً — يرفض أي مرشح يختلف أكثر من ±1 نقطة |
| `1.0` | صارم — مناسب مع `EVOLUTION_N ≥ 100` |
| `1.2` | **الافتراضي** — توازن بين الترتيب والجودة |
| `2.0` | متساهل — يقبل مرشحين بعيدين إذا كانوا أكثر كفاءة |
| `5.0` | شبه تجاهل للهدف — يختار الأكفأ بغض النظر عن الصعوبة |

**قاعدة:** كلما خفضت `DIFF_SIGMA`، ارفع `EVOLUTION_N` للتعويض.

```bash
# دقة عالية في الترتيب (يتطلب EVOLUTION_N كبير)
DIFF_SIGMA=0.8 EVOLUTION_N=500 node scripts/generate-all.mjs

# توليد سريع، ترتيب تقريبي
DIFF_SIGMA=2.0 EVOLUTION_N=20 node scripts/generate-all.mjs
```

---

## التحكم بنطاق الصعوبة: DIFF_MIN / DIFF_MAX

الصعوبات المستهدفة تتوزع خطياً بين `DIFF_MIN` (المرحلة 1) و`DIFF_MAX` (المرحلة الأخيرة).

```
target[i] = DIFF_MIN + (DIFF_MAX - DIFF_MIN) × i / (LEVEL_COUNT - 1)
```

### أمثلة على نطاقات الصعوبة

```bash
# مراحل سهلة كتعليمي (للأطفال)
DIFF_MIN=1.0 DIFF_MAX=5.0 node scripts/generate-all.mjs

# نطاق متوسط
DIFF_MIN=3.0 DIFF_MAX=8.0 node scripts/generate-all.mjs

# الافتراضي: صعب من البداية
DIFF_MIN=3.5 DIFF_MAX=9.5 node scripts/generate-all.mjs

# نطاق متخصص: فقط المراحل الصعبة جداً
DIFF_MIN=7.0 DIFF_MAX=10.0 LEVEL_COUNT=10 node scripts/generate-all.mjs
```

**تحذير:** القيم خارج المدى الحقيقي لكل مرحلة ستُنتج مراحل بصعوبة "قريبة من الهدف لكن ليست مطابقة". مثلاً `DIFF_MIN=1.0` مع مرحلة hard_start ستُنتج أبسط مرحلة ممكنة (~3.0) لأن المحرك لا يُولّد مستويات أسهل من ذلك.

---

## التحكم بعدد المراحل: LEVEL_COUNT

المراحل تُوزَّع تلقائياً على 5 أنواع بأوزان ثابتة:

| النوع | الوزن | الميكانيكيات |
|-------|-------|--------------|
| hard_start | 25% | fragile + crumbling |
| precision | 25% | fragile + crumbling (ثقيل) |
| moving | 25% | fragile + crumbling + moving |
| islands | 15% | fragile + crumbling + portals |
| abyss | 10% | كل الميكانيكيات |

### أمثلة على التوزيع

```bash
# 10 مراحل: [3, 2, 2, 2, 1]
LEVEL_COUNT=10 EVOLUTION_N=200 node scripts/generate-all.mjs

# 20 مراحل (افتراضي): [5, 5, 5, 3, 2]
LEVEL_COUNT=20 EVOLUTION_N=100 node scripts/generate-all.mjs

# 50 مرحلة: [13, 13, 12, 7, 5]
LEVEL_COUNT=50 EVOLUTION_N=100 node scripts/generate-all.mjs
```

---

## وصفات جاهزة

### الأفضل جودةً (500 جيل، ~30 دقيقة)
```bash
BASE_SEED=777000 \
EVOLUTION_N=500 \
LEVEL_COUNT=20 \
DIFF_MIN=3.5 \
DIFF_MAX=9.5 \
DIFF_SIGMA=1.0 \
node scripts/generate-all.mjs
```

### للتطوير السريع (~1 دقيقة)
```bash
BASE_SEED=42 EVOLUTION_N=20 node scripts/generate-all.mjs
```

### مجموعة 30 مرحلة بصعوبة موسّعة
```bash
BASE_SEED=88888 \
EVOLUTION_N=200 \
LEVEL_COUNT=30 \
DIFF_MIN=2.5 \
DIFF_MAX=10.0 \
DIFF_SIGMA=1.0 \
LEVELS_OUT=levels-30/ \
node scripts/generate-all.mjs
```

### إعادة توليد مرحلة واحدة فقط (للاختبار)
```bash
# ابحث عن بذرة مرحلة معينة في level_metadata.evolution.winner_seed
# ثم استخدمها مباشرة في الـ REPL:
node --input-type=module <<'EOF'
import { buildLevelVerified, computeEvolutionFitness, computeCriticalTiles, computeBehavioralMetrics } from './abyss-engine.mjs';

const { lvl } = buildLevelVerified({
  seed: 3942817,          // ← winner_seed من ملف JSON
  difficulty: 6,
  gridSize: 24,
  mechanics: {
    fragile: true, crumbling: true, moving: false, portal: false,
    fragileRate: 0.48, crumblingRate: 0.28, constraintMode: true
  },
  expansionOpts: { dirAngleDeg: 20, spreadDeg: 85, crossAxisLimit: 2 }
}, { minMoves: 28, maxMoves: 58, minBFSMoves: 16 }, 45);

const ct  = computeCriticalTiles(lvl);
const m   = computeBehavioralMetrics(lvl, ct);
const fit = computeEvolutionFitness(lvl, ct, m);
console.log({ moves: lvl.solution_data.length, tiles: lvl.tiles.length,
              score: m.behavioral_difficulty, fitness: fit });
EOF
```

---

## فهم تقرير الترتيب

```
── Difficulty report  (target → actual  Δ)
  ▲  1  [hard_start]  tgt=3.5   got= 3.30  Δ= -0.2  ███░░░░░░░
  ▲  2  [hard_start]  tgt=3.816  got= 3.66  Δ=-0.16  ████░░░░░░
  ▲  3  [hard_start]  tgt=4.132  got= 4.54  Δ=+0.41  █████░░░░░
  ▼  6  [precision ]  tgt=5.079  got= 4.96  Δ=-0.12  █████░░░░░ ⚠ OUT OF ORDER
```

| الرمز | المعنى |
|-------|--------|
| `▲` | هذه المرحلة أصعب من السابقة ✓ |
| `▼` | هذه المرحلة أسهل من السابقة (خروج عن الترتيب) |
| `tgt` | الصعوبة المستهدفة |
| `got` | الصعوبة الفعلية المُحققة |
| `Δ` | الفرق (موجب = فوق الهدف، سالب = تحت الهدف) |
| `█` | كل مربع = نقطة صعوبة واحدة من 10 |

**قاعدة:** إذا ظهرت `⚠ OUT OF ORDER` بفارق `|Δ| < 0.3`، فهي طبيعية ولن يلاحظها اللاعب. إذا كانت `|Δ| > 0.5`، ارفع `EVOLUTION_N`.

---

## هيكل ملف JSON المُنتَج

```jsonc
{
  "level_metadata": {
    "slot": 7,
    "phase": "precision",
    "target_difficulty": 5.395,    // الهدف المُحدَّد
    "computed_difficulty": 5.70,   // الصعوبة الفعلية المحسوبة

    "evolution": {
      "n_candidates": 500,
      "winner_index": 312,         // ترتيب الفائز من 500 مرشح
      "winner_seed": 8821943,      // بذرته للتتبع
      "selection_score": 7.234,    // نقاط الانتخاب = fitness × proximity
      "fitness_best": 7.15,
      "fitness_gain": 1.87,        // مقدار التحسن عن المرشح الأول
      "target_difficulty": 5.395,
      "delta_from_target": 0.31    // مدى القرب من الهدف
    },

    "behavioral_analysis": {
      "precision_moves": 6,
      "crumbling_moves": 4,
      "orientation_changes": 15,
      "critical_tile_count": 17,
      "behavioral_difficulty": 5.70,
      "puzzle_efficiency": 7.15    // معيار الانتخاب
    }
  }
}
```

---

## معادلة `puzzle_efficiency` (معيار الانتخاب)

```
puzzle_efficiency =
    (moves / static_tiles)              × 4.0   ← طول الحل / حجم اللوح
  + (1 / trap_count)                    × 2.0   ← قلة الأفخاخ
  + (critical_traps / total_traps)      × 2.5   ← كل فخ على المسار الحرج
  + (orientation_changes / moves)       × 1.5   ← تعقيد التنقل
```

**الفلسفة:** اللغز الممتاز هو الذي يجبر اللاعب على رحلة طويلة في مساحة صغيرة، بأفخاخ قليلة — لكن لا يمكن تجاوز أي منها.

---

## قيود `minBFSMoves` لكل مرحلة

يمنع BFS من اختصار الحل إلى عدد نقلات أقل من الحد الأدنى.

| المرحلة | slots | `minBFSMoves` | الهدف |
|---------|-------|--------------|-------|
| hard_start | 1–N | 12 | لا مراحل قصيرة جداً |
| precision | | 16 | حل يتطلب تخطيطاً |
| moving | | 22 | وقت لتوقيت moving tiles |
| islands | | 24 | مسافة كافية بين الجزر |
| abyss | | 30 | تحدي حقيقي |
