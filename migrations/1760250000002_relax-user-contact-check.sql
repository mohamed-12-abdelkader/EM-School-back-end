-- Up Migration

-- School students/parents may authenticate via login_code without email/phone
ALTER TABLE users
DROP CONSTRAINT IF EXISTS email_or_phone_check;

ALTER TABLE users
ADD CONSTRAINT email_phone_or_login_code_check CHECK (
    email IS NOT NULL
    OR phone IS NOT NULL
    OR login_code IS NOT NULL
);

-- Down Migration
ALTER TABLE users
DROP CONSTRAINT IF EXISTS email_phone_or_login_code_check;

ALTER TABLE users
ADD CONSTRAINT email_or_phone_check CHECK (
    email IS NOT NULL
    OR phone IS NOT NULL
);
