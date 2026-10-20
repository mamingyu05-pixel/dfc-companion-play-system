"""One separately approved 4-group native/HTTP/PG run. Imports only the existing Job helpers."""
from pathlib import Path
import importlib.util, json, subprocess, time, sys, datetime, os, uuid, hashlib, threading, re

here = Path(__file__).resolve().parent
import argparse
parser = argparse.ArgumentParser(description='Owned local TEST API/PG validation; never an execution-permission bypass.')
parser.add_argument('--approved-test-api-pg', action='store_true', required=True)
parser.add_argument('--manifest', type=Path, required=True)
parser.add_argument('--manifest-sha256', required=True)
parser.add_argument('--window-evidence', type=Path, required=True)
parser.add_argument('--interactive-seconds', type=int, default=0, help='Explicit 15..90 second human TEST window; requires an interactive console and separate parent scope')
args = parser.parse_args()
interactive = args.interactive_seconds != 0
if interactive and (not 15 <= args.interactive_seconds <= 90 or not sys.stdin.isatty()):
    raise SystemExit('Interactive TEST needs 15..90 seconds and a real operator console; nothing launched')
manifest_path = args.manifest.resolve()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
if sha(manifest_path) != args.manifest_sha256:
    raise SystemExit('Approved manifest mismatch; nothing launched')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
if Path(manifest['root']).resolve() != here.parents[1]:
    raise SystemExit('Manifest repository does not match this installed entry')
# New preflight and its regression must be part of the same approved source seal.
validation = manifest.get('validationFiles')
if not isinstance(validation, dict):
    raise SystemExit('Missing sealed migration-contract validation files')
for relative in ('guard.py', 'runner.cjs', 'migration-contract.cjs', 'migration-contract.test.cjs'):
    expected = validation.get(relative)
    if (not isinstance(expected, str) or re.fullmatch(r'[a-f0-9]{64}', expected) is None
            or not (here / relative).is_file() or sha(here / relative) != expected):
        raise SystemExit('Migration-contract validation file is absent or unsealed')
window = json.loads(args.window_evidence.read_text(encoding='utf-8'))
now = datetime.datetime.now(datetime.timezone.utc)
if (window.get('parentThread') != manifest['parentThread'] or
    window.get('scope') != ('DFC_LOCAL_TEST_API_PG_INTERACTIVE' if interactive else 'DFC_LOCAL_TEST_API_PG') or window.get('manifestSha256') != args.manifest_sha256 or
    window.get('backpackOwnerReleased') is not True or window.get('serialWindowGranted') is not True):
    raise SystemExit('Need explicit current owner release and parent serial-window evidence')
if interactive and window.get('interactiveSeconds') != args.interactive_seconds:
    raise SystemExit('Interactive duration differs from the parent scope; nothing launched')
start = datetime.datetime.fromisoformat(window['notBeforeUtc'].replace('Z','+00:00'))
until = datetime.datetime.fromisoformat(window['notAfterUtc'].replace('Z','+00:00'))
if not start <= now < until or (until-start).total_seconds() > 150:
    raise SystemExit('Outside the granted <=150 second window; nothing launched')
work_seconds = min(120, (until-now).total_seconds()-30)
if work_seconds < 15: raise SystemExit('Insufficient granted work/cleanup time; nothing launched')
for helper in manifest['helpers']:
    if sha(Path(helper['path'])) != helper['sha256']: raise SystemExit('Existing Job helper drift')
helper_path = next(Path(x['path']) for x in manifest['helpers'] if Path(x['path']).name == 'isolated-pg-guard.py')
sys.path.insert(0, str(helper_path.parent))
spec = importlib.util.spec_from_file_location('existing_pg_guard', helper_path)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)  # Imports Job helpers only; does not invoke any historical launch mode.

def sources():
    checks = [(Path(x['source']), x['candidate']) for x in manifest['candidateFiles']]
    checks += [(Path(manifest['root']) / rel, expected) for rel, expected in manifest['protectedOriginal'].items()]
    checks += [(here / rel, expected) for rel, expected in manifest['validationFiles'].items()]
    checks += [(Path(x['path']), x['sha256']) for x in manifest['migrations']]
    checks += [(Path(x['path']), x['sha256']) for x in manifest['tools'].values()]
    checks += [(Path(x['path']), x['sha256']) for x in manifest['helpers']]
    values = [{'path': str(p), 'expected': expected, 'actual': sha(p) if p.is_file() else None} for p, expected in checks]
    unexpected = []  # Eight current applied files are expected to exist; hash all actual sources.
    return {'matches': not unexpected and all(x['expected'] == x['actual'] for x in values), 'unexpectedTargets': unexpected, 'files': values}

