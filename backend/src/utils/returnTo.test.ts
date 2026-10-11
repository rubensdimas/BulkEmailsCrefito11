import { sanitizeReturnTo } from './returnTo';

describe('sanitizeReturnTo', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/status/abc?page=2#top', '/status/abc?page=2#top'],
    [undefined, '/'],
    [['/dashboard'], '/'],
    ['', '/'],
    ['dashboard', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example/', '/'],
    ['/dash\nboard', '/'],
    ['/login', '/'],
    ['/login?next=%2F', '/'],
    [`/${'a'.repeat(2048)}`, '/'],
  ])('maps %p to %p', (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });
});
