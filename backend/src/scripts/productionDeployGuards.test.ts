import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const deployScript = resolve(__dirname, '../../../scripts/production/deploy.sh');

describe('production deploy guards', () => {
  let directory: string;
  let environment: NodeJS.ProcessEnv;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bulkmail-deploy-'));
    const docker = join(directory, 'docker');
    writeFileSync(docker, `#!/bin/sh
case "$1 $2 $3" in
  "info --format {{.Swarm.LocalNodeState}}") echo active ;;
  "info --format {{.Swarm.ControlAvailable}}") echo true ;;
  "service inspect "*) exit 1 ;;
  "volume inspect "*) exit 0 ;;
  "image inspect "*) echo sha256:test ;;
  "stack services "*) echo 0/0 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    const curl = join(directory, 'curl');
    writeFileSync(curl, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(curl, 0o755);
    const productionEnv = join(directory, 'production.env');
    writeFileSync(productionEnv, 'APP_ORIGIN=https://bulkmail.example\n');
    environment = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      PRODUCTION_ENV: productionEnv,
      DEPLOY_VERSION: 'test',
      SKIP_BUILD: 'true',
      BACKEND_IMAGE: 'bulkmail-backend:test',
      FRONTEND_IMAGE: 'bulkmail-frontend:test',
    };
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('refuses direct initial bootstrap without a one-time guard', () => {
    const result = spawnSync('sh', [deployScript, '--initial-bootstrap'], {
      encoding: 'utf8',
      env: environment,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('only accepted through bootstrap.sh');
  });

  it('accepts the guard created by its direct bootstrap parent', () => {
    const token = 'one-time-token';
    const guard = join(directory, 'guard');
    writeFileSync(guard, `bulkmail:${token}:${process.pid}\n`, { mode: 0o600 });

    const result = spawnSync(
      'sh',
      [deployScript, '--skip-backup', '--initial-bootstrap', `--bootstrap-guard=${guard}`],
      {
        encoding: 'utf8',
        env: {
          ...environment,
          BULKMAIL_BOOTSTRAP_TOKEN: token,
          BULKMAIL_BOOTSTRAP_CALLER_PID: String(process.pid),
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Deployment test completed successfully.');
  });
});
