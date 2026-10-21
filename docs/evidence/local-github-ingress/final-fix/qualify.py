"""Bounded final-fix qualification. Python packages evidence; Bun runs application tests."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile

BASE = '36de5ba28e8921952c26a2fb6e7c9728bd305a3d'
ROOT = Path('docs/evidence/local-github-ingress')
OUT = ROOT / 'final-fix'
RAW = OUT / 'raw'
WORKSPACES = ['domain', 'engine', 'probe', 'github-admission', 'github-adapter', 'github-ingress']
ENV = {key: os.environ[key] for key in ['PATH', 'HOME', 'TMPDIR'] if key in os.environ}
CONTROLS = {
    'evidence': ('EvidenceBinding', 'packages/github-adapter/src/live-sqlite-storage.ts', 'packages/github-adapter/tests/live-sqlite-inbox.test.ts', 'active replay refuses', '"Duplicate"', '"InvalidData"'),
    'policy': ('PolicyRevision', 'packages/github-adapter/src/live-sqlite-inbox.ts', 'packages/github-adapter/tests/live-sqlite-inbox.test.ts', 'commit rechecks local revision', '"Installed"', '"AuthorityChanged"'),
    'replay': ('ReplayUniqueness', 'packages/github-adapter/src/live-sqlite-inbox.ts', 'packages/github-adapter/tests/live-sqlite-inbox.test.ts', 'strict init/open', '"Absent"', '"Duplicate"'),
    'rollback': ('TransactionRollback', 'packages/github-adapter/src/live-sqlite-inbox.ts', 'packages/github-adapter/tests/live-sqlite-inbox.test.ts', 'final clock barrier after writes', '"decisions": 1', '"decisions": 0'),
    'abort': ('AbortOwnership', 'apps/github-ingress/src/listener.ts', 'apps/github-ingress/tests/listener.test.ts', 'eight-second outcome', 'Received: true', 'Expected: false'),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def command(*args):
    return subprocess.check_output(args, env=ENV).decode().strip()


def run(identity, args):
    RAW.mkdir(exist_ok=True)
    (RAW / f'{identity}.command').write_text(shlex.join(args) + '\n')
    with (RAW / f'{identity}.log').open('wb') as output:
        code = subprocess.run(args, env=ENV, stdout=output, stderr=subprocess.STDOUT).returncode
    (RAW / f'{identity}.exit').write_text(str(code) + '\n')
    print(f'{identity}: exit {code}', flush=True)
    return code


def files_now():
    tracked = command('git', 'ls-files', '-z').split('\0')
    paths = sorted(path for path in tracked if path and not path.startswith(('docs/', '.superpowers/')) and not path.endswith('.md'))
    return {path: sha(Path(path).read_bytes()) for path in paths}


def audit():
    old = read_json(ROOT / 'task-7/source.json')
    current = files_now()
    assert len(old['files']) == 166
    assert set(old['files']).issubset(current)
    unchanged = ['bun.lock', 'package.json', 'oxlint.config.ts', '.prototools']
    unchanged += [path for path in old['files'] if path.startswith(('patches/', '.moon/')) or path.endswith(('package.json', 'tsconfig.json', 'moon.yml'))]
    for path in unchanged:
        assert current[path] == old['files'][path], f'Pin/config drift: {path}'
    script = """import config from './oxlint.config.ts';
