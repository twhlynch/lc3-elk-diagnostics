import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { stripAnsi } from './utils';
import { RELEASES_URL } from './config';

export function parse(output: string): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];

	// remove ansi codes
	const clean = stripAnsi(output);

	// example `Warning: Error Message (Line 1:0-1:10)`
	const regex =
		/^(Error|Warning):\s+(.*?)\s+\(Line (\d+):(\d+)-(\d+):(\d+)\)/gm;

	let match: RegExpExecArray | null;
	while ((match = regex.exec(clean))) {
		const [, sev, msg, ls, cs, le, ce] = match;

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

export async function resolveElk(
	context: vscode.ExtensionContext,
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
	const installDir = path.join(context.globalStorageUri.fsPath, 'bin');
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

export async function installElk(
	installDir: string,
): Promise<string | undefined> {
	const platform = process.platform === 'darwin' ? 'macos' : process.platform;
	const arch = process.arch;

	if (!['macos', 'linux'].includes(platform)) {
		vscode.window.showErrorMessage('Elk only supports MacOS and Linux');
		return;
	}

	// get latest release
	const release = await getLatestRelease();

	// find supported binary
	let target = `elk-${platform}-${arch}`;
	const asset = release.assets.find((a: any) => a.name === target);

	if (!asset) {
		vscode.window.showErrorMessage(`No Elk binary found for ${target}`);
		return;
	}

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

export function getCliVersion(bin: string): string | undefined {
	try {
		const out = execSync(`"${bin}" --version 2>&1`).toString();
		return out.replace('elk:', '').trim();
	} catch {
		return undefined;
	}
}

export function getCliPath(): string | undefined {
	try {
		return execSync('which elk').toString().trim();
	} catch {
		return undefined;
	}
}

let latestRelease: any | undefined;
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

export async function getLatestVersion(): Promise<string> {
	const json = await getLatestRelease();
	// 'v1.2.3-ver' -> '1.2.3'
	return json.tag_name.replace('v', '').split('-')[0];
}

export function isOutdated(current: string, latest: string): boolean {
	const a = current.split('.').map(Number);
	const b = latest.split('.').map(Number);

	for (let i = 0; i < 3; i++) {
		if ((a[i] || 0) < (b[i] || 0)) return true;
		if ((a[i] || 0) > (b[i] || 0)) return false;
	}

	return false;
}
