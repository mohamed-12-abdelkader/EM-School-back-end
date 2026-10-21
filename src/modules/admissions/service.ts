import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import pool from '../../db/pool';
import { HttpError } from '../../utils';
import { isAgeEligible } from '../../utils/ageAtCutoff';
import { createDownloadUrl, createUploadUrl } from '../../services/storage';
import { enqueueEnrollmentFee, enqueueMessagingFallback } from '../../workers/queues';
import type { z } from 'zod';
import type {
  CreateApplicationSchema,
  EnrollApplicationSchema,
  RecordScoresSchema,
  ScheduleExamSchema,
  UpdateDocumentStatusSchema,
  UpsertSeatQuotaSchema,
} from './schemas';

export async function createApplication(
  tenantId: string,
  input: z.infer<typeof CreateApplicationSchema>,
  options?: { skipAgeCheck?: boolean },
) {
  const grade = await pool.query(
    `SELECT g.*, ay.starts_on, ay.age_cutoff_month, ay.age_cutoff_day
     FROM grade_levels g
     CROSS JOIN academic_years ay
     WHERE g.tenant_id = $1 AND g.id = $3
       AND ay.tenant_id = $1 AND ay.id = $2`,
    [tenantId, input.academic_year_id, input.target_grade_id],
  );
  if (!grade.rowCount) throw new HttpError(404, 'Grade or academic year not found');

  const g = grade.rows[0];
  const cutoffYear = new Date(g.starts_on).getUTCFullYear();
  if (!options?.skipAgeCheck) {
    const eligibility = isAgeEligible(
      input.date_of_birth,
      {
        year: cutoffYear,
        month: g.age_cutoff_month,
        day: g.age_cutoff_day,
      },
      g.min_age_years != null ? Number(g.min_age_years) : null,
      g.max_age_years != null ? Number(g.max_age_years) : null,
    );
    if (!eligibility.ok) {
      throw new HttpError(400, eligibility.reason || 'Age eligibility failed');
    }
  }

  const result = await pool.query(
    `INSERT INTO admission_applications (
      tenant_id, branch_id, academic_year_id, target_grade_id,
      applicant_full_name, date_of_birth, guardian_details, documents, family_group_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
    RETURNING *`,
    [
      tenantId,
      input.branch_id,
      input.academic_year_id,
      input.target_grade_id,
      input.applicant_full_name,
      input.date_of_birth,
      JSON.stringify(input.guardian_details),
      JSON.stringify(input.documents),
      input.family_group_id ?? null,
    ],
  );
  return result.rows[0];
}

export async function listApplications(tenantId: string, branchId?: string | null, status?: string) {
  const result = await pool.query(
    `SELECT * FROM admission_applications
     WHERE tenant_id = $1
       AND ($2::uuid IS NULL OR branch_id = $2)
       AND ($3::text IS NULL OR status = $3)
     ORDER BY created_at DESC`,
    [tenantId, branchId ?? null, status ?? null],
  );
  return result.rows;
}

export async function scheduleExam(
  tenantId: string,
  applicationId: string,
  input: z.infer<typeof ScheduleExamSchema>,
) {
  const result = await pool.query(
    `UPDATE admission_applications SET
      entrance_exam_slot = $3,
      proctor_user_id = COALESCE($4, proctor_user_id),
      status = 'EXAM_SCHEDULED',
      updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, applicationId, input.entrance_exam_slot, input.proctor_user_id ?? null],
  );
  if (!result.rowCount) throw new HttpError(404, 'Application not found');
  return result.rows[0];
}

export async function recordScores(
  tenantId: string,
  applicationId: string,
  input: z.infer<typeof RecordScoresSchema>,
) {
  const result = await pool.query(
    `UPDATE admission_applications SET
      entrance_exam_score = COALESCE($3, entrance_exam_score),
      interview_score = COALESCE($4, interview_score),
      updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      applicationId,
      input.entrance_exam_score ?? null,
      input.interview_score ?? null,
    ],
  );
  if (!result.rowCount) throw new HttpError(404, 'Application not found');
  return result.rows[0];
}

