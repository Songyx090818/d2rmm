#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function isUpdateMode(args) {
  return args.length === 3;
}

// old files that should be preserved during update
const PRESERVED_PATHS = new Set(
  [
    'mods',
    'Local Storage',
    'ENABLE_PRE_RELEASE_UPDATES',
    'ENABLE_SAME_VERSION_UPDATES',
    'ENABLE_LOCAL_PREFERENCES',
    'ENABLE_GLOBAL_PREFERENCES',
  ].map((p) => path.normalize(p)),
);

async function main() {
  const args = process.argv.slice(2);

  if (!isUpdateMode(args)) {
    console.error('Usage: updater <source_dir> <target_dir> <executable_path>');
    process.exit(1);
  }

  const srcDirPath = path.resolve(args[0]);
  const dstDirPath = path.resolve(args[1]);
  const executablePath = path.resolve(args[2]);

  console.log('Updater started.');
  console.log('Source directory:', srcDirPath);
  console.log('Destination directory:', dstDirPath);
  console.log('Executable path:', executablePath);

  // remove old files
  console.log('Cleaning up old application files...');
  await removeOldFiles(dstDirPath);

  // copy new files over
  console.log('Copying new application files...');
  for (const srcFilePath of yieldAllFilesRecursively(srcDirPath)) {
    const dstFilePath = path.join(
      dstDirPath,
      path.relative(srcDirPath, srcFilePath),
    );
    await copyFileWithRetries(srcFilePath, dstFilePath);
  }

  // start the app
  console.log('Updater finished. Starting application...');
  childProcess
    .spawn(executablePath, {
      detached: true,
      stdio: 'ignore',
    })
    .unref();
}

if (require.main === module) {
  try {
    main().then().catch(console.error);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

function isDescendantPath(pathA, pathB) {
  const relative = path.relative(pathA, pathB);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function isAncestorOfPreservedPath(relativePath) {
  for (const preservedPath of PRESERVED_PATHS) {
    if (isDescendantPath(relativePath, preservedPath)) {
      return true;
    }
  }
  return false;
}

async function removeOldFiles(dstDirPath, relativePath = '') {
  const currentPath = path.join(dstDirPath, relativePath);
  if (!fs.existsSync(currentPath)) {
    return;
  }
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryRelativePath = path.join(relativePath, entry.name);

    if (PRESERVED_PATHS.has(entryRelativePath)) {
      continue;
    }

    if (entry.isDirectory() && isAncestorOfPreservedPath(entryRelativePath)) {
      // something inside this directory must survive, so don't remove the
      // directory itself - recurse into it and only remove what isn't
      // preserved
      await removeOldFiles(dstDirPath, entryRelativePath);
      continue;
    }

    await removeWithRetries(path.join(dstDirPath, entryRelativePath));
  }
}

function* yieldAllFilesRecursively(filePath) {
  const entries = fs.statSync(filePath).isDirectory()
    ? fs.readdirSync(filePath, { withFileTypes: true })
    : [];
  for (const entry of entries) {
    const fullPath = path.join(filePath, entry.name);
    if (entry.isDirectory()) {
      yield* yieldAllFilesRecursively(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

async function copyFileWithRetries(
  srcPath,
  dstPath,
  // wait up to 30 seconds for old app to exit
  maxRetries = 30,
  delayMs = 1000,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

async function removeWithRetries(
  targetPath,
  // wait up to 30 seconds for old app to exit
  maxRetries = 30,
  delayMs = 1000,
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
