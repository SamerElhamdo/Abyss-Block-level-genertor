---
name: "speckit-plan"
description: "خطة التنفيذ — من القالب إلى ملفات التصميم (plan، research، إلخ)."
argument-hint: "إرشادات اختيارية لمرحلة التخطيط"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/plan.md"
user-invocable: true
disable-model-invocation: false
---


> **المخرجات**: خطّط واكتب الملفات **بالعربية** (مباشرة). المسارات وأسماء الملفات تقنية = **إنجليزي** كالعادة.

## إدخال المستخدم

```text
$ARGUMENTS
```

راعِ مدخل المستخدم أعلاه إن وُجد؛ لا تتجاهله قبل ما تكمّل.

## قبل ما تبدأ

**التحقق من خطافات الامتداد (قبل التخطيط)**:
- تحقق من وجود `.specify/extensions.yml` في جذر المشروع.
- إن وُجد، اقرأه وابحث عن `hooks.before_plan`
- إن تعذّر تحليل YAML أو كان غير صالح، تخطَّ بصمت
- استبعد الخطافات ذات `enabled: false`. بلا `enabled` → مفعّل افتراضياً.
- لكل خطاف متبقٍ، **لا** تُقيم `condition`:
  - بلا `condition` أو فارغ → قابل للتنفيذ
  - `condition` غير فارغ → تخطَّ
- لكل خطاف قابل للتنفيذ، أخرج حسب `optional`:
  - **خطاف اختياري** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **خطاف إلزامي** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
- إن لا خطافات أو لا ملف، تخطَّ بصمت

## الخطوات

1. **الإعداد**: شغّل `.specify/scripts/bash/setup-plan.sh --json` من جذر المستودع وحلّل JSON للحقول FEATURE_SPEC، IMPL_PLAN، SPECS_DIR، BRANCH. للاقتباسات المفردة في الوسائط مثل "I'm Groot"، استخدم الهروب: مثل `'I'\''m Groot'` (أو اقتباس مزدوج إن أمكن: "I'm Groot").

2. **تحميل السياق**: اقرأ FEATURE_SPEC و`.specify/memory/constitution.md`. حمّل قالب IMPL_PLAN (منسوخ مسبقاً).

3. **نفّذ سير عمل الخطة**: اتبع هيكل قالب IMPL_PLAN لـ:
   - ملء السياق التقني (علّم المجهول بـ "NEEDS CLARIFICATION")
   - ملء قسم Constitution Check من الدستور
   - تقييم البوابات (خطأ إن كانت المخالفات غير مبررة)
   - المرحلة 0: توليد research.md (حل كل NEEDS CLARIFICATION)
   - المرحلة 1: توليد data-model.md، contracts/، quickstart.md
   - المرحلة 1: حدّث سياق الوكيل بتشغيل سكربت الوكيل
   - أعد تقييم Constitution Check بعد التصميم

4. **توقّف وأبلغ**: ينتهي الأمر بعد تخطيط المرحلة 2. أبلغ عن الفرع، مسار IMPL_PLAN، والمخرجات المولّدة.

5. **خطافات بعد التخطيط**: بعد الإبلاغ، تحقق من `.specify/extensions.yml` في جذر المشروع.
   - إن وُجد، اقرأ `hooks.after_plan`
   - YAML غير صالح → تخطَّ بصمت
   - استبعد `enabled: false`؛ بلا `enabled` → مفعّل
   - لا تُقيم `condition`؛ نفس قواعد ما قبل التنفيذ
   - لكل خطاف قابل للتنفيذ:
     - **اختياري** (`optional: true`):
       ```
       ## Extension Hooks

       **Optional Hook**: {extension}
       Command: `/{command}`
       Description: {description}

       Prompt: {prompt}
       To execute: `/{command}`
       ```
     - **إلزامي** (`optional: false`):
       ```
       ## Extension Hooks

       **Automatic Hook**: {extension}
       Executing: `/{command}`
       EXECUTE_COMMAND: {command}
       ```
   - لا خطافات → تخطَّ بصمت

## المراحل

### المرحلة 0: المخطط والبحث

1. **استخرج المجهوليات من السياق التقني**:
   - كل NEEDS CLARIFICATION → مهمة بحث
   - كل تبعية → مهمة أفضل الممارسات
   - كل تكامل → مهمة أنماط

2. **ولِّد وكلِّف وكلاء بحث**:

   ```text
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **ادمج النتائج** في `research.md` بالصيغة:
   - Decision / Rationale / Alternatives considered

**المخرج**: research.md بكل NEEDS CLARIFICATION محلولة

### المرحلة 1: التصميم والعقود

**متطلبات مسبقة:** اكتمال `research.md`

1. **استخرج الكيانات من مواصفة الميزة** → `data-model.md`
2. **عرّف عقود الواجهات** → `/contracts/` عند الحاجة
3. **تحديث سياق الوكيل**: حدّث المرجع بين `<!-- SPECKIT START -->` و`<!-- SPECKIT END -->` في `CLAUDE.md` ليشير إلى ملف الخطة من الخطوة 1

**المخرج**: data-model.md، /contracts/*، quickstart.md، ملف سياق الوكيل محدّث

## قواعد أساسية

- استخدم مسارات مطلقة لعمليات الملفات؛ مسارات نسبية للمشروع في الوثائق وملفات السياق
- خطأ عند فشل البوابات أو التوضيحات غير المحلولة
