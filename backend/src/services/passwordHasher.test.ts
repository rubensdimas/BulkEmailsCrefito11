import {
  hashPassword,
  validatePasswordPolicy,
  verifyAgainstDummy,
  verifyPassword,
} from './passwordHasher';

describe('passwordHasher', () => {
  it('verifies the original password and rejects a different one', async () => {
    const stored = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', stored)).resolves.toBe(false);
  });

  it('stores scrypt parameters and a random salt', async () => {
    const first = await hashPassword('same password here');
    const second = await hashPassword('same password here');
    expect(first.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(first).not.toBe(second);
  });

  it.each(['', 'bcrypt$abc', 'scrypt$x$8$1$c2FsdA==$a2V5', 'scrypt$16384$8$1$c2FsdA==$c2hvcnQ=', 'scrypt$1073741824$8$1$c2FsdA==$a2V5'])(
    'treats malformed stored hash %p as a mismatch',
    async (stored) => {
      await expect(verifyPassword('anything at all', stored)).resolves.toBe(false);
    },
  );

  it.each([
    ['a'.repeat(11), 'A senha deve ter pelo menos 12 caracteres.'],
    ['a'.repeat(12), null],
    ['a'.repeat(128), null],
    ['a'.repeat(129), 'A senha deve ter no máximo 128 caracteres.'],
    ['ç'.repeat(12), null],
  ])('applies the password policy to %p', (password, expected) => {
    expect(validatePasswordPolicy(password)).toBe(expected);
  });

  it('runs a dummy verification without throwing', async () => {
    await expect(verifyAgainstDummy('whatever password')).resolves.toBeUndefined();
  });
});
