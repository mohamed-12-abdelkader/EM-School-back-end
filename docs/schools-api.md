# Schools Management & Auth APIs

Base URL: `http://localhost:8000/api`

كل طلبات إدارة المدارس تتطلب:

```http
Authorization: Bearer <access_token>
```

| الدور | القيمة في `role` | الصلاحية |
|--------|-------------------|----------|
| Super Admin | `admin` | إنشاء / عرض / تعديل / حذف المدارس |
| School Admin | `school_admin` | تسجيل دخول لوحة المدرسة فقط (لا يصل لـ `/schools`) |

---

## 1. تسجيل الدخول (Admin & School)

نفس الـ endpoint لكلا الحسابين. الفرق في `role` و `school_id` في الاستجابة.

### `POST /login`

**Body (JSON):**

```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

> يمكن استخدام `phone` بدل `email` إن وُجد.

**نجاح — Super Admin (`200`):**

```json
{
  "user": {
    "id": 1,
    "name": "abdelrahman.mh3@gmail.com",
    "email": "abdelrahman.mh3@gmail.com",
    "phone": null,
    "role": "admin",
    "school_id": null
  },
  "token": "<jwt>"
}
```

**نجاح — School Admin (`200`):**

```json
{
  "user": {
    "id": 2,
    "name": "Test School Alpha",
    "email": "school.alpha@example.com",
    "phone": null,
    "role": "school_admin",
    "school_id": 1
  },
  "token": "<jwt>"
}
```

**أخطاء شائعة:**

| Status | الحالة |
|--------|--------|
| `400` | بيانات خاطئة (`Invalid credentials`) أو validation فشل |
| `403` | مدرسة غير مفعّلة / محذوفة منطقياً (`School account is inactive`) |

**ملاحظات:**
- استخدم `token` في Header: `Authorization: Bearer <token>`
- حساب `school_admin` مربوط بمدرسة عبر `school_id`
- إذا تم تعطيل/حذف المدرسة، لن يتمكن الـ school admin من الدخول

**مثال Admin:**

```bash
curl -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"abdelrahman.mh3@gmail.com\",\"password\":\"changethis\"}"
```

**مثال School:**

```bash
curl -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"school.alpha@example.com\",\"password\":\"secret12\"}"
```

---

## 2. إدارة المدارس (Super Admin فقط)

كل الـ endpoints التالية تتطلب `role = admin`.  
حساب `school_admin` يحصل على `403 Forbidden`.

---

### `GET /schools`

قائمة المدارس مع بحث و pagination.

**Query params:**

| Param | Default | الوصف |
|-------|---------|--------|
| `search` | `""` | بحث بالاسم أو الإيميل |
| `limit` | `10` | عدد النتائج (أقصى 100) |
| `skip` | `0` | تخطي نتائج للصفحات |
| `include_deleted` | `false` | إظهار المدارس المحذوفة منطقياً |

**مثال:**

```http
GET /api/schools?search=Alpha&limit=10&skip=0
Authorization: Bearer <admin_token>
```

**Response `200`:**

```json
{
  "schools": [
    {
      "id": 1,
      "name": "Test School Alpha",
      "logo": null,
      "description": "A sample school",
      "is_active": true,
      "created_at": "2026-10-11T23:16:42.873Z",
      "deleted_at": null,
      "admin_user_id": 2,
      "email": "school.alpha@example.com"
    }
  ],
  "total": 1,
  "limit": 10,
  "skip": 0
}
```

---

### `GET /schools/:id`

جلب مدرسة واحدة.

**Response `200`:**

```json
{
  "school": {
    "id": 1,
    "name": "Test School Alpha",
    "logo": null,
    "description": "A sample school",
    "is_active": true,
    "created_at": "2026-10-11T23:16:42.873Z",
    "deleted_at": null,
    "admin_user_id": 2,
    "email": "school.alpha@example.com"
  }
}
```

**أخطاء:** `404` إذا غير موجودة أو محذوفة.

---

### `POST /schools`

إنشاء مدرسة + حساب دخول `school_admin` في Transaction واحدة.

**Content-Type:** `multipart/form-data`  
(أو `application/x-www-form-urlencoded` بدون لوجو)

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `name` | نعم | اسم المدرسة |
| `email` | نعم | إيميل حساب إدارة المدرسة (فريد) |
| `password` | نعم | كلمة المرور (6 أحرف على الأقل) |
| `confirm_password` | نعم | تأكيد كلمة المرور |
| `description` | لا | وصف المدرسة |
| `logo` | لا | ملف صورة (image/* ، أقصى 5MB) |

**مثال:**

```bash
curl -X POST http://localhost:8000/api/schools \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=My School" \
  -F "description=School description" \
  -F "email=school@example.com" \
  -F "password=secret12" \
  -F "confirm_password=secret12" \
  -F "logo=@./logo.png"
