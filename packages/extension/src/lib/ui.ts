import type { AnnotationCategory, AnnotationStatus, Priority, ReportStatus } from '@open-loop/shared';

export const CATEGORY_META: Record<AnnotationCategory, { label: string; color: string }> = {
  bug: { label: 'Bug', color: '#E5484D' },
  ui: { label: 'Design', color: '#8E4EC6' },
  copy: { label: 'Copy', color: '#F76B15' },
  idea: { label: 'Idea', color: '#30A46C' },
  question: { label: 'Question', color: '#0090FF' },
};

export const CATEGORY_ORDER: AnnotationCategory[] = ['bug', 'ui', 'copy', 'idea', 'question'];

export const STATUS_META: Record<ReportStatus | AnnotationStatus, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'blue' },
  in_progress: { label: 'In progress', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  wont_fix: { label: "Won't fix", tone: 'gray' },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: string }> = {
  low: { label: 'Low', tone: 'gray' },
  medium: { label: 'Medium', tone: 'blue' },
  high: { label: 'High', tone: 'amber' },
  critical: { label: 'Critical', tone: 'red' },
};

export const ACCENT = '#5B5BD6';
