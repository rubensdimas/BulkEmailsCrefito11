/**
 * Manage local username/password accounts.
 * Usage: npm run user:admin -- <create|reset-password|disable|enable> --username=<name>
 */
import { createInterface } from 'readline';
import { Writable } from 'stream';
import { closeDatabase, initDatabase } from '../config/database';
import { closeRedisConnection } from '../config/redis';
import { createLocalUserRepository } from '../repositories/localUserRepository';
import { revokeLocalUserSessions } from '../services/authSessionService';
import { createLocalAdminService, LocalAdminError } from '../services/localUserAdminService';
import { hashPassword } from '../services/passwordHasher';

export type LocalAdminCommand = 'create' | 'reset-password' | 'disable' | 'enable';

const COMMANDS: LocalAdminCommand[] = ['create', 'reset-password', 'disable', 'enable'];
const USAGE = 'Uso: npm run user:admin -- <create|reset-password|disable|enable> --username=<nome>';

export const parseArguments = (argv: string[]): { command: LocalAdminCommand; username: string } => {
  const [command, ...options] = argv;
  const username = options.length === 1 && options[0].startsWith('--username=')
    ? options[0].slice('--username='.length)
    : '';
  if (!COMMANDS.includes(command as LocalAdminCommand) || !username) throw new LocalAdminError(USAGE);
  return { command: command as LocalAdminCommand, username };
};

// Reads both entries from one interface so piped stdin (two lines) also works.
const readPasswordTwice = async (): Promise<string> => {
  const silent = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const reader = createInterface({ input: process.stdin, output: silent, terminal: Boolean(process.stdin.isTTY) });
  reader.on('SIGINT', () => {
    reader.close();
    process.exit(130);
  });
  const lines = reader[Symbol.asyncIterator]();
  const ask = async (label: string): Promise<string> => {
    process.stdout.write(label);
    const { value, done } = await lines.next();
    process.stdout.write('\n');
    if (done) throw new LocalAdminError('Entrada encerrada antes de informar a senha.');
    return value;
  };

  try {
    const password = await ask('Senha: ');
    if (password !== await ask('Confirme a senha: ')) throw new LocalAdminError('As senhas não conferem.');
    return password;
  } finally {
    reader.close();
  }
};

const main = async (): Promise<void> => {
  const { command, username } = parseArguments(process.argv.slice(2));
  const db = await initDatabase();
  try {
    const admin = createLocalAdminService({
      users: createLocalUserRepository(db),
      hash: hashPassword,
      revokeSessions: revokeLocalUserSessions,
    });

    if (command === 'create') {
      const user = await admin.create(username, await readPasswordTwice());
      console.log(`Usuário local "${user.username}" criado.`);
    } else if (command === 'reset-password') {
      const revoked = await admin.resetPassword(username, await readPasswordTwice());
      console.log(`Senha alterada. Sessões encerradas: ${revoked}.`);
    } else {
      const revoked = await admin.setDisabled(username, command === 'disable');
      console.log(`Usuário ${command === 'disable' ? 'desativado' : 'reativado'}. Sessões encerradas: ${revoked}.`);
    }
  } finally {
    await closeDatabase();
    await closeRedisConnection();
  }
};

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof LocalAdminError ? error.message : error);
    process.exitCode = 1;
  });
}
