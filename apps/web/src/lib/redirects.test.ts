import { describe, expect, it } from 'vitest';
import { type RouteInput, decideRoute } from './redirects.js';

const base: RouteInput = { accessOk: true, session: false, aal: null, path: '/' };
const next = { type: 'next' } as const;
const to = (path: string) => ({ type: 'redirect', to: path }) as const;

describe('decideRoute (C7)', () => {
  it('denies every path without a valid Access JWT', () => {
    for (const path of ['/', '/login', '/mfa', '/anything'])
      expect(decideRoute({ ...base, accessOk: false, path })).toEqual({ type: 'deny' });
    expect(
      decideRoute({ ...base, accessOk: false, session: true, aal: 'aal2', path: '/' }),
    ).toEqual({ type: 'deny' });
  });

  it('/login: shown without a session, otherwise sent onwards', () => {
    expect(decideRoute({ ...base, path: '/login' })).toEqual(next);
    expect(decideRoute({ ...base, session: true, aal: 'aal1', path: '/login' })).toEqual(
      to('/mfa'),
    );
    expect(decideRoute({ ...base, session: true, aal: 'aal2', path: '/login' })).toEqual(to('/'));
  });

  it('/mfa: needs a session at aal1; aal2 goes to the dashboard', () => {
    expect(decideRoute({ ...base, path: '/mfa' })).toEqual(to('/login'));
    expect(decideRoute({ ...base, session: true, aal: 'aal1', path: '/mfa' })).toEqual(next);
    expect(decideRoute({ ...base, session: true, aal: 'aal2', path: '/mfa' })).toEqual(to('/'));
  });

  it('/: needs a session at aal2', () => {
    expect(decideRoute({ ...base, path: '/' })).toEqual(to('/login'));
    expect(decideRoute({ ...base, session: true, aal: 'aal1', path: '/' })).toEqual(to('/mfa'));
    expect(decideRoute({ ...base, session: true, aal: 'aal2', path: '/' })).toEqual(next);
  });

  it('any other path behaves like a protected page', () => {
    expect(decideRoute({ ...base, path: '/runs/42' })).toEqual(to('/login'));
    expect(decideRoute({ ...base, session: true, aal: 'aal1', path: '/runs/42' })).toEqual(
      to('/mfa'),
    );
    expect(decideRoute({ ...base, session: true, aal: 'aal2', path: '/runs/42' })).toEqual(next);
  });

  it('treats a session with an unknown aal as aal1', () => {
    expect(decideRoute({ ...base, session: true, aal: null, path: '/' })).toEqual(to('/mfa'));
  });
});
