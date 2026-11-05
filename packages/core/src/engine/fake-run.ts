import type { TaskSpec } from './task-graph-spec.js';

/**
 * The scripted scenario used to exercise the engine end to end (scripts/fake-run.ts and the integration tests):
 * parallel builders, one that fails first and is retried, a plan gate, and optionally a task whose first attempt hangs
 * (so killing its worker leaves an expiring lease). Every behaviour is scripted through `payload.fake` (FakeRunner).
 */
export function fakeRunSpec(options: { crash?: boolean } = {}): TaskSpec[] {
  const crash = options.crash === true;
  const spec: TaskSpec[] = [
    { key: 'setup', type: 'system', title: 'Set up the workspace' },
    {
      key: 'build-a',
      type: 'agent',
      role: 'builder',
      title: 'Build part A',
      depends_on: ['setup'],
    },
    {
      key: 'build-b',
      type: 'agent',
      role: 'builder',
      title: 'Build part B (fails once)',
      depends_on: ['setup'],
      payload: {
        fake: {
          outcomes: [{ status: 'failed', summary: 'first attempt fails' }, { status: 'done' }],
        },
      },
    },
    {
      key: 'review-gate',
      type: 'gate',
      title: 'Approve the build',
      depends_on: ['build-a', 'build-b'],
      gate: {
        kind: 'plan',
        title: 'Approve the build?',
        priority: 1,
        context: { note: 'scripted fake run' },
        options: [
          { id: 'approve', label: 'Approve', kind: 'approve' },
          { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
        ],
      },
    },
    {
      key: 'ship',
      type: 'agent',
      role: 'releaser',
      title: 'Ship it',
      depends_on: crash ? ['review-gate', 'crash-me'] : ['review-gate'],
    },
  ];
  if (crash) {
    spec.splice(3, 0, {
      key: 'crash-me',
      type: 'agent',
      role: 'builder',
      title: 'Long task (its worker gets killed)',
      depends_on: ['setup'],
      payload: {
        fake: {
          outcomes: [
            { status: 'done', hang: true },
            { status: 'done', summary: 'recovered' },
          ],
        },
      },
    });
  }
  return spec;
}
