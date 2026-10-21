# School Classrooms APIs (الفصول الدراسية)

Base URL: `http://localhost:8000/api`

إدارة **الفصول** داخل **الصفوف الدراسية**.  
مثال: الصف `أولى إعدادي` يحتوي على فصول `1/1` و `1/2` و `1/3`.

متاحة فقط لـ `school_admin`، ومعزولة بـ `school_id`.

```http
Authorization: Bearer <school_admin_token>
Content-Type: application/json
```

---

## المفاهيم

| المصطلح | الجدول | مثال |
|---------|--------|------|
| الصف الدراسي | `grades` | أولى إعدادي |
| الفصل | `classrooms` | 1/1 |

كل فصل يجب أن يتبع صفًا دراسيًا تابعًا لنفس المدرسة.

---

## Endpoints

### `GET /school/classrooms`

قائمة الفصول مع فلترة اختيارية بالصف.

**Query params:**

| Param | Default | الوصف |
|-------|---------|--------|
| `grade_id` | - | فلترة بصف دراسي معيّن |
| `search` | `""` | بحث باسم الفصل أو الوصف أو اسم الصف |
| `limit` | `50` | عدد النتائج |
| `skip` | `0` | pagination |
| `is_active` | - | `true` / `false` |
| `include_deleted` | `false` | إظهار المحذوف منطقياً |

**مثال:** عرض فصول أولى إعدادي فقط

```http
GET /api/school/classrooms?grade_id=11
```

**Response `200`:**

```json
{
  "classrooms": [
    {
      "id": 1,
      "school_id": 2,
      "grade_id": 11,
      "grade_name": "أولى إعدادي",
      "name": "1/1",
      "description": "فصل أ",
      "capacity": 30,
      "is_active": true,
      "position": 0,
      "created_at": "2026-10-12T03:40:00.000Z",
      "deleted_at": null
    }
  ],
  "total": 1,
  "limit": 50,
  "skip": 0
}
```

---

### `GET /school/classrooms/:id`

جلب فصل واحد.

---

### `POST /school/classrooms`

إنشاء فصل داخل صف دراسي.

```json
{
  "grade_id": 11,
  "name": "1/1",
  "description": "الفصل الأول",
  "capacity": 30,
  "position": 0,
  "is_active": true
}
```

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `grade_id` | نعم | يجب أن يكون صفًا تابعًا لمدرستك |
| `name` | نعم | اسم الفصل (فريد داخل نفس الصف) مثل `1/1` |
| `description` | لا | وصف |
| `capacity` | لا | السعة القصوى |
| `position` | لا | ترتيب العرض |
| `is_active` | لا | افتراضي `true` |

**أخطاء:**
- `404` الصف غير موجود في مدرستك
- `409` اسم الفصل مكرر داخل نفس الصف

---

### `PUT /school/classrooms/:id`

تعديل فصل (يمكن نقل الفصل لصف آخر عبر `grade_id`).

```json
{
  "name": "1/2",
  "capacity": 35,
  "is_active": true
}
```

لإفراغ السعة أرسل `"capacity": null`.

---

### `PATCH /school/classrooms/reorder`

إعادة ترتيب فصول:

```json
{
  "items": [
    { "id": 1, "position": 0 },
    { "id": 2, "position": 1 }
  ]
}
```

---

### `DELETE /school/classrooms/:id`

حذف منطقي (Soft Delete).

```http
DELETE /api/school/classrooms/1
```

حذف نهائي:

```http
DELETE /api/school/classrooms/1?hard=true
```

---

## أمثلة cURL

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"school@example.com","password":"secret12"}' | jq -r .token)

# إنشاء فصل 1/1 داخل صف id=11
curl -X POST http://localhost:8000/api/school/classrooms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"grade_id":11,"name":"1/1","capacity":30}'

# فصول صف معيّن
curl "http://localhost:8000/api/school/classrooms?grade_id=11" \
  -H "Authorization: Bearer $TOKEN"

# تعديل
curl -X PUT http://localhost:8000/api/school/classrooms/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"1/1 أ","capacity":32}'

# حذف
curl -X DELETE http://localhost:8000/api/school/classrooms/1 \
  -H "Authorization: Bearer $TOKEN"
```
