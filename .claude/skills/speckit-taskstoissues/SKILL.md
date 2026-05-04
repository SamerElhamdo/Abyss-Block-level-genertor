---
name: "speckit-taskstoissues"
description: "من tasks.md إلى issues على GitHub — حسب التبعيات والسياق."
argument-hint: "مرشح اختياري أو تسمية لقضايا GitHub"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/taskstoissues.md"
user-invocable: true
disable-model-invocation: false
---


> **المخرجات**: تواصل مع المستخدم **بالعربية**. نص الـ issues حسب سياسة الفريق (عربي/إنجليزي).

## إدخال المستخدم

```text
$ARGUMENTS
```

راعِ مدخل المستخدم أعلاه إن وُجد؛ لا تتجاهله قبل ما تكمّل.

## قبل ما تبدأ

**خطافات الامتداد (قبل تحويل المهام إلى قضايا)**:
- `.specify/extensions.yml` و`hooks.before_taskstoissues`
- نفس قواعد YAML و`enabled` و`condition` وقوالب الخطاف (`EXECUTE_COMMAND: {command}` عند الإلزامي)

## الخطوات

1. شغّل `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` من الجذر وحلّل FEATURE_DIR وAVAILABLE_DOCS. مسارات مطلقة. هروب الاقتباس المفرد كالمعتاد.
2. من مخرجات السكربت استخرج مسار **tasks**.
3. احصل على بعيد Git:

```bash
git config --get remote.origin.url
```

> [!CAUTION]
> تابع الخطوات التالية **فقط** إذا كان البعيد عنوان URL لـ GitHub

4. لكل مهمة في القائمة، استخدم خادم GitHub MCP لإنشاء قضية جديدة في المستودع المطابق لعنوان البعيد.

> [!CAUTION]
> **ممنوع** إنشاء قضايا في مستودعات لا تطابق عنوان البعيد

## بعد الانتهاء

**خطافات الامتداد (بعد التحويل)**:
- `hooks.after_taskstoissues` بنفس نمط الخطافات الاختياري/الإلزامي
