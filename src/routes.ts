import { Router } from 'express';

import { router as authRouter } from './controllers/auth';
import { router as userRouter } from './controllers/user';
import { router as teacherRouter } from './controllers/teacher';
import { router as studentRouter } from './controllers/student';
import { router as studentPortalRouter } from './controllers/studentPortal';
import { router as schoolsRouter } from './controllers/schools';
import { router as schoolGradesRouter } from './controllers/schoolGrades';
import { router as schoolClassroomsRouter } from './controllers/schoolClassrooms';
import { router as schoolSubjectsRouter } from './controllers/schoolSubjects';
import { router as schoolTeachersRouter } from './controllers/schoolTeachers';
import { router as schoolTimetablesRouter } from './controllers/schoolTimetables';
import { router as schoolStudentsRouter } from './controllers/schoolStudents';
import { router as schoolParentsRouter } from './controllers/schoolParents';
import { router as schoolAttendanceRouter } from './controllers/schoolAttendance';
import { router as schoolFeesRouter } from './controllers/schoolFees';
import { router as teacherTimetableRouter } from './controllers/teacherTimetable';
import { router as teacherPortalRouter } from './controllers/teacherPortal';
import { router as utilsRouter } from './controllers/utils';
import { v1Router } from './routes/v1';

export const router = Router();

/** PRD multi-tenant API (Phase 1+) */
router.use('/v1', v1Router);

/** Legacy routes — retained during migration to /api/v1 modules */
router.use('/', authRouter);
router.use('/user', userRouter);
router.use('/teacher', teacherTimetableRouter);
router.use('/teacher', teacherPortalRouter);
router.use('/teacher', teacherRouter);
router.use('/student', studentPortalRouter);
router.use('/student', studentRouter);
router.use('/schools', schoolsRouter);
router.use('/school/grades', schoolGradesRouter);
router.use('/school/classrooms', schoolClassroomsRouter);
router.use('/school/subjects', schoolSubjectsRouter);
router.use('/school/teachers', schoolTeachersRouter);
router.use('/school/timetables', schoolTimetablesRouter);
router.use('/school/students', schoolStudentsRouter);
router.use('/school/parents', schoolParentsRouter);
router.use('/school/attendance', schoolAttendanceRouter);
router.use('/school/fees', schoolFeesRouter);
router.use('/utils', utilsRouter);
