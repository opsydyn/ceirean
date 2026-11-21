/**
 * Regression tests for the workspace layout that let a reproduction step
 * destroy the checkout it was supposed to produce a fix in.
 *
 * The reproduce skill used to say `rm -rf <triageDir>/.git`, with `triageDir`
 * a relative path inside `/repo`. An agent that resolved that placeholder to
 * the checkout deleted `/repo/.git`, and the run died at push time with
 * "not a git repository" after the fix had already been written.
 *
 * Upstream this file also asserts two properties of the bundled triage skill
 * markdown: that it never tells the agent to delete a `.git` directory, and
 * that it never points the scratch directory at a checkout-relative path.
 * Those cases are dropped here because `skills/triage/` is not vendored — our
 * agent skill is our own, written in Effect. Both assertions must be
 * reproduced against our skill when we write it; they encode a real incident,
 * not a style preference.
 */

import { describe, expect, it } from 'bun:test';
import { REPO_DIR, TRIAGE_DIR } from '../src/triage/sandbox-utils.ts';

describe('triage scratch directory', () => {
	it('is a sibling of the checkout, never nested inside it', () => {
		expect(TRIAGE_DIR.startsWith('/')).toBe(true);
		expect(TRIAGE_DIR.startsWith(`${REPO_DIR}/`)).toBe(false);
		expect(TRIAGE_DIR).not.toBe(REPO_DIR);
	});
});
