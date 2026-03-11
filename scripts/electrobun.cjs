const { spawnSync } = require("child_process");
const { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { join } = require("path");

const projectRoot = join(__dirname, "..");
const shimDir = join(projectRoot, ".electrobun-shims");
const electrobunBin = join(projectRoot, "node_modules", "electrobun", "bin", "electrobun.cjs");
const electrobunDir = join(projectRoot, "node_modules", "electrobun");
const electrobunCliSource = join(electrobunDir, "src", "cli");
const electrobunSharedDist = join(electrobunDir, "dist", "api", "shared");
const shimCliRoot = join(shimDir, "electrobun-src");
const shimCliDir = join(shimCliRoot, "cli");
const shimSharedDir = join(shimCliRoot, "shared");
const shimCliEntry = join(shimCliDir, "index.ts");
const expectedSharedFiles = ["platform.ts", "cef-version.ts", "bun-version.ts", "naming.ts"];

function fail(message) {
	console.error(`ElectroBun wrapper error: ${message}`);
	process.exit(1);
}

function requireExistingPath(pathToCheck, description) {
	if (!existsSync(pathToCheck)) {
		fail(`${description} not found at ${pathToCheck}. The repo wrapper expects ElectroBun 1.15.1's published file layout.`);
	}
}

function verifyElectrobunLayout() {
	requireExistingPath(electrobunBin, "ElectroBun launcher");
	requireExistingPath(electrobunCliSource, "ElectroBun CLI source directory");
	requireExistingPath(electrobunSharedDist, "ElectroBun shared API directory");

	const packageJsonPath = join(electrobunDir, "package.json");
	requireExistingPath(packageJsonPath, "ElectroBun package metadata");
	const electrobunPackage = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (electrobunPackage.version !== "1.15.1") {
		fail(`expected electrobun@1.15.1 but found ${electrobunPackage.version}. Update scripts/electrobun.cjs before changing ElectroBun.`);
	}

	for (const fileName of expectedSharedFiles) {
		requireExistingPath(join(electrobunSharedDist, fileName), `ElectroBun shared file ${fileName}`);
	}
}

function ensureShimmedCliSource() {
	rmSync(shimCliRoot, { recursive: true, force: true });
	mkdirSync(shimDir, { recursive: true });
	cpSync(electrobunCliSource, shimCliDir, { recursive: true });
	mkdirSync(shimSharedDir, { recursive: true });

	for (const fileName of expectedSharedFiles) {
		copyFileSync(join(electrobunSharedDist, fileName), join(shimSharedDir, fileName));
	}

	const source = readFileSync(shimCliEntry, "utf8");
	const patchedSource = source
		.replace(
			'import { execSync } from "child_process";',
			'import { execFileSync, execSync } from "child_process";',
		)
		.replace(
			'import { getTemplate, getTemplateNames } from "./templates/embedded";',
			`const getTemplateNames = () => [];
const getTemplate = () => undefined;`,
		)
		.replace(
			'const ELECTROBUN_DEP_PATH = join(projectRoot, "node_modules", "electrobun");',
			`const ELECTROBUN_DEP_PATH = join(projectRoot, "node_modules", "electrobun");

function resolveLocalRceditBinaryPath() {
\tconst rceditPackageJsonPath = require.resolve("rcedit/package.json", {
\t\tpaths: [projectRoot],
\t});
\tconst rceditPackageDir = dirname(rceditPackageJsonPath);
\tconst candidatePaths = [
\t\tjoin(rceditPackageDir, "bin", "rcedit-x64.exe"),
\t\tjoin(rceditPackageDir, "bin", "rcedit.exe"),
\t];
\tconst rceditBinaryPath = candidatePaths.find((candidatePath) =>
\t\texistsSync(candidatePath),
\t);

\tif (!rceditBinaryPath) {
\t\tthrow new Error(
\t\t\t\`Could not find a local rcedit executable in \${join(rceditPackageDir, "bin")}\`,
\t\t);
\t}

\treturn rceditBinaryPath;
}

function embedWindowsIconWithLocalRcedit(executablePath: string, iconPath: string) {
\texecFileSync(resolveLocalRceditBinaryPath(), [executablePath, "--set-icon", iconPath], {
\t\tstdio: "pipe",
\t});
}`,
		)
		.replace(
			/const rcedit = \(await import\("rcedit"\)\)\.default;\s+await rcedit\(bunCliLauncherDestination, \{\s+icon: iconPath,\s+\}\);/m,
			'embedWindowsIconWithLocalRcedit(bunCliLauncherDestination, iconPath);',
		)
		.replace(
			/const rcedit = \(await import\("rcedit"\)\)\.default;\s+await rcedit\(bunBinaryDestInBundlePath, \{\s+icon: iconPath,\s+\}\);/m,
			'embedWindowsIconWithLocalRcedit(bunBinaryDestInBundlePath, iconPath);',
		)
		.replace(
			/const rcedit = \(await import\("rcedit"\)\)\.default;\s+await rcedit\(outputExePath, \{\s+icon: iconPath,\s+\}\);/m,
			'embedWindowsIconWithLocalRcedit(outputExePath, iconPath);',
		);

	if (patchedSource === source) {
		fail("could not apply the local ElectroBun CLI patch. ElectroBun's published CLI source layout likely changed.");
	}

	writeFileSync(shimCliEntry, patchedSource);
}

function main() {
	verifyElectrobunLayout();
	if (!process.env.PATH || !process.env.PATH.toLowerCase().includes("bun")) {
		const bunCheck = spawnSync("bun", ["--version"], { stdio: "pipe", shell: true });
		if (bunCheck.status !== 0) {
			fail("Bun is required but was not found in PATH. Install Bun before running desktop Electrobun commands.");
		}
	}

	const args = process.argv.slice(2);
	const env = {
		...process.env,
		PATH: existsSync(shimDir)
			? `${shimDir};${process.env.PATH || ""}`
			: process.env.PATH,
	};

	const entrypoint =
		args[0] === "init"
			? { command: process.execPath, args: [electrobunBin, ...args] }
			: (() => {
				ensureShimmedCliSource();
				return { command: "bun", args: [shimCliEntry, ...args] };
			})();

	const result = spawnSync(entrypoint.command, entrypoint.args, {
		stdio: "inherit",
		cwd: projectRoot,
		env,
	});

	if (result.error) {
		fail(result.error.message);
	}

	process.exit(result.status ?? 0);
}

main();
