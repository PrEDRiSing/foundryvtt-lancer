import gulp from "gulp";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import archiver from "archiver";
import stringify from "json-stringify-pretty-compact";
import cp from "child_process";

import git from "gulp-git";

import yargs from "yargs";
const argv = yargs.argv;

function getConfig() {
  const configPath = path.resolve(process.cwd(), "foundryconfig.json");
  let config;

  if (fs.existsSync(configPath)) {
    config = fs.readJSONSync(configPath);
    return config;
  } else {
    return;
  }
}

function getManifest() {
  for (let name of ["system.json", "module.json"]) {
    for (let root of ["public", "src", "dist"]) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) {
        return { file: fs.readJSONSync(p), root, name };
      }
    }
  }

  throw Error("Could not find manifest file");
}

/********************/
/*		BUILDING  		*/
/********************/

export function build() {
  return cp.spawn("npx", ["vite", "build"], { stdio: "inherit", shell: true });
}

function _distWatcher() {
  const publicDirPath = path.resolve(process.cwd(), "public");
  const watcher = gulp.watch(["public/**/*.hbs"], { ignoreInitial: false });
  watcher.on('change', async function(file, stats) {
    console.log(`File ${file} was changed`);
    const partial_file = path.relative(publicDirPath, file)
    await fs.copy(path.join("public", partial_file), path.join("dist", partial_file));
  });
}

export function watch() {
  _distWatcher();
  return cp.spawn("npx", ["vite", "build", "-w"], { stdio: "inherit", shell: true });
}

export function serve() {
  _distWatcher();
  // forward arguments on serves
  const serveArg = process.argv[2];
  let commands = ["vite", "serve"];
  if (serveArg == "serve" && process.argv.length > 3) {
    commands = commands.concat(process.argv.slice(3));
  }
  return cp.spawn("npx", commands, { stdio: "inherit", shell: true });
}

/********************/
/*		LINK		*/
/********************/

/**
 * Link build to User Data folder
 */
export async function linkUserData() {
  const name = path.basename(path.resolve("."));
  const config = fs.readJSONSync("foundryconfig.json");

  let destDir;
  try {
    if (
      fs.existsSync(path.resolve(".", "dist", "module.json")) ||
      fs.existsSync(path.resolve(".", "src", "module.json"))
    ) {
      destDir = "modules";
    } else if (
      fs.existsSync(path.resolve(".", "dist", "system.json")) ||
      fs.existsSync(path.resolve(".", "src", "system.json"))
    ) {
      destDir = "systems";
    } else {
      throw Error(`Could not find ${chalk.blueBright("module.json")} or ${chalk.blueBright("system.json")}`);
    }

    let linkDir;
    if (config.dataPath) {
      if (!fs.existsSync(path.join(config.dataPath, "Data")))
        throw Error("User Data path invalid, no Data directory found");

      linkDir = path.join(config.dataPath, "Data", destDir, config.systemName);
    } else {
      throw Error("No User Data path defined in foundryconfig.json");
    }

    if (argv.clean || argv.c) {
      console.log(chalk.yellow(`Removing build in ${chalk.blueBright(linkDir)}`));

      await fs.remove(linkDir);
    } else if (!fs.existsSync(linkDir)) {
      console.log(chalk.green(`Copying build to ${chalk.blueBright(linkDir)}`));
      await fs.symlink(path.resolve("./dist"), linkDir, "junction");
    }
    return Promise.resolve();
  } catch (err) {
    Promise.reject(err);
  }
}

/*********************/
/*		PACKAGE		 */
/*********************/

/**
 * Package build
 */
