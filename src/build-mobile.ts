import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRunner } from './runner';
import { getInfo, createArtifact } from './utils';
import type { Artifact, BuildOptions } from './types';

export async function buildProject(
  root: string,
  android: boolean,
  debug: boolean,
  buildOpts: BuildOptions,
  retryAttempts: number,
): Promise<Artifact[]> {
  const runner = await getRunner(root, buildOpts.tauriScript);
  const tauriArgs = debug
    ? ['--debug', ...(buildOpts.args ?? [])]
    : (buildOpts.args ?? []);

  const configArgIdx = [...tauriArgs].findIndex(
    (e) => e === '-c' || e === '--config',
  );
  const configArg =
    configArgIdx >= 0 ? [...tauriArgs][configArgIdx + 1] : undefined;
  const info = getInfo(
    root,
    { arch: 'mobile', platform: android ? 'android' : 'ios' },
    configArg,
  );
  if (!info.tauriPath) {
    throw Error("Couldn't detect path of tauri app");
  }

  // Initialize mobile project if it doesn't exist
  const mobileProjectPath = android
    ? join(info.tauriPath, 'gen/android')
    : join(info.tauriPath, 'gen/apple');

  if (!existsSync(mobileProjectPath)) {
    console.log(`Initializing ${android ? 'Android' : 'iOS'} project...`);
    // I SPEND 2 HOURS TO FIND THIS ISSUE:
    /*
      - On ios if you initialize apple gen folder rust build script will be damaged
      + Original: pnpm tauri ios xcode-script -v 
        --platform ${PLATFORM_DISPLAY_NAME:?} --sdk-root ${SDKROOT:?} 
        --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" 
        --header-search-paths "${HEADER_SEARCH_PATHS:?}" 
        --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" 
        --configuration ${CONFIGURATION:?} ${FORCE_COLOR} ${ARCHS:?}
      + Created from action: pnpm tauri ios xcode-script -v 
        --platform ${PLATFORM_DISPLAY_NAME:?} --sdk-root ${SDKROOT:?} 
        --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" 
        --header-search-paths "${HEADER_SEARCH_PATHS:?}" 
        --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" 
        --configuration ${CONFIGURATION:?} 0 ${ARCHS:?}
    */
    // I found issue: in export async function execCommand with set FORCE_COLOR: '0',
    // But this is interprited by xcode as argument to archs
    await runner.execTauriCommand(
      [android ? 'android' : 'ios', 'init'],
      [],
      root,
      undefined,
      retryAttempts,
    );
  }

  await runner.execTauriCommand(
    [android ? 'android' : 'ios', 'build'],
    [...tauriArgs],
    root,
    undefined,
    retryAttempts,
  );
  let artifacts: Artifact[] = [];
  if (android) {
    const artifactPaths = join(
      info.tauriPath,
      'gen/android/app/build/outputs/',
    );

    const androidPaths = [
      // unsigned release apks
      join(artifactPaths, 'apk/universal/release/app-universal-unsigned.apk'),
      join(artifactPaths, 'apk/arm64/release/app-arm64-unsigned.apk'),
      join(artifactPaths, 'apk/arm/release/app-arm-unsigned.apk'),
      join(artifactPaths, 'apk/x86_64/release/app-x86_64-unsigned.apk'),
      join(artifactPaths, 'apk/x86/release/app-x86-unsigned.apk'),
      // signed release apks
      join(artifactPaths, 'apk/universal/release/app-universal-release.apk'),
      join(artifactPaths, 'apk/arm64/release/app-arm64-release.apk'),
      join(artifactPaths, 'apk/arm/release/app-arm-release.apk'),
      join(artifactPaths, 'apk/x86_64/release/app-x86_64-release.apk'),
      join(artifactPaths, 'apk/x86/release/app-x86-release.apk'),
      // release aabs
      join(artifactPaths, 'bundle/universalRelease/app-universal-release.aab'),
      join(artifactPaths, 'bundle/arm64Release/app-arm64-release.aab'),
      join(artifactPaths, 'bundle/armRelease/app-arm-release.aab'),
      join(artifactPaths, 'bundle/x86_64Release/app-x86_64-release.aab'),
      join(artifactPaths, 'bundle/x86Release/app-x86-release.aab'),
      // debug apks
      join(artifactPaths, 'apk/universal/debug/app-universal-debug.apk'),
      join(artifactPaths, 'apk/arm64/debug/app-arm64-debug.apk'),
      join(artifactPaths, 'apk/arm/debug/app-arm-debug.apk'),
      join(artifactPaths, 'apk/x86_64/debug/app-x86_64-debug.apk'),
      join(artifactPaths, 'apk/x86/debug/app-x86-debug.apk'), 
      // debug aabs
      join(artifactPaths, 'bundle/universalDebug/app-universal-debug.aab'),
      join(artifactPaths, 'bundle/arm64Debug/app-arm64-debug.aab'),
      join(artifactPaths, 'bundle/armDebug/app-arm-debug.aab'),
      join(artifactPaths, 'bundle/x86_64Debug/app-x86_64-debug.aab'),
      join(artifactPaths, 'bundle/x86Debug/app-x86-debug.aab'),
    ];

    artifacts = androidPaths.map((path) => {
      // Extract architecture from path for better naming
      let arch = 'universal';
      if (path.includes('/arm64/') || path.includes('arm64Release') || path.includes('arm64Debug')) arch = 'arm64';
      else if (path.includes('/arm/') || path.includes('armRelease') || path.includes('armDebug')) arch = 'arm';
      else if (path.includes('/x86_64/') || path.includes('x86_64Release') || path.includes('x86_64Debug')) arch = 'x86_64';
      else if (path.includes('/x86/') || path.includes('x86Release') || path.includes('x86Debug')) arch = 'x86';
      else if (path.includes('universal')) arch = 'universal';

      return createArtifact({
        path,
        name: info.name,
        debug,
        platform: 'android',
        arch,
        version: info.version,
      });
    });
  } else {
    const artifactPaths = join(info.tauriPath, 'gen/apple/build/');
    // TODO: Confirm where the iOS project name actually comes from. it may be time for a glob pattern here to get the ipa without knowing the name.
    const iosPaths = [
      join(artifactPaths, `arm64/${info.name}.ipa`),
      join(artifactPaths, `arm64-sim/${info.name}.ipa`),
      join(artifactPaths, `x86_64/${info.name}.ipa`),
    ];

    artifacts = iosPaths.map((path) => {
      // Extract architecture from path for better naming
      let arch = 'universal';
      if (path.includes('/arm64/')) arch = 'arm64';
      else if (path.includes('/arm64-sim/')) arch = 'arm64-sim';
      else if (path.includes('/x86_64/')) arch = 'x86_64';

      return createArtifact({
        path,
        name: info.name,
        debug,
        platform: 'ios',
        arch,
        version: info.version,
      });
    });
  }
  console.log(
    `Looking for artifacts in:\n${artifacts.map((a) => a.path).join('\n')}`,
  );
  return artifacts.filter((p) => existsSync(p.path));
}
