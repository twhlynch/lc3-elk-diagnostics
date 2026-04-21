import * as vscode from 'vscode';
import { exec, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const RELEASES_URL = 'https://api.github.com/repos/dxrcy/elk/releases/latest';

export async function activate(context: vscode.ExtensionContext) {
	const collection = vscode.languages.createDiagnosticCollection('elk');
	context.subscriptions.push(collection);

	const elkPath = await resolveElk(context);

	let timeout: NodeJS.Timeout | undefined;

	const run = (doc: vscode.TextDocument) => {
		if (!elkPath) {
			return;
		}
		if (!['asm', 'lc3asm'].includes(doc.languageId)) {
			return;
		}

		// create temp file
		const tmp = path.join(os.tmpdir(), `elk-${Date.now()}.asm`);
		fs.writeFileSync(tmp, doc.getText());

		// run elk on temp file
		exec(`"${elkPath}" "${tmp}" --quiet`, (_, stdout, stderr) => {
			const output = (stdout || '') + (stderr || '');

			// get diagnostics
			const diags = parse(output);
			collection.set(doc.uri, diags);

			fs.unlinkSync(tmp);
		});
	};

	// debounced run
	const trigger = (doc: vscode.TextDocument) => {
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => run(doc), 400);
	};

	// trigger events
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => trigger(e.document)),
		vscode.workspace.onDidSaveTextDocument(run),
		vscode.workspace.onDidOpenTextDocument(run),
	);

	// immediately run on open editors
	for (const editor of vscode.window.visibleTextEditors) {
		run(editor.document);
	}
}

export function deactivate() {}

function parse(output: string): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];

	// remove ansi codes
	const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

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

async function resolveElk(
	context: vscode.ExtensionContext,
): Promise<string | undefined> {
	// check for CLI
	const cliPath = getCliPath();

	if (cliPath) {
		const current = getCliVersion(cliPath);

		const latest = await getLatestVersion();

		console.log('ELK', current, 'ELK', latest);
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

	if (choice !== 'Install') {
		return undefined;
	}

	return await installElk(installDir);
}

async function installElk(installDir: string): Promise<string | undefined> {
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

function getCliVersion(bin: string): string | undefined {
	try {
		const out = execSync(`"${bin}" --version 2>&1`).toString();
		return out.replace('elk:', '').trim();
	} catch {
		return undefined;
	}
}

function getCliPath(): string | undefined {
	try {
		return execSync('which elk').toString().trim();
	} catch {
		return undefined;
	}
}

let latestRelease: any | undefined;
async function getLatestRelease(): Promise<any | undefined> {
	if (latestRelease) {
		return latestRelease;
	}

	try {
		const res = await fetch(RELEASES_URL);
		latestRelease = await res.json();
		return latestRelease;
	} catch {
		return undefined;
	}
}

async function getLatestVersion(): Promise<string> {
	const json = await getLatestRelease();
	return json.tag_name.replace('v', '');
}

function isOutdated(current: string, latest: string): boolean {
	const a = current.split('.').map(Number);
	const b = latest.split('.').map(Number);

	for (let i = 0; i < 3; i++) {
		if ((a[i] || 0) < (b[i] || 0)) {
			return true;
		}
		if ((a[i] || 0) > (b[i] || 0)) {
			return false;
		}
	}
	return false;
}
