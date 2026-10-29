# Private Operator Probe Qualification

**Goal:** Read readiness and the retained job through an authenticated private service binding before considering another hosted rehearsal.

**Constraints:** No webhook, public route, target workers.dev URL, container execution, enqueue, deployment or fresh admission window. Preserve the consumed session and unrelated research. Keep all Effect lint rules.

- [x] Test the operator contract first: compare the full desired policy, decode bounded status, reject missing RPCs, enforce deadlines, and never call admission.
- [x] Reuse the pinned Alchemy runtime's scoped platform proxy and local service binding; qualify native loopback RPC and cleanup.
- [x] Assess the remote-preview branch, record its qualification failure and remove the unqualified remote entrypoint. Do not claim a hosted pass against the old deployed Worker.
- [x] Verify infrastructure tests, all typechecks, lint/format and review the narrowed diff before committing only this slice.

The deployed source predates readiness. A separately approved private target update and successful desired-policy comparison remain prerequisites for another hosted rehearsal. Qualification here must not silently perform that update.

## Execution Record

Baseline: all 12 typechecks and root lint/format passed. Unrelated observer research was preserved.

RED: after establishing the module/export, five behavior assertions failed against an empty implementation. GREEN: full desired-policy comparison, bounded strict status decoding, fixed RPC calls and cooperative deadlines passed. The added 100-case property reported Passed.

Native qualification: actual pinned workerd local service-binding RPC passed, with no remote credentials; after scope disposal its fixture socket refused connections. The fixture uses the runtime's supported 2026-08-31 compatibility date, not the deployed Worker's newer date. This is local transport evidence, not hosted Worker/DO evidence.

Independent review found two hosted blockers: preview acquisition uploads executable code (outside this no-deployment slice), and the pinned remote plugin uses a detached acquisition fiber. The proposed remote entrypoint was removed; the retained transport constructs only Service.local. No credential or cloud resource was accessed. The runbook records the exact next fix and required operational scope.

Final verification: 64 infrastructure tests, 224 assertions, all 12 workspace typechecks, root lint/format and diff whitespace checks passed. Independent follow-up review found no blockers in the narrowed local-only code. Native acquisition-failure/timeout cleanup and independent proxy-endpoint teardown remain unverified; the closed-socket assertion covers the fixture. Hosted transport has not qualified, and no hosted operation was performed. Commit contains only the operator contract, local transport/tests, direct pinned dependency and documentation; unrelated research stays unstaged.
