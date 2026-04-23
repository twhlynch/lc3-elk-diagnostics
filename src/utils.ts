import { exec } from 'child_process';
import * as path from 'path';
import * as os from 'os';

/**
 * strip ansi codes from a string
 *
 * @param input the string to clean
 */
export function stripAnsi(input: string): string {
	return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * get the full path to a unique temp file
 * uses timestamp and random to ensure uniqueness in parallel
 *
 * @param name base name for the file
 */
export function getTempFile(name: string) {
	const uniqueName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`;
	return path.join(os.tmpdir(), uniqueName);
}

/**
 * async wrapper for exec
 * resolves both stdout and stderr and rejects on error
 *
 * @param command the command to run
 */
export function execAsync(
	command: string,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		exec(command, (err, stdout, stderr) => {
			if (err && !stdout && !stderr) {
				return reject(err);
			}

			resolve({
				stdout: stdout ?? '',
				stderr: stderr ?? '',
			});
		});
	});
}

/**
 * compare two `X.X.X` formatted versions
 * returns true if the current one is older than the latest
 *
 * @param current currently installed version
 * @param latest latest release version
 */
export function isOutdated(current: string, latest: string): boolean {
	const a = current.split('.').map(Number);
	const b = latest.split('.').map(Number);

	for (let i = 0; i < 3; i++) {
		if ((a[i] || 0) < (b[i] || 0)) return true;
		if ((a[i] || 0) > (b[i] || 0)) return false;
	}

	return false;
}
