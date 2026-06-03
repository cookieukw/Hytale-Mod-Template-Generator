import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.resolve(__dirname, '../../cache');

export interface GradleWrapperAssets {
  gradlew: string;
  gradlewBat: string;
  jar: Buffer;
}

function parseGradleVersion(distributionUrl: string) {
  const match = distributionUrl.match(/gradle-([^/]+?)-(?:bin|all)\.zip$/);

  if (!match) {
    throw new Error(
      `Could not determine the Gradle version from GRADLE_DISTRIBUTION_URL: ${distributionUrl}`
    );
  }

  return match[1];
}

function parseDistributionType(distributionUrl: string): 'bin' | 'all' {
  const match = distributionUrl.match(/gradle-[^/]+?-(bin|all)\.zip$/);
  return match?.[1] === 'all' ? 'all' : 'bin';
}

async function pathExists(filePath: string) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runGradleWrapperTask(version: string, distributionType: 'bin' | 'all', targetDir: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hytale-gradle-wrapper-'));

  try {
    await writeFile(
      path.join(tempDir, 'settings.gradle'),
      `pluginManagement { repositories { gradlePluginPortal(); mavenCentral(); google() } }\n`
    );

    await writeFile(
      path.join(tempDir, 'build.gradle'),
      `plugins { id 'base' }\n`
    );

    const gradleCommand = process.env.GRADLE_COMMAND || (process.platform === 'win32' ? 'gradle.bat' : 'gradle');

    try {
      await execFileAsync(
        gradleCommand,
        ['wrapper', '--gradle-version', version, '--distribution-type', distributionType],
        {
          cwd: tempDir,
          maxBuffer: 1024 * 1024 * 10
        }
      );
    } catch (error) {
      throw new Error(
        [
          `Failed to generate Gradle wrapper assets for Gradle ${version}.`,
          '',
          `Tried to run: ${gradleCommand} wrapper --gradle-version ${version} --distribution-type ${distributionType}`,
          '',
          'Make sure Java and Gradle are installed and available to the Node server process.',
          'You can verify with:',
          '  java --version',
          '  gradle -v',
          '',
          error instanceof Error ? error.message : String(error)
        ].join('\n')
      );
    }

    await mkdir(targetDir, { recursive: true });

    await copyFile(path.join(tempDir, 'gradlew'), path.join(targetDir, 'gradlew'));
    await copyFile(path.join(tempDir, 'gradlew.bat'), path.join(targetDir, 'gradlew.bat'));
    await copyFile(
      path.join(tempDir, 'gradle/wrapper/gradle-wrapper.jar'),
      path.join(targetDir, 'gradle-wrapper.jar')
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function resolveGradleWrapperAssets(): Promise<GradleWrapperAssets> {
  await mkdir(cacheDir, { recursive: true });

  const version = parseGradleVersion(config.gradleDistributionUrl);
  const distributionType = parseDistributionType(config.gradleDistributionUrl);
  const assetDir = path.join(cacheDir, `gradle-wrapper-assets-${version}-${distributionType}`);

  const gradlewPath = path.join(assetDir, 'gradlew');
  const gradlewBatPath = path.join(assetDir, 'gradlew.bat');
  const jarPath = path.join(assetDir, 'gradle-wrapper.jar');

  const hasCachedAssets =
    existsSync(assetDir) &&
    await pathExists(gradlewPath) &&
    await pathExists(gradlewBatPath) &&
    await pathExists(jarPath);

  if (!hasCachedAssets) {
    await runGradleWrapperTask(version, distributionType, assetDir);
  }

  return {
    gradlew: await readFile(gradlewPath, 'utf8'),
    gradlewBat: await readFile(gradlewBatPath, 'utf8'),
    jar: await readFile(jarPath)
  };
}

export async function resolveGradleWrapperJar(): Promise<Buffer> {
  return (await resolveGradleWrapperAssets()).jar;
}