export async function upsertSeatQuota(
  tenantId: string,
  input: z.infer<typeof UpsertSeatQuotaSchema>,
) {
  const result = await pool.query(
    `INSERT INTO grade_seat_quotas
      (tenant_id, branch_id, academic_year_id, grade_level_id, max_seats)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, academic_year_id, grade_level_id)
     DO UPDATE SET max_seats = EXCLUDED.max_seats, branch_id = EXCLUDED.branch_id
     RETURNING *`,
    [tenantId, input.branch_id, input.academic_year_id, input.grade_level_id, input.max_seats],
  );
  return result.rows[0];
}

async function computeWaitlistRank(
  client: import('pg').PoolClient,
  tenantId: string,
  app: { id: string; family_group_id: string | null; entrance_exam_score: number | null },
) {
  const siblingBoost = app.family_group_id
    ? (
        await client.query(
          `SELECT COUNT(*)::int AS c FROM students
           WHERE tenant_id = $1 AND family_group_id = $2 AND lifecycle_status = 'ACTIVE'`,
          [tenantId, app.family_group_id],
        )
      ).rows[0].c
    : 0;

  const score = Number(app.entrance_exam_score || 0) + siblingBoost * 10;
  const ahead = await client.query(
    `SELECT COUNT(*)::int AS c FROM admission_applications
     WHERE tenant_id = $1 AND status = 'WAITLISTED' AND id <> $2
       AND (
         COALESCE(entrance_exam_score,0) +
         CASE WHEN family_group_id IS NOT NULL THEN 10 ELSE 0 END
       ) > $3`,
    [tenantId, app.id, score],
  );
  return ahead.rows[0].c + 1;
}

