import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arch } from 'node:process';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const appConfig = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(join(rootDir, 'app.config.json'), 'utf8')));
const packageJson = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(join(rootDir, 'package.json'), 'utf8')));

const displayName = appConfig.displayName;
const cargoTargetDir = join(rootDir, 'src-tauri', 'target', 'release');
const appPath = join(cargoTargetDir, 'bundle', 'macos', `${displayName}.app`);
const dmgDir = join(cargoTargetDir, 'bundle', 'dmg');
const macArch = arch === 'arm64' ? 'aarch64' : arch;
const dmgPath = join(dmgDir, `${displayName}_${packageJson.version}_${macArch}.dmg`);

if (process.platform !== 'darwin') {
  throw new Error('macOS DMG creation requires macOS.');
}

if (!existsSync(appPath)) {
  throw new Error(`Missing app bundle: ${appPath}`);
}

mkdirSync(dmgDir, { recursive: true });
rmSync(dmgPath, { force: true });

execFileSync('hdiutil', [
  'create',
  '-volname', displayName,
  '-srcfolder', appPath,
  '-ov',
  '-format', 'UDZO',
  dmgPath
], { stdio: 'inherit' });

console.log(`Created ${dmgPath}`);
