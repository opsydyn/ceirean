import { App, type Octokit } from 'octokit';

export interface GitHubCredentials {
	appId: string;
	privateKey: string;
}

/**
 * The two fields of the Worker environment this module actually reads.
 *
 * Upstream types this as `WorkerEnv` from `../env.ts`, which imports every
 * capability coordinator and contract in the factory. Structural typing makes
 * that unnecessary: narrowing the parameter here is what lets these twelve
 * files be vendored without the other thirty-six.
 */
export interface GitHubAppEnv {
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}

export type InstallationClient = Octokit;

export function credentialsFromWorkerEnv(env: GitHubAppEnv): GitHubCredentials {
	return {
		appId: requiredValue('GITHUB_APP_ID', env.GITHUB_APP_ID),
		privateKey: normalizePrivateKey(
			requiredValue('GITHUB_APP_PRIVATE_KEY', env.GITHUB_APP_PRIVATE_KEY),
		),
	};
}

export function credentialsFromProcess(): GitHubCredentials {
	return {
		appId: requiredProcessEnv('GITHUB_APP_ID'),
		privateKey: normalizePrivateKey(
			requiredProcessEnv('GITHUB_APP_PRIVATE_KEY'),
		),
	};
}

export async function createInstallationClient(
	credentials: GitHubCredentials,
	installationId: number,
): Promise<InstallationClient> {
	const app = new App({
		appId: credentials.appId,
		privateKey: credentials.privateKey,
	});
	return app.getInstallationOctokit(installationId);
}

/**
 * Mint a short-lived installation token scoped down to the given permissions.
 * Used when a raw token string must leave trusted code briefly (e.g. one git
 * push command); never request more scope than that single use needs.
 */
export async function createScopedInstallationToken(
	credentials: GitHubCredentials,
	installationId: number,
	permissions: {
		contents?: 'read' | 'write';
		issues?: 'read' | 'write';
		metadata?: 'read';
	},
): Promise<string> {
	const app = new App({
		appId: credentials.appId,
		privateKey: credentials.privateKey,
	});
	const response = await app.octokit.rest.apps.createInstallationAccessToken({
		installation_id: installationId,
		permissions,
	});
	return response.data.token;
}

export function requiredProcessEnv(name: string): string {
	return requiredValue(name, process.env[name]);
}

function requiredValue(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`${name} is required.`);
	}
	return value;
}

function normalizePrivateKey(value: string): string {
	return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}