```

**Response `201`:**

```json
{
  "message": "School created successfully",
  "school": {
    "id": 1,
    "name": "My School",
    "logo": "https://res.cloudinary.com/.../logo.png",
    "description": "School description",
    "is_active": true,
    "created_at": "2026-10-11T23:16:42.873Z",
    "deleted_at": null,
    "admin_user_id": 2,
    "email": "school@example.com"
  }
}
```

**أخطاء:**

| Status | السبب |
|--------|--------|
| `400` | Validation (حقول ناقصة / كلمات مرور غير متطابقة) |
| `401` | بدون توكن |
| `403` | ليس Super Admin |
| `409` | الإيميل مسجّل مسبقاً |

---

### `PUT /schools/:id`

تعديل بيانات المدرسة / حسابها.

**Content-Type:** `multipart/form-data`

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `name` | لا | اسم المدرسة |
| `email` | لا | إيميل حساب المدرسة |
| `description` | لا | الوصف |
| `logo` | لا | لوجو جديد |
| `password` | لا | كلمة مرور جديدة (اتركها فارغة إن لم تتغير) |
| `confirm_password` | مطلوب فقط إذا أرسلت `password` | تأكيد كلمة المرور |
| `is_active` | لا | `true` / `false` لتفعيل أو تعطيل المدرسة |

**Response `200`:**

```json
{
  "message": "School updated successfully",
  "school": { "...": "..." }
}
```

**أخطاء:** `404` مدرسة غير موجودة، `409` إيميل مكرر، `400` validation.

---

### `DELETE /schools/:id`

حذف منطقي (Soft Delete): يضبط `is_active = false` و `deleted_at = NOW()`.

لا يحذف الطلاب/المعلمين/البيانات المرتبطة.

**Response `200`:**

```json
{
  "message": "School deactivated successfully",
  "school": {
    "id": 1,
    "name": "My School"
  }
}
```

بعد الحذف:
- المدرسة تختفي من القائمة الافتراضية
- حساب `school_admin` لا يستطيع تسجيل الدخول

---

## 3. ملخص سريع للفرونت

1. Admin يسجّل دخول → يحفظ `token` و يتأكد أن `role === "admin"`.
2. صفحة إدارة المدارس تستدعي `GET /schools`.
3. إضافة مدرسة: `POST /schools` بـ `FormData` (مع `logo` اختياري).
4. تعديل: `PUT /schools/:id` (كلمة المرور اختيارية).
5. حذف: `DELETE /schools/:id` بعد تأكيد من المستخدم.
6. School login منفصل في واجهة المدرسة: نفس `POST /login` ثم التوجيه حسب `role === "school_admin"` و `school_id`.

---

## 4. رموز الحالة الشائعة

| Code | المعنى |
|------|--------|
| `200` | نجاح |
| `201` | تم الإنشاء |
| `400` | بيانات غير صحيحة |
| `401` | غير مصرح (توكن ناقص/غير صالح) |
| `403` | ممنوع (دور غير كافٍ أو مدرسة معطّلة) |
| `404` | غير موجود |
| `409` | تعارض (إيميل مكرر) |
| `500` | خطأ داخلي |
