# School Grades APIs (الصفوف الدراسية)

Base URL: `http://localhost:8000/api`

هذه الـ APIs خاصة بحساب **إدارة المدرسة** (`school_admin`) فقط، وتعزل بيانات كل مدرسة عبر `school_id`.

```http
Authorization: Bearer <school_admin_token>
Content-Type: application/json
```

| الدور | الوصول |
|--------|---------|
| `school_admin` | تحكم كامل في صفوف مدرسته فقط |
| `admin` / غيره | `403 Forbidden` |

---

## تسجيل الدخول أولاً

```http
POST /api/login
```

```json
{
  "email": "school@example.com",
  "password": "secret12"
}
```

تأكد أن الاستجابة تحتوي:

```json
{
  "user": { "role": "school_admin", "school_id": 1 },
  "token": "..."
}
```

---

## Endpoints

### `GET /school/grades`

قائمة صفوف المدرسة مع بحث و pagination.

**Query params:**

| Param | Default | الوصف |
|-------|---------|--------|
| `search` | `""` | بحث بالاسم أو الوصف |
| `limit` | `50` | عدد النتائج (أقصى 200) |
| `skip` | `0` | تخطي للصفحات |
| `is_active` | - | `true` أو `false` للفلترة |
| `include_deleted` | `false` | إظهار المحذوف منطقياً |

**Response `200`:**

```json
{
  "grades": [
    {
      "id": 11,
      "school_id": 1,
      "name": "أولى ثانوي",
      "description": "الصف الأول الثانوي",
      "is_active": true,
      "position": 0,
      "created_at": "2026-10-12T03:00:00.000Z",
      "deleted_at": null
    }
  ],
  "total": 1,
  "limit": 50,
  "skip": 0
}
```

---

### `GET /school/grades/:id`

جلب صف واحد تابع للمدرسة الحالية.

**أخطاء:** `404` إذا غير موجود أو يتبع مدرسة أخرى.

---

### `POST /school/grades`

إنشاء صف دراسي جديد للمدرسة.

**Body:**

```json
{
  "name": "أولى ثانوي",
  "description": "اختياري",
  "position": 0,
  "is_active": true
}
```

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `name` | نعم | اسم الصف (فريد داخل المدرسة) |
| `description` | لا | وصف |
| `position` | لا | ترتيب العرض (تلقائي إذا لم يُرسل) |
| `is_active` | لا | افتراضي `true` |

**Response `201`:**

```json
{
  "message": "Grade created successfully",
  "grade": { "...": "..." }
}
```

**أخطاء:** `409` اسم مكرر داخل نفس المدرسة.

---

### `PUT /school/grades/:id`

تعديل صف دراسي.

**Body (أي حقل اختياري، مطلوب حقل واحد على الأقل):**

```json
{
  "name": "ثانية ثانوي",
  "description": "تم التحديث",
  "position": 1,
  "is_active": false
}
```

---

### `PATCH /school/grades/reorder`

إعادة ترتيب عدة صفوف دفعة واحدة.

```json
{
  "items": [
    { "id": 11, "position": 0 },
    { "id": 12, "position": 1 },
    { "id": 13, "position": 2 }
  ]
}
```

---

### `DELETE /school/grades/:id`

حذف منطقي (Soft Delete): `is_active = false` + `deleted_at = NOW()`.

```http
DELETE /api/school/grades/11
```

**حذف نهائي (اختياري):**

```http
DELETE /api/school/grades/11?hard=true
```

- يُرفض بـ `409` إذا كان الصف مرتبطاً بطلاب/معلمين عبر `user_grades`.
- لا يؤثر على صفوف مدارس أخرى.

---

## العزل (Multi-Tenancy)

- كل صف يُحفظ مع `school_id` الخاص بحساب المدرسة من التوكن.
- لا يمكن قراءة/تعديل/حذف صف لمدرسة أخرى حتى لو عرفت الـ `id`.
- الصفوف العامة القديمة في النظام (`school_id = null`) لا تظهر هنا ولا تُدار من واجهة المدرسة.

---

## أمثلة cURL

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"school@example.com","password":"secret12"}' | jq -r .token)

# Create
curl -X POST http://localhost:8000/api/school/grades \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"أولى إعدادي","description":"الصف الأول الإعدادي"}'

# List
curl http://localhost:8000/api/school/grades \
  -H "Authorization: Bearer $TOKEN"

# Update
curl -X PUT http://localhost:8000/api/school/grades/11 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_active":false}'

# Delete
curl -X DELETE http://localhost:8000/api/school/grades/11 \
  -H "Authorization: Bearer $TOKEN"
```
