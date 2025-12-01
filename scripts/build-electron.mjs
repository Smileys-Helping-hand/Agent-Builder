import { execSync } from 'child_process';

const target = process.env.BUILD_TARGET ?? '--dir';

if (process.env.SKIP_PREPARE !== '1') {
  console.log('🔧 Building backend and dashboard...');
  execSync('npm run prepare-build-env', { stdio: 'inherit' });
}

console.log('📦 Packaging Electron...');
execSync(`npx electron-builder ${target} --config electron-builder.yml`, {
  stdio: 'inherit',
});