export async function packageBuild() {
  const manifest = getManifest();

  try {
    // Remove the package dir without doing anything else
    if (argv.clean || argv.c) {
      console.log(chalk.yellow("Removing all packaged files"));
      await fs.remove("package");
      return;
    }

    // Ensure there is a directory to hold all the packaged versions
    await fs.ensureDir("package");

    // Initialize the zip file
    const zipName = `${manifest.file.id}-v${manifest.file.version}.zip`;
    const zipFile = fs.createWriteStream(path.join("package", zipName));
    const zip = archiver("zip", { zlib: { level: 9 } });

    zipFile.on("close", () => {
      console.log(chalk.green(zip.pointer() + " total bytes"));
      console.log(chalk.green(`Zip file ${zipName} has been written`));
      return Promise.resolve();
    });

    zip.on("error", err => {
      throw err;
    });

    zip.pipe(zipFile);

    // Add the directory with the final code
    zip.directory("dist/", manifest.file.id);

    zip.finalize();
  } catch (err) {
    Promise.reject(err);
  }
}

/*********************/
/*		PACKAGE		 */
/*********************/

/**
 * Update version and URLs in the manifest JSON
 */
export function updateManifest(cb) {
  const packageJson = fs.readJSONSync("package.json");
  const config = getConfig(),
    manifest = getManifest(),
    rawURL = config.rawURL,
    downloadURL = config.downloadURL,
    repoURL = config.repository,
    manifestRoot = manifest.root;

  if (!config) cb(Error(chalk.red("foundryconfig.json not found")));
  if (!manifest) cb(Error(chalk.red("Manifest JSON not found")));
  if (!rawURL || !repoURL || !downloadURL) cb(Error(chalk.red("Repository URLs not configured in foundryconfig.json")));

  try {
    const version = argv.update || argv.u;

    /* Update version */

    const versionMatch = /^(\d{1,}).(\d{1,}).(\d{1,})$/;
    const currentVersion = manifest.file.version;
    let targetVersion = "";

    if (!version) {
      cb(Error("Missing version number"));
    }

    if (versionMatch.test(version)) {
      targetVersion = version;
    } else {
      targetVersion = currentVersion.replace(versionMatch, (substring, major, minor, patch) => {
        if (version === "major") {
          return `${Number(major) + 1}.0.0`;
        } else if (version === "minor") {
          return `${major}.${Number(minor) + 1}.0`;
        } else if (version === "patch") {
          return `${major}.${minor}.${Number(minor) + 1}`;
        } else {
          return "";
        }
      });
    }

    if (targetVersion === "") {
      return cb(Error(chalk.red("Error: Incorrect version arguments.")));
    }

    if (targetVersion === currentVersion) {
      return cb(Error(chalk.red("Error: Target version is identical to current version.")));
    }
    console.log(`Updating version number to '${targetVersion}'`);

    packageJson.version = targetVersion;
    manifest.file.version = targetVersion;

    /* Update URLs */
    const download = `${downloadURL}/v${manifest.file.version}/${manifest.file.id}-v${manifest.file.version}.zip`;
    manifest.file.url = repoURL;
    manifest.file.manifest = `${rawURL}/${manifest.name}`;
    manifest.file.download = download;

    const prettyProjectJson = stringify(manifest.file, { maxLength: 35 });

    fs.writeJSONSync("package.json", packageJson, { spaces: 2 });
    fs.writeFileSync(path.join(manifest.root, manifest.name), prettyProjectJson, "utf8");

    return cb();
  } catch (err) {
    cb(err);
  }
}

function gitAdd() {
  return gulp.src("package").pipe(git.add({ args: "--no-all" }));
}

function gitCommit() {
  return gulp.src("./*").pipe(
    git.commit(`v${getManifest().file.version}`, {
      args: "-a",
      disableAppendPaths: true,
    })
  );
}

function gitTag() {
  const manifest = getManifest();
  return git.tag(`v${manifest.file.version}`, `Updated to ${manifest.file.version}`, err => {
    if (err) throw err;
  });
}

export const execGit = gulp.series(gitAdd, gitCommit, gitTag);
export const publish = gulp.series(updateManifest, build, packageBuild, execGit);
