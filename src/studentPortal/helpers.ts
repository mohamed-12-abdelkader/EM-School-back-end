const SUBJECT_COLORS = [
  '#4F46E5',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
];

const SUBJECT_ICONS = [
  'BookOpen',
  'Calculator',
  'FlaskConical',
  'Globe2',
  'Languages',
  'Atom',
  'PenLine',
  'Music',
];

export function subjectStyle(subjectId: number) {
  const i = Math.abs(subjectId) % SUBJECT_COLORS.length;
  return { color: SUBJECT_COLORS[i], icon: SUBJECT_ICONS[i] };
}

export function mapTaskStatus(row: {
  submitted_at: string | null;
  grade: number | null;
  due_at: string | null;
}): 'new' | 'submitted' | 'graded' | 'overdue' {
  if (row.grade != null) return 'graded';
  if (row.submitted_at) return 'submitted';
  if (row.due_at && new Date(row.due_at).getTime() < Date.now()) return 'overdue';
  return 'new';
}
