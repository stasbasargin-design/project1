import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export function writeBuildInfo(outputDirectory) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const {version} = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let commit = process.env.IMAX_BUILD_SHA || process.env.GITHUB_SHA || '';
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
    catch { commit = 'local'; }
  }
  if (commit !== 'local' && !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Invalid build commit');
  const build = {version, commit};
  writeFileSync(join(outputDirectory, 'build-info.json'), JSON.stringify(build, null, 2) + '\n');
  return build;
}