export async function acceptOrWaitlist(tenantId: string, applicationId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT * FROM admission_applications WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, applicationId],
    );
    if (!current.rowCount) throw new HttpError(404, 'Application not found');
    const app = current.rows[0];

    const quota = await client.query(
      `SELECT * FROM grade_seat_quotas
       WHERE tenant_id = $1 AND academic_year_id = $2 AND grade_level_id = $3
       FOR UPDATE`,
      [tenantId, app.academic_year_id, app.target_grade_id],
    );

    let status = 'ACCEPTED';
    let waitlistRank: number | null = null;

    if (quota.rowCount) {
      const q = quota.rows[0];
      if (q.enrolled_count >= q.max_seats) {
        status = 'WAITLISTED';
        waitlistRank = await computeWaitlistRank(client, tenantId, app);
        await client.query(
          `UPDATE grade_seat_quotas SET waitlist_count = waitlist_count + 1 WHERE id = $1`,
          [q.id],
        );
      }
    }

    const updated = await client.query(
      `UPDATE admission_applications SET
        status = $3, waitlist_rank = $4, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, applicationId, status, waitlistRank],
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function enrollApplication(
  tenantId: string,
  applicationId: string,
  input: z.infer<typeof EnrollApplicationSchema>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT * FROM admission_applications WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, applicationId],
    );
    if (!current.rowCount) throw new HttpError(404, 'Application not found');
    const app = current.rows[0];
    if (!['ACCEPTED', 'WAITLISTED'].includes(app.status)) {
      throw new HttpError(400, `Cannot enroll from status ${app.status}`);
    }

    const quota = await client.query(
      `SELECT * FROM grade_seat_quotas
       WHERE tenant_id = $1 AND academic_year_id = $2 AND grade_level_id = $3
       FOR UPDATE`,
      [tenantId, app.academic_year_id, app.target_grade_id],
    );
    if (quota.rowCount && quota.rows[0].enrolled_count >= quota.rows[0].max_seats) {
      throw new HttpError(409, 'No seats available — keep waitlisted');
    }

    let familyGroupId = app.family_group_id as string | null;
    if (!familyGroupId) {
      const fg = await client.query(
        `INSERT INTO family_groups (tenant_id, display_name)
         VALUES ($1, $2) RETURNING id`,
        [tenantId, `${app.applicant_full_name} Family`],
      );
      familyGroupId = fg.rows[0].id;
    }

    const guardian = (app.guardian_details || {}) as Record<string, unknown>;
    const guardianName = String(guardian.full_name || guardian.name || 'Guardian');
    const guardianEmail = guardian.email ? String(guardian.email) : null;
    const guardianPhone = guardian.phone ? String(guardian.phone) : null;

    let parentUserId: string | null = null;
    if (input.create_parent_account && (guardianEmail || guardianPhone)) {
      const password = input.parent_password || randomUUID().slice(0, 10);
      const hash = await bcrypt.hash(password, 10);
      const user = await client.query(
        `INSERT INTO mt_users (email, phone, password_hash, full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET phone = COALESCE(EXCLUDED.phone, mt_users.phone)
         RETURNING id`,
        [guardianEmail, guardianPhone, hash, guardianName],
      );
      parentUserId = user.rows[0].id;
      await client.query(
        `INSERT INTO mt_memberships (tenant_id, branch_id, user_id, role)
         VALUES ($1, $2, $3, 'PARENT') ON CONFLICT DO NOTHING`,
        [tenantId, app.branch_id, parentUserId],
      );
    }

    const pickupToken = randomUUID();
    await client.query(
      `INSERT INTO student_guardians (
        tenant_id, family_group_id, user_id, full_name, phone, email,
        is_primary, has_custody, is_financially_responsible, can_pickup, pickup_qr_token
      ) VALUES ($1,$2,$3,$4,$5,$6, TRUE, TRUE, TRUE, TRUE, $7)`,
      [
        tenantId,
        familyGroupId,
        parentUserId,
        guardianName,
        guardianPhone,
        guardianEmail,
        pickupToken,
      ],
    );

    const studentCode = input.student_code || `STU-${String(app.id).slice(0, 8).toUpperCase()}`;
    const student = await client.query(
      `INSERT INTO students (
        tenant_id, branch_id, family_group_id, student_code, full_name,
        grade_level_id, date_of_birth, current_section_id, lifecycle_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')
      RETURNING *`,
      [
        tenantId,
        app.branch_id,
        familyGroupId,
        studentCode,
        app.applicant_full_name,
        app.target_grade_id,
        app.date_of_birth,
        input.section_id ?? null,
      ],
    );

    if (quota.rowCount) {
      await client.query(
        `UPDATE grade_seat_quotas SET
          enrolled_count = enrolled_count + 1,
          waitlist_count = GREATEST(waitlist_count - CASE WHEN $2 = 'WAITLISTED' THEN 1 ELSE 0 END, 0)
         WHERE id = $1`,
        [quota.rows[0].id, app.status],
      );
    }

    const updated = await client.query(
      `UPDATE admission_applications SET
        status = 'ENROLLED',
        family_group_id = $3,
        enrolled_student_id = $4,
        updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, applicationId, familyGroupId, student.rows[0].id],
    );

    await client.query('COMMIT');

    await enqueueEnrollmentFee({
      tenantId,
      studentId: student.rows[0].id,
      applicationId,
      familyGroupId: familyGroupId!,
    });

    return { application: updated.rows[0], student: student.rows[0], pickupToken };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateDocumentStatus(
  tenantId: string,
  applicationId: string,
  input: z.infer<typeof UpdateDocumentStatusSchema>,
) {
  const current = await pool.query(
    `SELECT documents FROM admission_applications WHERE tenant_id = $1 AND id = $2`,
    [tenantId, applicationId],
  );
  if (!current.rowCount) throw new HttpError(404, 'Application not found');

  const docs = (current.rows[0].documents || []) as Array<Record<string, unknown>>;
  if (!docs[input.documentIndex]) throw new HttpError(400, 'Document index out of range');
  docs[input.documentIndex] = { ...docs[input.documentIndex], status: input.status };

  const updated = await pool.query(
    `UPDATE admission_applications SET documents = $3::jsonb, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, applicationId, JSON.stringify(docs)],
  );

  if (input.status === 'REJECTED_RESUBMIT') {
    await enqueueMessagingFallback({
      tenantId,
      channel: 'PUSH',
      recipient: 'guardian',
      payload: {
        type: 'DOCUMENT_REJECTED',
        applicationId,
        documentIndex: input.documentIndex,
      },
    });
  }

  return updated.rows[0];
}

export async function presignDocument(
  tenantId: string,
  applicationId: string,
  documentType: string,
  contentType?: string,
) {
  const exists = await pool.query(
    `SELECT id FROM admission_applications WHERE tenant_id = $1 AND id = $2`,
    [tenantId, applicationId],
  );
  if (!exists.rowCount) throw new HttpError(404, 'Application not found');

  return createUploadUrl({
    tenantId,
    applicationId,
    documentType,
    contentType,
  });
}

export async function getDocumentDownload(path: string) {
  return createDownloadUrl(path);
}
