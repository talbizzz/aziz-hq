export default {
  extends: ['@commitlint/config-conventional'],
  // Subjects start with the task id (e.g. "T1.3 ..."), which the case rule rejects.
  rules: { 'subject-case': [0] },
};
