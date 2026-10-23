export type StudentCtx = {
  studentId: number;
  schoolId: number;
  classroomId: number;
  gradeId: number | null;
  academicYear: string | null;
  gradeName: string | null;
  classroomName: string | null;
};

export type SubmitAnswer = {
  question_id: number;
  choice_id?: number | null;
  written_answer?: string | null;
};
