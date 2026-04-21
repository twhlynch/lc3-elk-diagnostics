import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let collection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
	collection = vscode.languages.createDiagnosticCollection('elk');
	context.subscriptions.push(collection);

	let timeout: NodeJS.Timeout | undefined;

	const run = (doc: vscode.TextDocument) => {
		if (!['asm', 'lc3asm'].includes(doc.languageId)) {
			return;
		}

		// create temp file
		const tmp = path.join(os.tmpdir(), `elk-${Date.now()}.asm`);
		fs.writeFileSync(tmp, doc.getText());

		// run elk on temp file
		exec(`elk "${tmp}" --quiet`, (_, stdout, stderr) => {
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

	let match;
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

export function deactivate() {}
