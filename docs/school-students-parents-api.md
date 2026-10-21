# Students & Parents APIs

Base URL: `http://localhost:8000/api`

إدارة طلاب المدرسة وأولياء الأمور، مع أكواد دخول من 5 أرقام وQR Code جاهز للحضور لاحقًا.

```http
Authorization: Bearer <school_admin_token>
Content-Type: application/json
```

---

## مفاهيم مهمة

| المفهوم | التفاصيل |
|---------|-----------|
| نطاق كود الدخول | طالب: فريد عالميًا (دخول بالكود فقط). ولي أمر: فريد داخل المدرسة مع `school_code` |
| كود المدرسة | `schools.login_code` (6 أحرف) يُستخدم مع كود الدخول في البوابة |
| كود الدخول | نص من 5 أرقام مع أصفار بادئة مثل `"05831"` |
| QR | قيمة عشوائية `qr_token` + payload: `EMS\|v1\|{schoolId}\|{qrToken}` |
| ولي الأمر المشترك | يُعاد استخدامه بنفس الهاتف داخل المدرسة أو عبر `parent.parent_id` |

---

## 1) الطلاب `/school/students`

### `GET /school/students`
Query: `search`, `grade_id`, `classroom_id`, `status`, `academic_year`, `limit`, `skip`

يرجع أيضًا `counts_by_classroom`.

### `GET /school/students/:id`
تفاصيل + أولياء الأمور + `qr_payload` + `school.login_code`

### `POST /school/students`
يدعم `multipart/form-data` (حقل `avatar` اختياري) أو JSON.

```json
{
  "name": "أحمد محمد",
  "academic_year": "2025/2026",
  "grade_id": 12,
  "classroom_id": 1,
  "birth_date": "2012-05-01",
  "gender": "male",
  "phone": "01000000001",
  "national_id": "30101010101011",
  "address": "القاهرة",
  "seat_number": "15",
  "status": "active",
  "parent": {
    "name": "محمد علي",
    "phone": "01000000099",
    "relation": "father",
    "email": "parent@example.com"
  }
}
```

ربط ولي أمر موجود:

```json
"parent": { "parent_id": 20, "relation": "father" }
```

**Response `201` يتضمن:**
- بيانات الطالب
- `access.student_login_code`
- `access.parent_login_code`
- `access.school_login_code`
- `access.parent_created` (هل تم إنشاء ولي أمر جديد)

### `PUT /school/students/:id`
تعديل بيانات شخصية (لا يغيّر كود الدخول ولا QR تلقائيًا).

### `POST /school/students/:id/transfer`
```json
{ "grade_id": 12, "classroom_id": 2, "academic_year": "2025/2026" }
```

### `PATCH /school/students/:id/status`
```json
{ "status": "suspended" }
```
قيم الحالة: `active` | `suspended` | `archived`

### `POST /school/students/:id/regenerate-login-code`
يبطل الكود السابق فورًا.

### `POST /school/students/:id/regenerate-qr`
يبطل QR السابق فورًا.

### `GET /school/students/:id/qr.png`
تنزيل صورة PNG للطباعة.

### `POST /school/students/verify-qr`
للتحضير لوحدة الحضور:
```json
{ "qr_payload": "EMS|v1|2|...." }
```

### `DELETE /school/students/:id`
أرشفة منطقية (`archived` + soft delete).

---

## 2) أولياء الأمور `/school/parents`

### `GET /school/parents`
### `GET /school/parents/:id` (+ قائمة الأبناء)
### `PUT /school/parents/:id`
### `POST /school/parents/:id/regenerate-login-code`
### `DELETE /school/parents/:id` (إن لم يكن مرتبطًا بطلاب نشطين)

---

## 3) تسجيل الدخول بالأكواد

### `POST /login/student` — تسجيل دخول الطالب بكوده فقط

كود الطالب فريد على مستوى النظام بالكامل — لا حاجة لكود المدرسة.

```json
{
  "login_code": "58317"
}
```

**Response (200):**

```json
{
  "user": {
    "id": 10,
    "name": "أحمد",
    "role": "student",
    "school_id": 2,
    "login_code": "58317"
  },
  "school": { "id": 2, "name": "مدرسة النور", "login_code": "A1B2C3" },
  "profile": {
    "status": "active",
    "academic_year": "2025/2026",
    "grade_id": 3,
    "grade_name": "الصف الأول",
    "classroom_id": 1,
    "classroom_name": "1/أ"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

استخدم `Authorization: Bearer <token>` في الطلبات التالية.

### `POST /login/code` — طالب أو ولي أمر

```json
{
  "school_code": "A1B2C3",
  "login_code": "58317",
  "role": "student"
}
```

أو `"role": "parent"`.

- حد محاولات الفشل: 20 / IP / مدرسة / 15 دقيقة → `429`
- الطالب يجب أن تكون حالته `active`
- أكواد خاطئة → `400 Invalid credentials`

---

## ملاحظات للفرونت

1. صفحة الطلاب: جدول + فلاتر صف/فصل + Modal إضافة متعدد الأقسام.
2. بعد الإنشاء اعرض بطاقة الأكواد + QR (`qr_payload` أو `/qr.png`).
3. عند اختيار صف → حمّل فصوله من `/school/classrooms?grade_id=`.
4. ابحث عن ولي أمر موجود قبل الإنشاء عبر قائمة `/school/parents?search=`.
5. لا تعتمد على الفرونت وحدها للعزل؛ كل الطلبات مربوطة بـ `school_id` من التوكن.
