import { parseArguments } from './manageLocalAdmin';
import { LocalAdminError } from '../services/localUserAdminService';

describe('manageLocalAdmin parseArguments', () => {
  it.each([
    [['create', '--username=admin'], { command: 'create', username: 'admin' }],
    [['reset-password', '--username=admin'], { command: 'reset-password', username: 'admin' }],
    [['disable', '--username=admin'], { command: 'disable', username: 'admin' }],
    [['enable', '--username=admin'], { command: 'enable', username: 'admin' }],
  ])('parses %p', (argv, expected) => {
    expect(parseArguments(argv)).toEqual(expected);
  });

  it.each([[[]], [['create']], [['remove', '--username=admin']], [['create', '--username=']], [['create', '--password=x', '--username=admin']]])(
    'rejects %p with usage help',
    (argv) => {
      expect(() => parseArguments(argv)).toThrow(LocalAdminError);
      expect(() => parseArguments(argv)).toThrow('Uso: npm run user:admin');
    },
  );
});
