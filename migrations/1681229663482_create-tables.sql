-- Up Migration
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');

CREATE TYPE question_type AS ENUM ('single_choice', 'multiple_choice', 'text');

CREATE TABLE
    users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        avatar TEXT,
        role user_role NOT NULL DEFAULT 'student',
        jti TEXT,
        created_at TIMESTAMP DEFAULT NOW ()
        -- Ensure either email or phone is provided
        CONSTRAINT email_or_phone_check CHECK (
            email IS NOT NULL
            OR phone IS NOT NULL
        )
    );

CREATE TABLE
    grades (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL -- e.g., 'First Secondary', 'Second Secondary', etc.
    );

-- Link between users and grades (many-to-many)
CREATE TABLE
    user_grades (
        user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
        grade_id INTEGER REFERENCES grades (id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, grade_id)
    );

INSERT INTO
    grades (name)
VALUES
    ('أولى إعدادي'),
    ('ثانية إعدادي'),
    ('ثالثة إعدادي'),
    ('أولى ثانوي'),
    ('ثانية ثانوي'),
    ('ثالثة ثانوي'),
    ('الفرقة الأولى في الكلية'),
    ('الفرقة الثانية في الكلية'),
    ('الفرقة الثالثة في الكلية'),
    ('الفرقة الرابعة في الكلية');

CREATE TABLE
    password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    enrollments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
        enrolled_at TIMESTAMP DEFAULT NOW (),
        UNIQUE (user_id, course_id)
    );

CREATE TABLE
    teacher_invite_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        course_id INTEGER NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        max_uses INTEGER NOT NULL DEFAULT 1,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    invite_code_usages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        code_id INTEGER NOT NULL REFERENCES teacher_invite_codes (id) ON DELETE CASCADE,
        used_at TIMESTAMP DEFAULT NOW (),
        UNIQUE (user_id, code_id)
    );

CREATE TABLE
    lectures (
        id SERIAL PRIMARY KEY,
        course_id INTEGER NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        position INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    lecture_videos (
        id SERIAL PRIMARY KEY,
        lecture_id INTEGER NOT NULL REFERENCES lectures (id) ON DELETE CASCADE,
        video_url TEXT NOT NULL,
        title TEXT,
        position INTEGER NOT NULL DEFAULT 1
    );

CREATE TABLE
    lecture_files (
        id SERIAL PRIMARY KEY,
        lecture_id INTEGER NOT NULL REFERENCES lectures (id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        filename TEXT,
        uploaded_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    questions (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        type question_type NOT NULL,
        created_at TIMESTAMP DEFAULT NOW ()
    );

CREATE TABLE
    question_choices (
        id SERIAL PRIMARY KEY,
        question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        is_correct BOOLEAN DEFAULT FALSE
    );

-- Generic Quizzes (Lecture or Exam or Other)
CREATE TABLE
    quizzes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        context_type TEXT NOT NULL, -- 'lecture', 'course_exam', etc.
        context_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW ()
    );

-- Assign questions to quizzes
CREATE TABLE
    question_assignments (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
        position INTEGER NOT NULL
    );

-- Student Answers to any quiz
CREATE TABLE
    question_answers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
        answer_text TEXT,
        selected_choice_ids JSONB DEFAULT '[]',
        submitted_at TIMESTAMP DEFAULT NOW ()
    );

-- Optional: Trigger to increment invite usage
-- CREATE FUNCTION increment_invite_code_usage()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     UPDATE teacher_invite_codes
--     SET uses = uses + 1
--     WHERE id = NEW.code_id;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- CREATE TRIGGER trigger_invite_code_usage
-- AFTER INSERT ON invite_code_usages
-- FOR EACH ROW
-- EXECUTE FUNCTION increment_invite_code_usage();
-- Down Migration
-- Drop Trigger and Function
-- DROP TRIGGER IF EXISTS trigger_invite_code_usage ON invite_code_usages;
-- DROP FUNCTION IF EXISTS increment_invite_code_usage;
-- Drop Tables in Reverse Order
DROP TABLE IF EXISTS question_answers;

DROP TABLE IF EXISTS question_assignments;

DROP TABLE IF EXISTS quizzes;

DROP TABLE IF EXISTS question_choices;

DROP TABLE IF EXISTS questions;

DROP TABLE IF EXISTS lecture_files;

DROP TABLE IF EXISTS lecture_videos;

DROP TABLE IF EXISTS lectures;

DROP TABLE IF EXISTS invite_code_usages;

DROP TABLE IF EXISTS teacher_invite_codes;

DROP TABLE IF EXISTS enrollments;

DROP TABLE IF EXISTS courses;

DROP TABLE IF EXISTS wallets;

DROP TABLE IF EXISTS password_resets;

DROP TABLE IF EXISTS user_grades;

DROP TABLE IF EXISTS grades;

DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS question_type;

DROP TYPE IF EXISTS user_role;