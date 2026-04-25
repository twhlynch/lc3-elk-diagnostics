import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { execAsync, isOutdated, stripAnsi } from './utils';
import { RELEASES_URL } from './config';

/**
 * parse elk output to a list of vscode diagnostics
 *
 * @param output elk output
 */
export function parse(output: string): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];

	// remove ansi codes
	const clean = stripAnsi(output);

	// Warning: Error Message (/path/to/file.asm:1:2-3:4)
	const regex =
		/^(Error|Warning):\s+(.*?)\s+\((.*?):(\d+):(\d+)-(\d+):(\d+)\)/gm;

	let match: RegExpExecArray | null;
	while ((match = regex.exec(clean))) {
		// for now, ignore the file. TODO: actually use the file path
		const [, sev, msg, line, ls, cs, le, ce] = match;

		const range = new vscode.Range(
			Number(ls) - 1,
			Number(cs) - 1,
			Number(le) - 1,
			Number(ce) - 1,
		);

		const severity =
			sev === 'Error'
				? vscode.DiagnosticSeverity.Error
				: vscode.DiagnosticSeverity.Warning;

		diagnostics.push(new vscode.Diagnostic(range, msg, severity));
	}

	return diagnostics;
}

/**
 * find elk and install or update if needed
 *
 * @param storagePath extension global storage path for caching install
 */
export async function resolveElk(
	storagePath: string,
): Promise<string | undefined> {
	// check for CLI
	const cliPath = getCliPath();

	if (cliPath) {
		const current = getCliVersion(cliPath);
		const latest = await getLatestVersion();

		if (current && isOutdated(current, latest)) {
			vscode.window.showWarningMessage(
				`A new version of Elk is available (${current} -> ${latest})`,
			);
		}

		return cliPath;
	}

	// check cached install
	const installDir = path.join(storagePath, 'bin');
	const cached = path.join(installDir, 'elk');

	if (fs.existsSync(cached)) {
		// check for update
		const current = getCliVersion(cached);
		const latest = await getLatestVersion();

		if (current && isOutdated(current, latest)) {
			const choice = await vscode.window.showWarningMessage(
				`A new version of Elk is available (${current} -> ${latest})`,
				'Update',
			);

			if (choice === 'Update') {
				return await installElk(installDir);
			}
		}

		return cached;
	}

	// prompt install
	const choice = await vscode.window.showErrorMessage(
		'Elk is not installed. Download latest version?',
		'Install',
	);

	if (choice !== 'Install') return undefined;

	return await installElk(installDir);
}

/**
 * install elk latest to a specified location
 *
 * @param installDir location to install elk
 */
export async function installElk(
	installDir: string,
): Promise<string | undefined> {
	if (!isSupportedPlatform()) {
		vscode.window.showErrorMessage('Elk only supports MacOS and Linux');
		return;
	}

	// get latest binary
	const asset = await getTargetBinary();
	if (!asset) return;

	// save binary
	vscode.window.showInformationMessage('Downloading Elk...');

	fs.mkdirSync(installDir, { recursive: true });

	const fileRes = await fetch(asset.browser_download_url);
	const buffer = await fileRes.arrayBuffer();

	const filePath = path.join(installDir, 'elk');
	fs.writeFileSync(filePath, Buffer.from(buffer));
	fs.chmodSync(filePath, 0o755);

	vscode.window.showInformationMessage(
		'Latest version of Elk has been installed',
	);

	return filePath;
}

/**
 * run elk on a file
 *
 * @param elkPath path to elk binary
 * @param file path to file to run on
 */
export async function runElk(elkPath: string, file: string) {
	const config = vscode.workspace.getConfiguration('lc3-elk-diagnostics');

	const level = config.get<string>('level', 'info');
	const traps = config.get<string>('traps', 'base');

	const flags = [
		'--check', // linting only
		'--quiet',
		level === 'err' && '--relaxed', // errors only
		traps === 'elci' && `--trap-aliases ${trapAliases()}`,
	]
		.filter(Boolean)
		.join(' ');

	const command = `"${elkPath}" "${file}" ${flags}`;

	const { stdout, stderr } = await execAsync(command);
	const output = stdout + stderr;

	return parse(output);
}

/**
 * build the string argument for the full list of elk trap aliases
 * includes elci integration
 */
export function trapAliases() {
	// prettier-ignore
	const trap_aliases = {
		// base LC-3
		getc:  0x20,
		out:   0x21,
		puts:  0x22,
		in:    0x23,
		putsp: 0x24,
		halt:  0x25,
		// debug extensions
		putn:  0x26,
		reg:   0x27,
		// ELCI integration
		chat:  0x28,
		getp:  0x29,
		setp:  0x2a,
		getb:  0x2b,
		setb:  0x2c,
		geth:  0x2d,
	};

	return Object.entries(trap_aliases)
		.map(([alias, vect]) => `${alias}=0x${vect.toString(16)}`)
		.join(',');
}

/**
 * check if the system OS and architecture is supported by elk
 */
export function isSupportedPlatform() {
	return ['darwin', 'linux'].includes(process.platform);
}

/**
 * check if a language is supported by elk
 *
 * @param lang language id
 */
export function isSupportedLanguage(lang: string) {
	return ['asm', 'lc3asm'].includes(lang);
}

/**
 * get the version of an installed elk binary
 *
 * @param bin path to binary
 */
export function getCliVersion(bin: string): string | undefined {
	try {
		const out = execSync(`"${bin}" --version 2>&1`).toString();
		return out.replace('elk:', '').trim();
	} catch {
		return undefined;
	}
}

/**
 * get the path to elk if it is in PATH
 */
export function getCliPath(): string | undefined {
	try {
		return execSync('which elk').toString().trim();
	} catch {
		return undefined;
	}
}

let latestRelease: any | undefined;
/**
 * get the latest release info for elk from github
 * cached to only request once per session
 */
export async function getLatestRelease(): Promise<any | undefined> {
	if (latestRelease) return latestRelease;

	try {
		const res = await fetch(RELEASES_URL);
		latestRelease = await res.json();
		return latestRelease;
	} catch {
		return undefined;
	}
}

/**
 * get the latest release binary supporting the system OS and architecture
 */
export async function getTargetBinary(): Promise<any | undefined> {
	// get latest release
	const release = await getLatestRelease();

	const platform = process.platform === 'darwin' ? 'macos' : process.platform;
	const arch = process.arch;

	// find supported binary
	let target = `elk-${platform}-${arch}`;
	const asset = release.assets.find((a: any) => a.name === target);

	if (!asset) {
		vscode.window.showErrorMessage(`No Elk binary found for ${target}`);
		return undefined;
	}

	return asset;
}

/**
 * get the version of the latest release
 */
export async function getLatestVersion(): Promise<string> {
	const json = await getLatestRelease();
	// 'v1.2.3-ver' -> '1.2.3'
	return json.tag_name.replace('v', '').split('-')[0];
}
