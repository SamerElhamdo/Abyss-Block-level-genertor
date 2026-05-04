---
name: "speckit-constitution"
description: "دستور المشروع — إنشاء أو تحديث، ومزامنة القوالب المرتبطة."
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/constitution.md"
---


> **المخرجات**: الدستور والملخص **بالعربية**. الـ placeholders مثل `[PROJECT_NAME]` **ما تتغيّر**.

## إدخال المستخدم

```text
$ARGUMENTS
```

راعِ مدخل المستخدم أعلاه إن وُجد؛ لا تتجاهله قبل ما تكمّل.

## قبل ما تبدأ

**خطافات الامتداد (قبل تحديث الدستور)**:
- `.specify/extensions.yml` و`hooks.before_constitution`
- YAML صالح؛ `enabled`؛ لا تقييم `condition`؛ قوالب الخطاف مع `EXECUTE_COMMAND: {command}`

## الخطوات

أنت تحدّث دستور المشروع في `.specify/memory/constitution.md`. الملف قالب يحتوي رموزاً نائبة بين أقواس مثل `[PROJECT_NAME]`. مهمتك: (أ) جمع/اشتقاق القيم، (ب) ملء القالب بدقة، (ج) نشر التعديلات على المخرجات التابعة.

**ملاحظة**: إن لم يوجد الملف، يفترض أنه أُنشئ من `.specify/templates/constitution-template.md`. إن كان مفقوداً انسخ القالب أولاً.

1. حمّل الدستور الحالي وحدّد كل رمز نائب `[ALL_CAPS_IDENTIFIER]`. **مهم**: قد يطلب المستخدم عدداً مختلفاً من المبادئ — التزم بعدد المستخدم إن حُدّد.

2. اجمع القيم: من المحادثة أو من README والسياق. التواريخ: `RATIFICATION_DATE`، `LAST_AMENDED_DATE`، `CONSTITUTION_VERSION` حسب semver (MAJOR/MINOR/PATCH) كما في النسخة الإنجليزية.

3. صيغ المحتوى المحدّث: استبدل النوافذ النائبة؛ حافظ على تسلسل العناوين؛ كل مبدأ: اسم موجز، قواعد، مسوّغ عند الحاجة؛ قسم الحوكمة: إجراء التعديل، السياسة، المراجعة.

4. **مزامنة**: راجع `.specify/templates/plan-template.md`، `spec-template.md`، `tasks-template.md`، أوامر `.specify/templates/commands/*.md`، و`README.md`/`docs/quickstart.md` عند الحاجة.

5. **تقرير أثر المزامنة** (تعليق HTML أعلى الملف بعد التحديث): الإصدار القديم→الجديد، المبادئ المعدّلة، الأقسام المضافة/المحذوفة، القوالب المحدّثة/المعلّقة، TODO للنوافئ المؤجلة.

6. **تحقق**: لا أقواس نائبة غير مبررة؛ التواريخ ISO؛ مبادئ صريحة قابلة للاختبار.

7. اكتب الدستور إلى `.specify/memory/constitution.md`.

8. **ملخص للمستخدم**: الإصدار، الملفات للمتابعة اليدوية، رسالة commit مقترحة.

**التنسيق**: عناوين Markdown كالقالب؛ أسطر طويلة مقروءة؛ سطر فارغ بين الأقسام.

**معلومات ناقصة**: `TODO(<FIELD_NAME>): شرح` واذكرها في التقرير.

لا تنشئ قالباً جديداً — اعمل دائماً على `.specify/memory/constitution.md`.

## بعد الانتهاء

**خطافات الامتداد (بعد الدستور)**:
- `hooks.after_constitution` مع نفس قوالب Extension Hooks الاختياري/الإلزامي
