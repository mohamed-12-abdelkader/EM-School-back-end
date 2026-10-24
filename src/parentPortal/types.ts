export type ParentCtx = {
  parentId: number;
  schoolId: number;
};

export type ChildCtx = {
  parentId: number;
  schoolId: number;
  studentId: number;
  classroomId: number | null;
  gradeId: number | null;
  academicYear: string | null;
  gradeName: string | null;
  classroomName: string | null;
  studentName: string;
  relation: string;
  isPrimary: boolean;
  avatar: string | null;
};
