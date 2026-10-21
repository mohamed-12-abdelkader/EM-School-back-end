# Student Fees, Installments & Payments APIs

Base URL: `http://localhost:8000/api/school/fees`

**صلاحيات الكتابة والتحصيل والتقارير:** `school_admin` فقط  
**عرض حساب طالب:** `school_admin` و `teacher`  
**كشف حساب ولي أمر / طالب:** `parent` / `student` عبر `GET /my-account`

جميع العمليات معزولة بـ `school_id` من التوكن. المبالغ `NUMERIC(12,2)` بالجنيه (أو عملة الحساب). المدفوعات لا تُحذف — يُستخدم العكس أو الاسترداد.

---

## 1) تصنيفات المصروفات

### `GET /categories`
### `POST /categories`

```json
{ "name": "رسوم دراسية", "description": "مصروفات أساسية" }
```

---

## 2) تعريفات المصروفات (Fee Structures)

### `GET /structures?academic_year=2025/2026&is_active=true&limit=50&skip=0`
### `POST /structures`

```json
{
  "category_id": 1,
  "name": "المصروفات الدراسية",
  "amount": 15000,
  "academic_year": "2025/2026",
  "grade_id": 3,
  "is_mandatory": true,
  "due_date": "2025-09-01",
  "assignment_scope": "grade"
}
```

`assignment_scope`: `school` | `grade` | `students`

### `PATCH /structures/:id` — تعديل / تفعيل / إيقاف
### `DELETE /structures/:id` — soft delete

---

## 3) تخصيص المصروفات للطلاب

### `POST /assign` — من تعريف موجود

```json
{ "fee_structure_id": 1, "student_ids": [10, 11] }
```

بدون `student_ids`: يطبّق حسب `assignment_scope` (صف أو كل المدرسة للسنة).

### `POST /assign-direct` — بند مباشر لطالب

```json
{
  "student_id": 10,
  "academic_year": "2025/2026",
  "name": "رسوم باص",
  "amount": 3000,
  "due_date": "2025-10-01",
  "is_mandatory": false
}
```

ينشئ/يحدّث حساب الطالب المالي تلقائيًا.

---

## 4) خطط الأقساط

### `POST /installment-plans`

تقسيم متساوٍ:

```json
{
  "student_id": 10,
  "academic_year": "2025/2026",
  "total_amount": 15000,
  "count": 3,
  "first_due_date": "2025-09-01",
  "interval_days": 30
}
```

قيم يدوية (متفاوتة):

```json
{
  "student_id": 10,
  "academic_year": "2025/2026",
  "amounts": [5000, 5000, 5000],
  "first_due_date": "2025-09-01",
  "due_dates": ["2025-09-01", "2025-10-01", "2025-11-01"]
}
```

### `PATCH /installments/:id/due-date` — `{ "due_date": "2025-10-15" }`
### `POST /installments/:id/cancel` — `{ "reason": "انسحاب" }` (فقط إن لم يُدفع شيء)

حالات القسط تُحسب تلقائيًا: `pending` | `partial` | `paid` | `overdue` | `cancelled`

---

## 5) المدفوعات

### `POST /payments`

```json
{
  "student_id": 10,
  "academic_year": "2025/2026",
  "amount": 5000,
  "method": "cash",
  "reference": null,
  "notes": "دفعة أول قسط",
  "installment_ids": [1, 2],
  "idempotency_key": "pay-10-20250901-a1"
}
```

- `method`: `cash` | `bank_transfer` | `card` | `online` | `other`
- بدون `installment_ids`: توزيع على أقدم الأقساط المستحقة ثم بنود المصروف
- `idempotency_key` يمنع التكرار (نفس المفتاح يعيد نفس الإيصال)
- يُنشأ `receipt_number` فريد لكل مدرسة

### `GET /payments?student_id=&method=&from=&to=&recorded_by=&limit=&skip=`
### `GET /payments/:id` — مع التوزيعات
### `POST /payments/:id/reverse` — `{ "reason": "تسجيل خاطئ" }` (لا حذف)

---

## 6) الخصومات والاسترداد

### `POST /discounts`

```json
{
  "student_id": 10,
  "academic_year": "2025/2026",
  "fee_item_id": 5,
  "name": "خصم إخوة",
  "discount_type": "percent",
  "value": 10,
  "reason": "أخوان في المدرسة"
}
```

`discount_type`: `fixed` | `percent` — لا يتجاوز المتبقي على البند.

### `POST /refunds`

```json
{
  "student_id": 10,
  "academic_year": "2025/2026",
  "payment_id": 3,
  "amount": 500,
  "reason": "استرداد جزئي"
}
```

لا يتجاوز المبلغ القابل للاسترداد (`paid − refunded`).

---

## 7) الحساب المالي

### `GET /accounts/:studentId?academic_year=2025/2026`

يرجع: `account`, `items`, `installments`, `payments`, `discounts`  
الأرصدة تُحدَّث من السجلات الفعلية قبل الإرجاع.

### `GET /my-account?academic_year=2025/2026&student_id=` (parent يحتاج `student_id`)

---

## 8) التقارير

| Endpoint | الوصف |
|----------|--------|
| `GET /reports/summary` | إجمالي مستحقات / محصل / متبقي / متأخرات |
| `GET /reports/overdue` | أقساط متأخرة (+ فلتر صف/فصل/سنة) |
| `GET /reports/collections-by-grade` | تحصيل حسب الصف |
| `GET /reports/collections-by-method` | تحصيل حسب طريقة الدفع |
| `GET /reports/collections-by-collector` | تحصيل حسب الموظف |
| `GET /reports/upcoming-installments` | أقساط قادمة (`from`/`to`) |
| `GET /reports/discounts` | الخصومات |
| `GET /reports/refunds` | الاستردادات |
| `GET /audit-logs` | سجل التدقيق المالي (قراءة فقط) |

دعم `limit` / `skip` حيث ينطبق.

---

## ضوابط مالية

- مبلغ الدفع > 0؛ لا حذف للمدفوعات
- Transactions عند الدفع / الخصم / الاسترداد / العكس
- Idempotency عبر `idempotency_key`
- عزل متعدد المدارس على كل استعلام
- لا Payment Gateway — تسجيل نقدي/تحويل يدوي فقط
