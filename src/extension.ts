import * as vscode from 'vscode';
import { exec, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let collection: vscode.DiagnosticCollection;
let elkPath: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
	collection = vscode.languages.createDiagnosticCollection('elk');
	context.subscriptions.push(collection);

	elkPath = await resolveElk(context);

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
	try {
		const cliPath = execSync('which elk').toString().trim();
		if (cliPath) {
			return cliPath;
		}
	} catch {
		// ignore
	}

	// check cached install
	const installDir = path.join(context.globalStorageUri.fsPath, 'bin');
	const cached = path.join(installDir, 'elk');

	if (fs.existsSync(cached)) {
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
	const platform = process.platform.replace('darwin', 'macos'); // elk uses 'macos'
	const arch = process.arch;

	if (!['macos', 'linux'].includes(platform)) {
		vscode.window.showErrorMessage('Elk only supports macOS and Linux');
		return;
	}

	// get latest release
	const res = await fetch(
		'https://api.github.com/repos/dxrcy/elk/releases/latest',
	);

	const release: any = await res.json();

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

	vscode.window.showInformationMessage('Elk installed');

	return filePath;
}

export function deactivate() {}
