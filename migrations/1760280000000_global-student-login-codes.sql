-- Up Migration
-- Student login codes become globally unique so students can sign in with code only.

-- Resolve any cross-school duplicate student codes before unique index
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  tries INT;
BEGIN
  FOR r IN
    SELECT u.id
    FROM users u
    WHERE u.role = 'student'
      AND u.deleted_at IS NULL
      AND u.login_code IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM users u2
        WHERE u2.role = 'student'
          AND u2.deleted_at IS NULL
          AND u2.login_code = u.login_code
          AND u2.id < u.id
      )
  LOOP
    tries := 0;
    LOOP
      new_code := LPAD((FLOOR(RANDOM() * 100000))::INT::TEXT, 5, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM users
        WHERE role = 'student'
          AND deleted_at IS NULL
          AND login_code = new_code
      );
      tries := tries + 1;
      EXIT WHEN tries > 50;
    END LOOP;
    IF tries <= 50 THEN
      UPDATE users SET login_code = new_code WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_login_code_global
ON users (login_code)
WHERE
    role = 'student'
    AND login_code IS NOT NULL
    AND deleted_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_users_student_login_code_global;