const workspaces = ['packages/domain','packages/engine','probes/bun-effect-flue','probes/github-admission','packages/github-adapter','apps/github-ingress'];
const physical = await Promise.all(workspaces.map(async path => {
  const resolved = Bun.resolveSync('effect/package.json', `${process.cwd()}/${path}`);
  const file = Bun.file(resolved); const manifest = await file.json();
  if (manifest.version !== '4.0.5') throw new Error('Effect version');
  return resolved;
}));
const rules = Object.entries(config.rules).filter(([name]) => name.startsWith('linteffect/'));
if (rules.length !== 141 || rules.some(([,v]) => (Array.isArray(v) ? v[0] : v) !== 'error')) throw new Error('Rules');
console.log(JSON.stringify({physical, rules: Object.fromEntries(rules)}));"""
    runtime = json.loads(command('bun', '--no-env-file', '--no-install', '-e', script))
    physical = [str(Path(path).resolve()) for path in runtime['physical']]
    assert len(set(physical)) == 1
    graph = {}
    for path in current:
        if '/src/' not in path or not path.endswith('.ts'):
            continue
        text = Path(path).read_text()
        imports = re.findall(r"(?:from\s+|import\s*)['\"]([^'\"]+)", text)
        graph[path] = imports
        if path.startswith(('apps/', 'packages/')):
            assert not any(name.startswith(('node:', '@octokit', 'hono')) for name in imports), path
        if path.startswith(('apps/github-ingress/', 'packages/github-adapter/')):
            assert not re.search(r'process\s*(?:\.|\[\s*[\'\"])env|(?:Effect\.Effect|Layer\.Layer)\s*<', text), path
        if path.startswith('apps/github-ingress/'):
            assert not re.search(r'Effect\.run|Layer\.launch|Effect\.provide', text), path
    owners = [path for path in graph if path.startswith('apps/github-ingress/') and 'ManagedRuntime.make' in Path(path).read_text()]
    assert owners == ['apps/github-ingress/src/composition.ts']
    return {'originalFiles': 166, 'filesVerified': len(current), 'newFiles': sorted(set(current) - set(old['files'])), 'physicalEffect': physical, 'rules': runtime['rules'], 'graph': graph, 'runtimeOwners': owners, 'pinsUnchanged': sorted(set(unchanged))}


def freeze():
    measured = audit()
    files = files_now()
    source = {'base': BASE, 'tree': command('git', 'write-tree'), 'filesHash': sha(json.dumps(files, separators=(',', ':')).encode()), 'lockHash': files['bun.lock'], 'files': files, 'audit': measured}
    write_json(OUT / 'source.json', source)
    print(json.dumps({key: source[key] for key in ['base', 'tree', 'filesHash', 'lockHash']}))


def verify_source():
    source = read_json(OUT / 'source.json')
    assert files_now() == source['files'], 'Frozen source changed'
    measured = audit()
    print(json.dumps(measured, indent=2))


def control(identity, phase):
    name, path, test, pattern, observed, intended = CONTROLS[identity]
    source = read_json(OUT / 'source.json')
    before = source['files'][path]
    current = sha(Path(path).read_bytes())
    if phase.startswith('red'):
        assert current != before
    else:
        assert current == before
    write_json(RAW / f'{identity}-{phase}-binding.json', {'name': name, 'path': path, 'test': test, 'testHash': sha(Path(test).read_bytes()), 'beforeHash': before, 'currentHash': current, 'sourceHash': source['filesHash']})
    args = ['bun', '--no-env-file', '--no-install', 'test', test, '--timeout', '30000', '--test-name-pattern', pattern]
    code = run(f'{identity}-{phase}', args)
    log = (RAW / f'{identity}-{phase}.log').read_text()
    if phase.startswith('red'):
        assert code == 1 and '1 fail' in log and observed in log and intended in log, name
    else:
        assert code == 0 and '1 pass' in log and '0 fail' in log, name


def gates():
    verify_source()
    commands = [('install', ['bun', 'install', '--frozen-lockfile', '--ignore-scripts']), ('check', ['bun', 'run', 'check'])]
    commands += [(f'{workspace}-typecheck', ['moon', 'run', f'{workspace}:typecheck', '--force', '--no-actions']) for workspace in WORKSPACES]
    commands += [(f'{workspace}-test', ['moon', 'run', f'{workspace}:test', '--force', '--no-actions']) for workspace in WORKSPACES]
    commands += [('whitespace', ['git', 'diff', '--check']), ('staged-whitespace', ['git', 'diff', '--cached', '--check']), ('integrity', ['python3', str(OUT / 'qualify.py'), 'verify-source'])]
    for identity, args in commands:
        if run(f'final-{identity}', args) != 0:
            raise SystemExit(f'Stopped at {identity}; no dependent gate run')


def tar_bytes(members):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', mtime=0, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(members.items()):
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                entry.mode = 0o644
                archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


def archive_members(data):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        entries = archive.getmembers()
        assert all(entry.isfile() or entry.isdir() for entry in entries), 'Unexpected link/special member'
        regular = [entry for entry in entries if entry.isfile()]
        assert len({entry.name for entry in regular}) == len(regular), 'Duplicate tar member'
        return {entry.name: archive.extractfile(entry).read() for entry in regular}, [entry.name for entry in entries if entry.pax_headers]


def check_archive(index):
    data = Path(index['archive']).read_bytes()
    assert sha(data) == index['sha256']
    members, xattrs = archive_members(data)
    assert not xattrs, xattrs
    assert set(members) == {entry['path'] for entry in index['members']}, 'Unexpected regular members'
    assert not any(Path(name).name.startswith('._') for name in members)
    for entry in index['members']:
        assert len(members[entry['path']]) == entry['bytes'] and sha(members[entry['path']]) == entry['sha256'], entry['path']
    return members


def repackage():
    report = []
    for filename in ['accepted-tasks-1-6-index.json', 'task-7-raw-index.json']:
        path = ROOT / filename
        index = read_json(path)
        old = Path(index['archive']).read_bytes()
        members, headers = archive_members(old)
        expected = {entry['path'] for entry in index['members']}
        extras = set(members) - expected
        assert all(Path(name).name.startswith('._') and members[name][:4] == b'\x00\x05\x16\x07' for name in extras)
        selected = {name: data for name, data in members.items() if name in expected}
        assert set(selected) == expected
        for entry in index['members']:
            assert sha(selected[entry['path']]) == entry['sha256']
        # Retain every indexed historical byte, including the nested Task 6 archive.
        nested = []
        for name, data in selected.items():
            if name.endswith('.tar.gz'):
                contents, nested_headers = archive_members(data)
                metadata = [member for member in contents if Path(member).name.startswith('._')]
                nested.append({'path': name, 'sha256': sha(data), 'regularMembers': len(contents), 'appleDoubleMembers': len(metadata), 'paxHeaderMembers': nested_headers, 'preservedByteIdentity': True, 'classification': 'HistoricalArtifactException' if metadata or nested_headers else 'InspectedNoMetadata'})
        Path(index['archive']).write_bytes(tar_bytes(selected))
        index['previousOuterSha256'] = sha(old)
        index['sha256'] = sha(Path(index['archive']).read_bytes())
        index['regularMembers'] = len(selected)
        index['unexpectedRegularMembers'] = 0
        index['packaging'] = 'USTAR payload-only; no AppleDouble, PAX or filesystem xattrs'
        write_json(path, index)
        check_archive(index)
        report.append({'index': str(path), 'previousSha256': sha(old), 'sha256': index['sha256'], 'removedAppleDouble': len(extras), 'indexedPayloadsPreserved': len(selected), 'nested': nested})
    archive = ROOT / 'docs-verification.tar.gz'
    old = archive.read_bytes()
    members, _ = archive_members(old)
    selected = {name: data for name, data in members.items() if not Path(name).name.startswith('._')}
    archive.write_bytes(tar_bytes(selected))
    index = {'archive': str(archive), 'sha256': sha(archive.read_bytes()), 'members': [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(selected.items())], 'previousOuterSha256': sha(old), 'unexpectedRegularMembers': 0}
    write_json(ROOT / 'docs-verification-index.json', index)
    check_archive(index)
    report.append({'archive': str(archive), 'previousSha256': sha(old), 'sha256': index['sha256'], 'removedAppleDouble': len(members) - len(selected), 'indexedPayloadsPreserved': len(selected)})
    write_json(OUT / 'archive-repackaging.json', report)


def manifest():
    source = read_json(OUT / 'source.json')
    commit = command('git', 'rev-parse', 'HEAD')
    assert command('git', 'rev-parse', f'{commit}^{{tree}}') == source['tree']
    old_manifest = read_json(OUT / 'historical-b7-manifest.json')
    def raw(identity):
        data = (RAW / f'{identity}.log').read_bytes()
        return {'exit': int((RAW / f'{identity}.exit').read_text()), 'logHash': sha(data)}, data.decode()
    gates_result = []
    for identity in ['install', 'check'] + [f'{workspace}:{phase}' for phase in ['typecheck', 'test'] for workspace in WORKSPACES] + ['whitespace', 'integrity']:
        result, _ = raw('final-' + identity.replace(':', '-'))
        assert result['exit'] == 0
        gates_result.append({'id': identity, **result, 'sourceHash': source['filesHash']})
    suites = []
    for workspace in WORKSPACES:
        _, log = raw(f'final-{workspace}-test')
        values = [int(re.search(pattern, log, re.M)[1]) for pattern in [r'^\s*(\d+) pass$', r'^\s*(\d+) fail$', r'^\s*(\d+) expect\(\) calls$']]
        suites.append(dict(zip(['workspace', 'passed', 'failed', 'assertions'], [workspace] + values)))
    controls = []
    bindings = []
    for identity, (name, path, test, pattern, observed, intended) in CONTROLS.items():
        reds = []
        mutations = []
        for round_number in [1, 2]:
            result, log = raw(f'{identity}-red-{round_number}')
            assert result['exit'] == 1 and observed in log and intended in log and '1 fail' in log
            bound = read_json(RAW / f'{identity}-red-{round_number}-binding.json')
            assert bound['sourceHash'] == source['filesHash'] and bound['testHash'] == source['files'][test]
            mutations.append(bound['currentHash'])
            reds.append({**result, 'reason': name})
        assert mutations[0] == mutations[1] != source['files'][path]
        green, _ = raw(f'{identity}-green')
        bound = read_json(RAW / f'{identity}-green-binding.json')
        assert green['exit'] == 0 and bound['currentHash'] == source['files'][path]
        controls.append({'name': name, 'beforeHash': source['files'][path], 'mutatedHash': mutations[0], 'restoredHash': bound['currentHash'], 'red': reds, 'green': green})
        bindings.append({'name': name, 'path': path, 'test': test, 'testHash': source['files'][test], 'logPrefix': identity})
    totals = {key: sum(suite[key] for suite in suites) for key in ['passed', 'failed', 'assertions']}
    for workspace, prefix, count in [('domain', 'live domain law:', 4), ('engine', 'live engine law:', 12)]:
        _, log = raw(f'final-{workspace}-test')
        assert len(re.findall(r'^\(pass\) ' + prefix, log, re.M)) == count
    qualification = {'source': {key: value for key, value in {'commit': commit, 'tree': source['tree'], 'filesHash': source['filesHash'], 'lockHash': source['lockHash']}.items()}, 'gates': gates_result, 'suites': suites, 'totals': totals, 'laws': {'newPrimary': 24000, 'legacyPrimary': 168000, 'shrinks': 0}, 'controls': controls, 'live': False, 'deployed': False}
    history = read_json(ROOT / 'accepted-tasks-1-6-index.json')
    result = {**old_manifest, 'status': 'Tasks1Through7AcceptedWholeBranchPendingFinalFixReview', 'acceptedTasks': list(range(1, 8)), 'localQualification': qualification, 'sourceInventory': 'local-github-ingress/final-fix/source.json', 'rawLogs': {'archive': 'local-github-ingress/final-fix/raw.tar.gz', 'memberRoot': 'raw/', 'sourceCommit': commit}, 'historicalArchive': {'path': 'local-github-ingress/accepted-tasks-1-6.tar.gz', 'sha256': history['sha256'], 'byteComparedMembers': history['byteCompared'], 'index': 'local-github-ingress/accepted-tasks-1-6-index.json'}, 'historicalQualification': {'manifest': 'local-github-ingress/final-fix/historical-b7-manifest.json', 'sourceCommit': old_manifest['localQualification']['source']['commit'], 'classification': 'HistoricalOnlyNotEvidenceForChangedSource'}, 'controlBindings': bindings, 'review': {'task7': 'AcceptedByController', 'wholeBranch': 'PendingScopedFinalFixReview', 'integration': 'NotAuthorized'}, 'limitations': ['Task 5 initial TDD gap retained', 'Task 6 TDD excerpts remain summaries, not raw gate logs', 'Historical nested Task 6 archive preserves original bytes including inspected metadata', 'Moon update notices retained; no tool upgrade', 'No live API, credentials, tunnel, push, merge or deployment', 'M2 corrected law is coverage characterization, not a demonstrated production-ordering bug', 'Supplied-data qualification validator is not attestation', 'Reviewer Declined To Judge boundaries remain in final-fix ledger, not runtime waivers']}
    write_json('docs/evidence/local-github-ingress.json', result)
    print(json.dumps({'source': qualification['source'], 'totals': totals, 'suites': suites}, indent=2))


def pack():
    members = {f'raw/{path.relative_to(RAW)}': path.read_bytes() for path in RAW.rglob('*') if path.is_file()}
    archive = OUT / 'raw.tar.gz'
    archive.write_bytes(tar_bytes(members))
    index = {'archive': str(archive), 'sha256': sha(archive.read_bytes()), 'regularMembers': len(members), 'unexpectedRegularMembers': 0, 'members': [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(members.items())]}
    write_json(OUT / 'raw-index.json', index)
    check_archive(index)
    current = read_json('docs/evidence/local-github-ingress.json')
    current['rawLogs']['sha256'] = index['sha256']
    write_json('docs/evidence/local-github-ingress.json', current)
    tooling = {str(OUT / 'qualify.py'): sha((OUT / 'qualify.py').read_bytes())}
    write_json(OUT / 'tooling.json', {'files': tooling, 'filesHash': sha(json.dumps(tooling, separators=(',', ':')).encode()), 'interpreter': command('python3', '--version'), 'applicationTestRunner': command('bun', '--version'), 'notSourceInventoryOrSelfReferential': True})


def verify_docs():
    verify_source()
    current = read_json('docs/evidence/local-github-ingress.json')
    source = current['localQualification']['source']
    assert command('git', 'rev-parse', f"{source['commit']}^{{tree}}") == source['tree']
    historical = read_json(OUT / 'historical-b7-manifest.json')
    assert historical['localQualification']['source']['commit'].startswith('b7f5d4e')
    for index in ['accepted-tasks-1-6-index.json', 'task-7-raw-index.json', 'docs-verification-index.json', 'final-fix/raw-index.json']:
        check_archive(read_json(ROOT / index))
    raw = check_archive(read_json(OUT / 'raw-index.json'))
    for gate in current['localQualification']['gates']:
        identity = 'final-' + gate['id'].replace(':', '-')
        assert sha(raw[f'raw/{identity}.log']) == gate['logHash']
        assert int(raw[f'raw/{identity}.exit']) == gate['exit']
    for binding in current['controlBindings']:
        control = next(entry for entry in current['localQualification']['controls'] if entry['name'] == binding['name'])
        assert binding['testHash'] == files_now()[binding['test']]
        assert control['beforeHash'] == control['restoredHash'] == files_now()[binding['path']]
        for round_number, red in enumerate(control['red'], 1):
            assert sha(raw[f"raw/{binding['logPrefix']}-red-{round_number}.log"]) == red['logHash']
        assert sha(raw[f"raw/{binding['logPrefix']}-green.log"]) == control['green']['logHash']
    tooling = read_json(OUT / 'tooling.json')
    assert all(sha(Path(path).read_bytes()) == expected for path, expected in tooling['files'].items())
    script = "import { validateLocalQualification } from './apps/github-ingress/src/qualification-report.ts'; import { Result } from './apps/github-ingress/node_modules/effect/dist/index.js'; const m = await Bun.file('docs/evidence/local-github-ingress.json').json(); Result.getOrThrow(validateLocalQualification(m.localQualification)); console.log('supplied-data consistency: valid');"
    print(command('bun', '--no-env-file', '--no-install', '-e', script))
    changed = command('git', 'diff', '--name-only', source['commit']).splitlines()
    assert all(path.startswith('docs/') or path.endswith('.md') for path in changed)
    print(json.dumps({'sourceCommit': source['commit'], 'sourceTree': source['tree'], 'filesVerified': len(files_now()), 'archivesCompleteUnexpectedRegularMembers': 0, 'task7': current['review']['task7'], 'wholeBranch': current['review']['wholeBranch']}))


if __name__ == '__main__':
    modes = {'freeze': freeze, 'verify-source': verify_source, 'gates': gates, 'repackage': repackage, 'manifest': manifest, 'pack': pack, 'verify-docs': verify_docs}
    if sys.argv[1] == 'control':
        control(*sys.argv[2:])
    else:
        modes[sys.argv[1]]()
