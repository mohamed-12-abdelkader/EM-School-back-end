# Student Attendance APIs

Base URL: `http://localhost:8000/api/school/attendance`

صلاحيات: `school_admin` و `teacher` (التصدير والإلغاء لـ `school_admin` فقط).

جميع العمليات معزولة بـ `school_id` من التوكن — لا يُعتمد على `schoolId` من العميل.

---

## حالات الحضور

| Value | المعنى |
|-------|--------|
| `present` | حاضر |
| `absent` | غائب |
| `late` | متأخر |
| `excused` | غياب بعذر |

`NOT_RECORDED` = لا يوجد سجل (يظهر عبر `/unrecorded` والإحصائيات).

طرق التسجيل: `qr` | `manual`

التاريخ في QR يعتمد على **وقت الخادم** (`Africa/Cairo` ليوم التقويم).

---

## 1) تسجيل عبر QR

### `POST /check-in/qr`

```json
{ "qr_payload": "EMS|v1|2|...." }
```

أو `{ "qr_token": "..." }`

**سلوك:**
- يسجّل `present` لليوم الحالي بوقت الخادم.
- إعادة المسح لنفس الطالب الحاضر → `200` + `already_recorded: true` (بدون تكرار).
- كود غير صالح / مدرسة أخرى → خطأ واضح.

---

## 2) تسجيل يدوي

### `POST /manual`

```json
{
  "student_id": 10,
  "date": "2026-10-13",
  "status": "absent",
  "absence_reason": "مرض",
  "notes": "اتصال بولي الأمر",
  "edit_reason": "تصحيح بعد مراجعة"
}
```

`date` اختياري (افتراضي اليوم). يعيد الكتابة على نفس اليوم إن وُجد سجل.

### `POST /bulk`

```json
{
  "date": "2026-10-13",
  "classroom_id": 1,
  "items": [
    { "student_id": 10, "status": "present" },
    { "student_id": 11, "status": "absent", "absence_reason": "بدون عذر" }
  ]
}
```

يرجع `207` عند نجاح جزئي مع `results[]` لكل طالب.

---

## 3) الاستعلام

### `GET /`
Query: `date`, `date_from`, `date_to`, `grade_id`, `classroom_id`, `student_id`, `status`, `limit`, `skip`

### `GET /:id`

### `GET /unrecorded?date=&grade_id=&classroom_id=`
الطلاب النشطون بدون سجل في ذلك اليوم.

### `GET /summary/daily?date=&grade_id=&classroom_id=`

```json
{
  "summary": {
    "total_students": 30,
    "present": 20,
    "absent": 4,
    "late": 2,
    "excused": 1,
    "not_recorded": 3,
    "recorded": 27,
    "attendance_rate": 81.48,
    "attendance_rate_basis": "recorded_students_only"
  }
}
```

نسبة الحضور = `(present + late) / recorded` — **لا** تُحسب الحالات غير المسجلة كغياب.

### `GET /summary/student/:studentId?date_from=&date_to=`

### `GET /frequent-absences?date_from=&date_to=&min_absences=3`

---

## 4) التعديل والإلغاء

### `PUT /:id`

```json
{
  "status": "excused",
  "absence_reason": "ظرف عائلي",
  "excuse_approved": true,
  "edit_reason": "اعتماد العذر من الإدارة"
}
```

`edit_reason` إلزامي. يُسجَّل في `attendance_audit_logs`.

### `DELETE /:id` (`school_admin`)
إلغاء منطقي (`cancelled_at`) وليس حذفًا نهائيًا.

```json
{ "reason": "سجل بالخطأ" }
```

---

## 5) التصدير

### `GET /export.csv?date_from=&date_to=&classroom_id=`
CSV بترميز UTF-8 — `school_admin` فقط.

---

## قيود قاعدة البيانات

- Unique: `(school_id, student_id, attendance_date)` للسجلات غير الملغاة.
- Indexes على المدرسة/التاريخ/الحالة/الطالب.
- التعامل مع السباق المتزامن عبر `FOR UPDATE` + إعادة المحاولة عند `23505`.

## أمثلة cURL

```bash
# QR check-in
curl -X POST http://localhost:8000/api/school/attendance/check-in/qr \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"qr_payload":"EMS|v1|2|TOKEN"}'

# Classroom day list
curl "http://localhost:8000/api/school/attendance?date=2026-10-13&classroom_id=1" \
  -H "Authorization: Bearer $TOKEN"
```
