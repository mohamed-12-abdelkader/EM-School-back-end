# School Timetables APIs (الجداول الدراسية الأسبوعية)

Base URL: `http://localhost:8000/api`

إدارة الجداول الأسبوعية لكل فصل داخل المدرسة، مع كشف التعارضات والنشر والنسخ.

```http
Authorization: Bearer <school_admin_token>
Content-Type: application/json
```

**أيام الأسبوع:** `0=الأحد` … `6=السبت`

**حالة الجدول:** `draft` | `published`  
أي تعديل على الحصص بعد النشر يعيد الحالة إلى `draft` حتى إعادة النشر.

---

## 1) إعدادات الجدول

### `GET /school/timetables/settings`
### `PUT /school/timetables/settings`

```json
{
  "working_days": [0, 1, 2, 3, 4],
  "periods_per_day": 7,
  "default_period_minutes": 45,
  "day_start_time": "08:00",
  "day_end_time": "14:00",
  "allow_teacher_conflicts": false
}
```

### `PUT /school/timetables/period-templates`

استبدال قوالب الحصص/الأوقات الافتراضية للمدرسة:

```json
{
  "periods": [
    { "period_number": 1, "start_time": "08:00", "end_time": "08:45", "label": "الأولى" },
    { "period_number": 2, "start_time": "08:50", "end_time": "09:35", "label": "الثانية" },
    { "period_number": 3, "start_time": "09:40", "end_time": "10:00", "label": "راحة", "slot_type": "break" }
  ]
}
```

`day_of_week: null` أو حذفه = ينطبق على كل الأيام. يمكن تخصيص يوم معيّن بإرسال `day_of_week`.

---

## 2) مساعدات الاختيار (للواجهة)

### `GET /school/timetables/subjects-for-classroom/:classroomId`
مواد الصف المرتبط بالفصل فقط.

### `GET /school/timetables/teachers-for-subject/:subjectId`
المدرسون المعيّنون لهذه المادة داخل المدرسة فقط.

---

## 3) إدارة الجداول

### `GET /school/timetables`
Query: `classroom_id`, `grade_id`, `academic_year`, `term`, `status`, `limit`, `skip`

### `GET /school/timetables/:id`
يرجع الجدول + كل الحصص + الإعدادات.

### `POST /school/timetables`

```json
{
  "classroom_id": 1,
  "academic_year": "2025/2026",
  "term": "1",
  "title": "جدول 1/1",
  "slots": [
    {
      "day_of_week": 0,
      "period_number": 1,
      "start_time": "08:00",
      "end_time": "08:45",
      "slot_type": "lesson",
      "subject_id": 1,
      "teacher_id": 5
    }
  ]
}
```

### `PUT /school/timetables/:id`
تعديل العنوان / العام / الترم.

### `DELETE /school/timetables/:id`
حذف منطقي. `?hard=true` للحذف النهائي.

---

## 4) الحصص (Slots)

| Method | Path | الوظيفة |
|--------|------|---------|
| `PUT` | `/school/timetables/:id/slots` | استبدال كل الحصص دفعة واحدة |
| `POST` | `/school/timetables/:id/slots` | إضافة/تحديث خانة (يوم+رقم حصة) |
| `PUT` | `/school/timetables/:id/slots/:slotId` | تعديل حصة |
| `DELETE` | `/school/timetables/:id/slots/:slotId` | حذف حصة |

**أنواع الحصة `slot_type`:**
- `lesson` — تتطلب `subject_id` + `teacher_id`
- `break` — فترة راحة
- `activity` — نشاط
- `reserve` — احتياطي

---

## 5) التحقق / النشر / النسخ

### `POST /school/timetables/:id/validate`
يفحص التعارضات دون حفظ.

### `POST /school/timetables/:id/publish`
ينشر بعد اجتياز التحقق.  
`{ "force": true }` يتجاوز التعارضات فقط إذا كانت إعدادات المدرسة تسمح (ما زال يعيد conflicts إن وُجدت إلا مع force).

### `POST /school/timetables/:id/unpublish`
إعادة الجدول لمسودة.

### `POST /school/timetables/:id/copy`

```json
{
  "target_classroom_id": 2,
  "academic_year": "2025/2026",
  "term": "1",
  "replace_existing": false
}
```

يعيد فحص توافق المواد/المدرسين مع الصف المستهدف + تعارضات المدرسين.

---

## 6) تعارضات يتم كشفها تلقائيًا

| Code | المعنى |
|------|--------|
| `DUPLICATE_CELL` | نفس اليوم ونفس رقم الحصة مرتين |
| `OVERLAPPING_TIMES` | تداخل أوقات داخل نفس اليوم/الفصل |
| `TEACHER_BUSY` | المدرس مشغول في فصل آخر بنفس الوقت |
| `SUBJECT_NOT_IN_GRADE` | المادة غير مربوطة بصف الفصل |
| `TEACHER_SUBJECT_MISMATCH` | المدرس غير معيّن لهذه المادة |
| `INVALID_LESSON_FIELDS` | حصة درس بدون مادة/مدرس |
| `INVALID_TIME_RANGE` | وقت النهاية ≤ البداية |

استجابة التعارض: **HTTP 409** مع مصفوفة `conflicts`.

---

## 7) عرض جدول المدرس

```http
GET /api/teacher/timetable?academic_year=2025/2026&term=1
Authorization: Bearer <teacher_token>
```

يعرض فقط الحصص **المنشورة** الخاصة بالمدرس داخل مدرسته.

---

## ملاحظات للفرونت

1. ابنِ Grid: صفوف = رقم الحصة، أعمدة = `working_days`.
2. عند الضغط على خانة: افتح Modal → `subjects-for-classroom` ثم `teachers-for-subject`.
3. احفظ بـ `PUT /:id/slots` أو `POST /:id/slots` لخانة واحدة.
4. قبل النشر استدعِ `validate` ثم `publish`.
5. إذا `status` رجع إلى `draft` بعد تعديل جدول منشور، أظهر شارة «تغييرات غير منشورة».
