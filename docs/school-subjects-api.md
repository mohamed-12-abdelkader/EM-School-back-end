# School Subjects APIs (المواد الدراسية)

Base URL: `http://localhost:8000/api`

إدارة المواد الدراسية الخاصة بالمدرسة، مع إمكانية ربط المادة بصف أو أكثر.

متاحة فقط لـ `school_admin`، ومعزولة بـ `school_id`.

```http
Authorization: Bearer <school_admin_token>
Content-Type: application/json
```

---

## Endpoints

### `GET /school/subjects`

قائمة المواد مع بحث وفلترة.

| Param | Default | الوصف |
|-------|---------|--------|
| `search` | `""` | بحث بالاسم / الكود / الوصف |
| `grade_id` | - | مواد مربوطة بصف معيّن |
| `is_active` | - | `true` / `false` |
| `limit` | `50` | عدد النتائج |
| `skip` | `0` | pagination |
| `include_deleted` | `false` | إظهار المحذوف منطقياً |

**Response `200`:**

```json
{
  "subjects": [
    {
      "id": 1,
      "school_id": 2,
      "name": "رياضيات",
      "code": "MATH",
      "description": "مادة الرياضيات",
      "is_active": true,
      "position": 0,
      "created_at": "2026-10-13T01:00:00.000Z",
      "deleted_at": null,
      "grades": [
        { "id": 11, "name": "أولى إعدادي" },
        { "id": 12, "name": "ثانية إعدادي" }
      ]
    }
  ],
  "total": 1,
  "limit": 50,
  "skip": 0
}
```

---

### `GET /school/subjects/:id`

جلب مادة واحدة.

---

### `POST /school/subjects`

إنشاء مادة دراسية.

```json
{
  "name": "رياضيات",
  "code": "MATH",
  "description": "مادة الرياضيات",
  "grade_ids": [11, 12],
  "position": 0,
  "is_active": true
}
```

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `name` | نعم | اسم المادة (فريد داخل المدرسة) |
| `code` | لا | كود مختصر (فريد إن وُجد) |
| `description` | لا | وصف |
| `grade_ids` | لا | صفوف تُدرَّس فيها المادة |
| `position` | لا | ترتيب العرض |
| `is_active` | لا | افتراضي `true` |

**أخطاء:** `409` اسم/كود مكرر، `404` صف غير موجود في المدرسة.

---

### `PUT /school/subjects/:id`

تعديل مادة.  
إذا أرسلت `grade_ids` يتم استبدال الربط بالكامل.

```json
{
  "name": "رياضيات متقدمة",
  "grade_ids": [11],
  "is_active": true
}
```

لمسح الكود: `"code": null` أو `"code": ""`.  
لمسح كل الصفوف المرتبطة: `"grade_ids": []`.

---

### `PATCH /school/subjects/reorder`

```json
{
  "items": [
    { "id": 1, "position": 0 },
    { "id": 2, "position": 1 }
  ]
}
```

---

### `DELETE /school/subjects/:id`

حذف منطقي:

```http
DELETE /api/school/subjects/1
```

حذف نهائي:

```http
DELETE /api/school/subjects/1?hard=true
```

---

## أمثلة cURL

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"school@example.com","password":"secret12"}' | jq -r .token)

curl -X POST http://localhost:8000/api/school/subjects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"رياضيات","code":"MATH","grade_ids":[11,12]}'

curl "http://localhost:8000/api/school/subjects?grade_id=11" \
  -H "Authorization: Bearer $TOKEN"
```
