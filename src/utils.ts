export function stripAnsi(input: string): string {
	return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
