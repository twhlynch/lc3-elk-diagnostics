import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveElk, parse } from './elk';

export async function activate(context: vscode.ExtensionContext) {
	const collection = vscode.languages.createDiagnosticCollection('elk');
	context.subscriptions.push(collection);

	const elkPath = await resolveElk(context);
	if (!elkPath) return;

	const run = (doc: vscode.TextDocument) => {
		if (!['asm', 'lc3asm'].includes(doc.languageId)) return;

		// create temp file
		const tmp = path.join(os.tmpdir(), `elk-${Date.now()}.asm`);
		fs.writeFileSync(tmp, doc.getText());

		// run elk on temp file
		exec(`"${elkPath}" "${tmp}" --check --quiet`, (_, stdout, stderr) => {
			const output = (stdout || '') + (stderr || '');

			// get diagnostics
			const diags = parse(output);
			collection.set(doc.uri, diags);

			// remove temp file
			fs.unlinkSync(tmp);
		});
	};

	// debounced run
	let timeout: NodeJS.Timeout | undefined;
	const trigger = (doc: vscode.TextDocument) => {
		if (timeout) clearTimeout(timeout);
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
