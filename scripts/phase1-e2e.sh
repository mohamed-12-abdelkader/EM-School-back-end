#!/usr/bin/env bash
# Phase 1 end-to-end smoke: login → bootstrap demo-school → apply → accept → enroll → attendance → parent
set -euo pipefail
API="${API:-http://localhost:8000/api/v1}"

json() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }

echo "== health =="
curl -sf "$API/health" | json "console.log(d.ok, d.phase)"

echo "== super admin login =="
LOGIN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@emschool.local","password":"admin123456"}')
TOKEN=$(echo "$LOGIN" | json "console.log(d.accessToken)")
echo "token ok"

echo "== ensure demo-school tenant =="
TENANTS=$(curl -sf "$API/tenants" -H "Authorization: Bearer $TOKEN")
TID=$(echo "$TENANTS" | json "const t=(d.find(x=>x.slug==='demo-school')||{}); console.log(t.id||'')")
if [ -z "$TID" ]; then
  CREATED=$(curl -sf -X POST "$API/tenants" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"Demo K12 School","slug":"demo-school","quota_max_students":500}')
  TID=$(echo "$CREATED" | json "console.log(d.id)")
fi
echo "tenant=$TID"

echo "== bootstrap phase1 =="
BOOT=$(curl -sf -X POST "$API/tenants/$TID/bootstrap-phase1" -H "Authorization: Bearer $TOKEN")
echo "$BOOT" | json "console.log(d.accounts.school_admin.email, d.grade_level.name, d.section.name)"

BRANCH=$(echo "$BOOT" | json "console.log(d.branch.id)")
YEAR=$(echo "$BOOT" | json "console.log(d.academic_year.id)")
GRADE=$(echo "$BOOT" | json "console.log(d.grade_level.id)")
SECTION=$(echo "$BOOT" | json "console.log(d.section.id)")
ADMIN_EMAIL=$(echo "$BOOT" | json "console.log(d.accounts.school_admin.email)")
TEACHER_EMAIL=$(echo "$BOOT" | json "console.log(d.accounts.teacher.email)")

echo "== public catalog =="
curl -sf "$API/public/demo-school/catalog" | json "console.log(d.tenant.slug, d.branches.length, d.grade_levels.length)"

STAMP=$(date +%s)
PARENT_EMAIL="parent-demo-${STAMP}@example.com"
PARENT_PHONE="010${STAMP: -8}"

echo "== public apply =="
APP=$(curl -sf -X POST "$API/public/demo-school/admissions/apply" -H 'Content-Type: application/json' \
  -d "{\"branch_id\":\"$BRANCH\",\"academic_year_id\":\"$YEAR\",\"target_grade_id\":\"$GRADE\",\"applicant_full_name\":\"سارة أحمد\",\"date_of_birth\":\"2022-09-15\",\"guardian_details\":{\"full_name\":\"أحمد والد\",\"phone\":\"$PARENT_PHONE\",\"email\":\"$PARENT_EMAIL\"},\"documents\":[]}")
APP_ID=$(echo "$APP" | json "console.log(d.id)")
echo "application=$APP_ID status=$(echo "$APP" | json "console.log(d.status)")"

echo "== school admin login =="
ALOGIN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"admin123456\"}")
ATOKEN=$(echo "$ALOGIN" | json "console.log(d.accessToken)")
ATENANT=$(echo "$ALOGIN" | json "console.log(d.user.tenantId)")

echo "== accept + enroll =="
curl -sf -X POST "$API/admissions/applications/$APP_ID/accept" \
  -H "Authorization: Bearer $ATOKEN" -H "x-tenant-id: $ATENANT" -H "x-branch-id: $BRANCH" >/dev/null
ENROLL=$(curl -sf -X POST "$API/admissions/applications/$APP_ID/enroll" \
  -H "Authorization: Bearer $ATOKEN" -H "x-tenant-id: $ATENANT" -H "x-branch-id: $BRANCH" \
  -H 'Content-Type: application/json' \
  -d "{\"section_id\":\"$SECTION\",\"create_parent_account\":true,\"parent_password\":\"parent123\"}")
STUDENT=$(echo "$ENROLL" | json "console.log(d.student?.id || d.application?.enrolled_student_id || '')")
echo "enrolled student=$STUDENT"

echo "== teacher login + attendance batch =="
TLOGIN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"admin123456\"}")
TTOKEN=$(echo "$TLOGIN" | json "console.log(d.accessToken)")
TTENANT=$(echo "$TLOGIN" | json "console.log(d.user.tenantId)")
TODAY=$(date -u +%F)
if [ -z "$STUDENT" ]; then
  STUDENT=$(curl -sf "$API/sis/students" -H "Authorization: Bearer $TTOKEN" -H "x-tenant-id: $TTENANT" -H "x-branch-id: $BRANCH" \
    | json "console.log((d[0]&&d[0].id)||'')")
fi
curl -sf -X POST "$API/sis/attendance/batch" \
  -H "Authorization: Bearer $TTOKEN" -H "x-tenant-id: $TTENANT" -H "x-branch-id: $BRANCH" \
  -H 'Content-Type: application/json' \
  -d "{\"entries\":[{\"student_id\":\"$STUDENT\",\"section_id\":\"$SECTION\",\"attendance_date\":\"$TODAY\",\"period_number\":0,\"status\":\"PRESENT\",\"source\":\"MOBILE_APP\"}]}" \
  | json "console.log('attendance', Array.isArray(d)?d.length: (d.rows&&d.rows.length)|| 'ok')"

echo "== parent login + children =="
PLOGIN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PARENT_EMAIL\",\"password\":\"parent123\"}")
PTOKEN=$(echo "$PLOGIN" | json "console.log(d.accessToken)")
PTENANT=$(echo "$PLOGIN" | json "console.log(d.user.tenantId)")
curl -sf "$API/sis/parent/children" -H "Authorization: Bearer $PTOKEN" -H "x-tenant-id: $PTENANT" -H "x-branch-id: $BRANCH" \
  | json "console.log('children', d.length, d[0]&&d[0].full_name)"

echo "PHASE1_E2E_OK"