def job(memory, kill=False, cpu=False):
    return g.make_job(memory * 2**20, kill=kill, cpu=cpu, process_memory=640 * 2**20)

def save(report, run):
    (run / 'resource.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

initial_free = g.free()
if initial_free < 7.5:
    (manifest_path.parent / 'dfc-test-api-rejected-latest.json').write_text(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'freeGiB': initial_free, 'reason': 'startup free below 7.5GiB', 'pgStarted': False}), encoding='utf-8')
    raise SystemExit('Need >=7.5GiB free; no PG started')
before = sources()
if not before['matches']:
    raise SystemExit('Source/validation/tool hash mismatch; no PG started')
if g.shutil.disk_usage(here).free < 2**30:
    raise SystemExit('Need 1GiB free disk for retained isolated evidence; no PG started')
claim_path = args.window_evidence.with_suffix(args.window_evidence.suffix + '.claimed')
with claim_path.open('x', encoding='utf-8') as claim:
    json.dump({'claimedAtUtc':now.isoformat(),'manifestSha256':args.manifest_sha256},claim)
run = manifest_path.parent / 'dfc-test-api-runs' / str(uuid.uuid4())
run.mkdir(parents=True)
outer = job(768, cpu=True)
g.k.GetCurrentProcess.restype = g.w.HANDLE
g.checked(g.k.AssignProcessToJobObject(outer, g.k.GetCurrentProcess()))
g.verify_member(outer, g.k.GetCurrentProcess())
inner = job(704, kill=True)
g.k.TerminateJobObject.argtypes = [g.w.HANDLE, g.w.UINT]
safe = {key: os.environ[key] for key in ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC'] if key in os.environ}
report = {'started': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'runDir': str(run), 'candidateSetSha256': manifest['candidateSetSha256'], 'pgManifestSha256': args.manifest_sha256, 'supervisorPid': os.getpid(), 'ownedPids': [os.getpid()], 'minFreeGiB': initial_free, 'maxSampledProcesses': 1, 'outerJobMiB': 768, 'innerJobMiB': 704, 'processMiB': 640, 'cpuHardCapPercent': 5, 'priority': 'IDLE', 'maxProcesses': 12, 'limitsQueriedAndVerified': True, 'startFreeGiB': 7.5, 'stopFreeGiB': 6.5, 'maxSeconds': work_seconds, 'ownedCleanupBudgetSeconds': 30, 'sourceBefore': before, 'groupsExpected': 0 if interactive else 4, 'interactiveMode': interactive, 'httpStarted': False, 'browserStarted': False}
work_seconds = min(work_seconds, (until - datetime.datetime.now(datetime.timezone.utc)).total_seconds() - 30)
if work_seconds < 15: raise SystemExit('Insufficient remaining parent window')
report['maxSeconds'] = work_seconds
started = time.monotonic()
child = None
stop_at = None
try:
    if g.free() < 7.5:
        raise RuntimeError('Startup free changed below 7.5GiB before runner; no PG launched')
    with (run / 'runner.log').open('wb') as log:
        runner_args = ['node', '--max-old-space-size=384', str(here / 'runner.cjs'), str(run), str(manifest_path)]
        if interactive:
            runner_args += ['--interactive', str(args.interactive_seconds), str(int((until.timestamp() - 30) * 1000))]
        child = subprocess.Popen(runner_args, cwd=here, env=safe, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.IDLE_PRIORITY_CLASS)
        report['runnerPid'] = child.pid
        g.checked(g.k.AssignProcessToJobObject(inner, g.w.HANDLE(child._handle)))
        g.verify_member(inner, g.w.HANDLE(child._handle))
        g.verify_member(outer, g.w.HANDLE(child._handle))
        report['memberVerifiedBeforePermit'] = True
        child.stdin.write(b'APPROVED_TEST_API_PG_INTERACTIVE\n' if interactive else b'APPROVED_TEST_API_PG\n')
        child.stdin.flush()
        if interactive:
            def relay_operator():
                try:
                    for line in sys.stdin:
                        value = line.strip()
                        if value == 'STOP' or re.fullmatch(r'APPROVE [0-9]{6}', value):
                            child.stdin.write((value + '\n').encode('ascii')); child.stdin.flush()
                            if value == 'STOP': return
                    child.stdin.write(b'STOP\n'); child.stdin.flush()
                except (OSError, ValueError):
                    pass
            threading.Thread(target=relay_operator, daemon=True).start()
            print('TEST only, no WeChat login/payment. After READY, enter APPROVE <six digits shown in the native page>, or STOP. No token is printed.', flush=True)
        else:
            child.stdin.close()
        last_state = None
        while child.poll() is None:
            current = g.job_pids(outer)
            report['ownedPids'] = sorted(set(report['ownedPids']) | set(current))
            report['maxSampledProcesses'] = max(report['maxSampledProcesses'], len(current))
            report['minFreeGiB'] = min(report['minFreeGiB'], g.free())
            report.update(g.snapshot(outer))
            elapsed = time.monotonic() - started
            if interactive:
                state_path = run / 'interactive-state.json'
                try:
                    state = json.loads(state_path.read_text(encoding='utf-8'))
                    if state != last_state:
                        print(json.dumps({'interactive': state}), flush=True); last_state = state
                except (OSError, ValueError):
                    pass
            if report['minFreeGiB'] < 6.5:
                report['stopReason'] = 'minimum-free-immediate-owned-stop'
                g.checked(g.k.TerminateJobObject(inner, 124))
                report['forcedOwnedJobStop'] = True
                stop_at = time.monotonic()
                break
            if stop_at is None and (report['minFreeGiB'] < 6.5 or elapsed >= work_seconds):
                stop_at = time.monotonic()
                report['stopReason'] = 'minimum-free' if report['minFreeGiB'] < 6.5 else 'deadline'
                (run / 'stop-request.json').write_text(json.dumps({'reason': report['stopReason']}), encoding='utf-8')
            if stop_at is not None and time.monotonic() - stop_at >= 25:
                g.checked(g.k.TerminateJobObject(inner, 124))
                report['forcedOwnedJobStop'] = True
                break
            save(report, run)
            time.sleep(.25)
        wait_budget = min(5, max(.1, stop_at + 30 - time.monotonic())) if stop_at is not None else 5
        report['exitCode'] = child.wait(timeout=wait_budget)
except BaseException as error:
    report['failure'] = str(error)
finally:
    if child is not None and child.stdin is not None and not child.stdin.closed:
        try: child.stdin.close()
        except OSError: pass
    remaining = g.job_pids(inner)
    if remaining:
        report['remainingAtRunnerExit'] = remaining
        g.checked(g.k.TerminateJobObject(inner, 124))
        report['forcedOwnedJobStop'] = True
        until = min(time.monotonic() + 5, stop_at + 30) if stop_at is not None else time.monotonic() + 5
        while g.job_pids(inner) and time.monotonic() < until:
            time.sleep(.05)
    report['remainingInnerPids'] = g.job_pids(inner)
    report.update(g.snapshot(outer))
    report['remainingOuterPidsBeforeSupervisorExit'] = g.job_pids(outer)
    g.k.CloseHandle(inner)
    report['sourceAfter'] = sources()
    execution_path = run / 'execution.json'
    execution = json.loads(execution_path.read_text(encoding='utf-8')) if execution_path.is_file() else {}
    report['httpStarted'] = bool(execution.get('httpStarted'))
    report['success'] = bool(execution.get('success')) and execution.get('stopExit') == 0 and ((execution.get('interactive', {}).get('stage') == 'stopped') if interactive else len(execution.get('tests', [])) == 4) and report.get('exitCode') == 0 and not report.get('stopReason') and not report.get('failure') and not report.get('forcedOwnedJobStop') and not report['remainingInnerPids'] and report['sourceAfter']['matches']
    report['finished'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report['seconds'] = round(time.monotonic() - started, 2)
    save(report, run)
    (manifest_path.parent / 'dfc-test-api-pg-latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    g.k.CloseHandle(outer)
    print(json.dumps({k: v for k, v in report.items() if k not in ['sourceBefore', 'sourceAfter']}))
sys.exit(0 if report.get('success') else 1)
