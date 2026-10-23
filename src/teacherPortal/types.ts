export type TeacherCtx = {
  teacherId: number;
  schoolId: number;
};

export type ExamQuestionInput = {
  type: 'mcq' | 'written';
  text: string;
  points: number;
  model_answer?: string | null;
  choices?: Array<{ text: string; is_correct: boolean }>;
};
