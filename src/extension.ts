import * as vscode from 'vscode';
import * as fs from 'fs';
import { isSupportedLanguage, resolveElk, runElk } from './elk';
import { getTempFile } from './utils';
import { DEBOUNCE_TIME } from './config';

/**
 * extension entrypoint
 * runs once to setup events and diagnostics collection
 */
export async function activate(context: vscode.ExtensionContext) {
	const collection = vscode.languages.createDiagnosticCollection('elk');
	context.subscriptions.push(collection);

	const elkPath = await resolveElk(context.globalStorageUri.fsPath);
	if (!elkPath) return;

	const run = async (doc: vscode.TextDocument) => {
		if (!isSupportedLanguage(doc.languageId)) return;

		// create temp file
		const file = getTempFile(`elk.asm`);
		fs.writeFileSync(file, doc.getText());

		// get diagnostics
		const diags = await runElk(elkPath, file);
		collection.set(doc.uri, diags);

		// remove temp file
		fs.unlinkSync(file);
	};

	// debounced run
	let timeout: NodeJS.Timeout | undefined;
	const trigger = (doc: vscode.TextDocument) => {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => run(doc), DEBOUNCE_TIME);
	};

	// trigger events
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => trigger(e.document)),
		vscode.workspace.onDidSaveTextDocument(run),
		vscode.workspace.onDidOpenTextDocument(run),
		vscode.window.onDidChangeActiveTextEditor((e) => {
			if (e?.document) run(e.document);
		}),
	);

	// update when changing settings
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration('lc3-elk-diagnostics.level') ||
				e.affectsConfiguration('lc3-elk-diagnostics.traps') ||
				e.affectsConfiguration('lc3-elk-diagnostics.permit')
			) {
				for (const editor of vscode.window.visibleTextEditors) {
					run(editor.document);
				}
			}
		}),
	);

	// immediately run on open editors
	for (const editor of vscode.window.visibleTextEditors) {
		run(editor.document);
	}
}

/**
 * cleanup on extension unload
 * called when the extension is deactivated or reloaded
 */
export function deactivate() {}
