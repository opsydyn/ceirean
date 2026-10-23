# Native Worker Setup: Compatibility Gate Blocked

## Decision And Scope

**STOP (2026-10-23):** no supported zero-host-sharing Colima path has been
established in the inspected versions under the approved Docker socket endpoint
design. Task 2's research gate is evaluated with a Blocked outcome; setup is not
qualified and no concrete setup lock exists. Stop this implementation plan after
verified Task 1. Tasks 3-4 are not executable.

This is a bounded source-based finding, not a claim that every Colima release,
future release, or Lima mechanism is incapable of zero sharing. The requirement
remains zero host directory shares, including read-only caches. No weaker policy,
fork, infrastructure change or activation is approved by this decision.

The controller supplied primary-source research in
`.superpowers/sdd/2026-10-23-native-worker-readiness/task-2-research.md`.
This documentation task consumes that research without repeating exploration,
fetching repositories or inspecting the host. Task 1 at `044c0c2` corrects empty
mounts to Unknown with UnknownConfiguration; regression, property and process
tests passed and independent review approved it. That is local/synthetic evidence,
not installed-version or native isolation proof. Controller full-repository
verification is separate and is not claimed complete by this assessment.

## Source Findings

| Primary source                                                                                                                         | Finding and boundary                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Colima v0.8.1 YAML generation, lines 290-324](https://github.com/abiosoft/colima/blob/v0.8.1/environment/vm/lima/yaml.go#L290-L324)   | Empty mounts select writable home and profile temp defaults. Custom mounts add a read-only cache share; suppressing that cache requires a supplied mount covering it, which is itself host sharing. Neither branch establishes zero shares.    |
| [Colima v0.8.1 socket forwarding, lines 194-213](https://github.com/abiosoft/colima/blob/v0.8.1/environment/vm/lima/yaml.go#L194-L213) | The approved endpoint design needs guest `/var/run/docker.sock` forwarded to the controller HostSocket. Removing shares must preserve this controller transport, without exposing a Docker socket to the worker container.                     |
| [Colima v0.8.1 Lima lifecycle](https://github.com/abiosoft/colima/blob/v0.8.1/environment/vm/lima/lima.go)                             | New derives LIMA_HOME from config.LimaDir; start generates YAML before `limactl start --tty=false`, and resume regenerates configuration. Hand edits to generated configuration are not a durable supported mechanism.                         |
| [Colima v0.8.1 mount flag parsing, lines 216-236](https://github.com/abiosoft/colima/blob/v0.8.1/cmd/start.go#L216-L236)               | Every mount flag item is treated as a location. `--mount=none` is not a disabling sentinel in this version.                                                                                                                                    |
| [Colima v0.10.1 YAML generation, lines 348-381](https://github.com/abiosoft/colima/blob/v0.10.1/environment/vm/lima/yaml.go#L348-L381) | Nil and empty are distinguished, but cache sharing is still appended for nil/custom paths. Empty/null spelling or upgrading to this inspected release alone does not establish zero effective shares.                                          |
| [Lima v1.0.0 overlay documentation, lines 498-528](https://github.com/lima-vm/lima/blob/v1.0.0/templates/default.yaml#L498-L528)       | Overlay slices combine rather than replace; mount writability merges by location. An empty global override is not evidence that emitted Colima shares disappear. This is a documentation reference, not an installed Lima version observation. |
| [Lima plain-mode FAQ](https://lima-vm.io/docs/faq/#is-it-possible-to-disable-mounts-port-forwarding-containerd-etc-)                   | Plain mode ignores mounts and forwarding and disables the guest agent. It is not a drop-in solution for the required controller Unix Docker socket forwarding.                                                                                 |
| [Lima Docker example](https://lima-vm.io/docs/examples/containers/docker/)                                                             | Direct Lima with Docker and an explicit Unix host socket is a candidate for separate assessment, not a selected or qualified architecture. The example establishes no installed executable or image identity.                                  |
| [Colima v0.8.1 version command](https://github.com/abiosoft/colima/blob/v0.8.1/cmd/version.go)                                         | `colima version` enters application runtime code; it is not an approved client-only substitute. No clients were executed for this assessment.                                                                                                  |

## What Remains Unknown

The earlier [host preflight](colima-readiness.md) recorded executable symlink
names suggesting Colima 0.8.1 and Docker 27.5.1, not qualified executable versions.
Source review against those tags is not proof of the installed bytes, actual
effective generated YAML, global/default overlays, cache mount inventory, agent
or credential inheritance. None of those native/installed facts was newly read
or verified here. No credentials or operational data were inspected.

Empty arrays, omitted/null values and `none` cannot be promoted to Disabled from
input spelling or version text. Overlays have no reviewed effective removal proof;
plain mode loses required forwarding; manually editing generated YAML would be
regenerated on lifecycle transitions and lacks an approved supported path. None
is an approved workaround. No actual configuration was edited to test one.

## Finite Blocker And Missing Lock

**Compatibility blocker:** the inspected Colima generation/lifecycle paths do not
establish zero effective host shares while retaining the approved controller
socket transport. A reviewed, version-specific supported mechanism and later
effective native verification would be required to clear this blocker. Source
review alone would still not qualify setup or grant activation authority.

Lock resolution stopped at this blocker. These fields are authentically missing,
not fixture values to copy into a placeholder manifest:

| Required lock field                                                                                       | Actual status                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Exact Colima/Lima/Docker executable paths and digests, versions, client-only argv                         | Unresolved; symlink names and source tags are insufficient.                                                                         |
| Supported no-sharing mechanism and effective configuration/overlay, cache, agent and credential semantics | Blocked by the compatibility finding; installed/native behavior unverified.                                                         |
| VM image source, native architecture and immutable digest                                                 | Unresolved; no retrieval or VM startup.                                                                                             |
| Ceirean-owned diagnostic container source and arm64 manifest digest                                       | Unresolved; no image pull/build. The [official Playwright image](https://playwright.dev/docs/docker) remains only a candidate base. |
| Exact Playwright package and browser build, non-root execution, sandbox qualification                     | Unresolved; no browser or container execution.                                                                                      |
| Reviewed seccomp bytes and digest                                                                         | Unresolved; no guessed policy identity.                                                                                             |
| Worker Bun 1.3.11, compatible exact Node 22 and Git; DiagnosticOnly versus replay suitability             | Not evaluated after STOP; controller Bun 1.4.2 is not a substitute.                                                                 |
| VM allocation, fresh bounded headroom, declared host reserve and approved measurement argv                | Unresolved; old free pages and physical RAM do not authorize allocation. No new host observation.                                   |
| Exact preparation argv and finite download/build/disk/time/cleanup bounds                                 | Unresolved; no preparation recipe or authority.                                                                                     |
| Authentic daemon/resource identities, activation manifest and bound approval                              | Absent; cannot be fabricated before separately approved setup.                                                                      |

## Recommendation And Re-entry

Recommend a separately scoped **direct Lima + Docker assessment**, preserving
zero sharing and the existing engine, operational ledger and XState architecture.
It is not selected or implemented here. Obtain owner approval for that assessment
before changing the approved Colima boundary; do not begin executor work, loosen
sharing policy or maintain a fork as an implicit fallback.

Any re-entry must resolve the compatibility decision, authentic setup lock and
exact downstream file/interface/test/argv briefs, then obtain review and owner
approval. Retrieval, preparation, diagnostics and replay retain separate authority
gates. No image retrieval, install, upgrade, client/daemon/VM/model use,
credentials/operational reads or activation occurred in this task. No native
worker is qualified and replay remains blocked.
