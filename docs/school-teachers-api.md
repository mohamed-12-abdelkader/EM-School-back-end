# School Teachers APIs (إدارة المدرسين)

Base URL: `http://localhost:8000/api`

تمكّن **إدارة المدرسة** (`school_admin`) من إنشاء وإدارة مدرسي المدرسة فقط.

```http
Authorization: Bearer <school_admin_token>
Content-Type: application/json
```

---

## بيانات المدرس

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `name` | نعم | اسم المدرس |
| `email` | نعم | البريد (فريد على مستوى النظام) |
| `password` | نعم | كلمة المرور (6+ أحرف) |
| `confirm_password` | نعم | تأكيد كلمة المرور |
| `subject_id` | نعم | المادة من مواد المدرسة |

---

## Endpoints

### `GET /school/teachers`

قائمة المدرسين + بحث + pagination.

| Query | الوصف |
|-------|--------|
| `search` | اسم / إيميل / مادة |
| `subject_id` | فلترة بمادة |
| `is_active` | `true` / `false` |
| `limit`, `skip` | pagination |
| `include_deleted` | `false` افتراضي |

**Response:**

```json
{
  "teachers": [
    {
      "id": 5,
      "school_id": 2,
      "name": "أ. محمد",
      "email": "teacher@school.com",
      "is_active": true,
      "created_at": "2026-10-13T02:00:00.000Z",
      "deleted_at": null,
      "subject_id": 1,
      "subject_name": "رياضيات",
      "subject_code": "MATH"
    }
  ],
  "total": 1,
  "limit": 50,
  "skip": 0
}
```

---

### `GET /school/teachers/:id`

تفاصيل مدرس.

---

### `POST /school/teachers`

إنشاء مدرس + حساب دخول `teacher` مربوط بالمدرسة.

```json
{
  "name": "أ. محمد",
  "email": "teacher@school.com",
  "password": "secret12",
  "confirm_password": "secret12",
  "subject_id": 1
}
```

**Response `201`:** `teacher` object (بدون كلمة المرور).

---

### `PUT /school/teachers/:id`

```json
{
  "name": "أ. محمد علي",
  "email": "new@school.com",
  "subject_id": 2,
  "password": "newpass12",
  "confirm_password": "newpass12",
  "is_active": true
}
```

كلمة المرور اختيارية — اتركها فارغة إن لم تتغير.

---

### `DELETE /school/teachers/:id`

تعطيل المدرس (Soft Delete): `is_active = false` + `deleted_at`.

---

## تسجيل دخول المدرس

```http
POST /api/login
```

```json
{
  "email": "teacher@school.com",
  "password": "secret12"
}
```

**Response:** `role: "teacher"`, `school_id: <id>`

لا يمكن الدخول إذا المدرسة أو حساب المدرس معطّل.

---

## cURL

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"school@example.com","password":"secret12"}' | jq -r .token)

curl -X POST http://localhost:8000/api/school/teachers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Teacher One","email":"t1@school.com","password":"secret12","confirm_password":"secret12","subject_id":1}'
```
