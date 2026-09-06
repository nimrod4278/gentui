import { spawn } from "node:child_process";

export type PtyAction =
  | { type: "input"; data: string; delayMs?: number }
  | { type: "resize"; columns: number; rows: number; delayMs?: number }
  | { type: "signal"; signal: "SIGINT" | "SIGTERM" | "SIGKILL"; delayMs?: number };

export interface PtyRunOptions {
  actions?: readonly PtyAction[];
  columns?: number;
  rows?: number;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Do not begin actions until this output marker is observed. */
  readyText?: string;
}

export interface PtyObservation {
  output: string;
  exitCode: number;
  signal: number | null;
  initialMode: readonly number[];
  finalMode: readonly number[];
  restoredMode: readonly number[];
  restorationRequired: boolean;
}

const PYTHON_FIXTURE = String.raw`
import base64, copy, fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time
cfg=json.loads(sys.argv[1]); master, slave=pty.openpty()
def attrs():
  a=termios.tcgetattr(slave)
  # Exclude transient kernel status bits (for example macOS PENDIN) while
  # retaining every mode gentui can alter: canonical input, echo, signals,
  # extensions, input/output processing, character size, and speeds.
  lmask=0
  for name in ('ECHO','ECHOE','ECHOK','ECHONL','ICANON','ISIG','IEXTEN','NOFLSH','TOSTOP'):
    lmask |= getattr(termios,name,0)
  return [a[0],a[1],a[2],a[3]&lmask,a[4],a[5]]
def size(c,r): fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',r,c,0,0))
size(cfg['columns'],cfg['rows']); initial=copy.deepcopy(termios.tcgetattr(slave)); initial_flat=attrs()
env=os.environ.copy(); env.update(cfg.get('env',{}))
p=subprocess.Popen(cfg['argv'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True,close_fds=True)
out=bytearray(); deadline=time.time()+cfg['timeoutMs']/1000
ready=cfg.get('readyText','').encode()
while ready and ready not in out and time.time()<deadline and p.poll() is None:
  available,_,_=select.select([master],[],[],0.02)
  if available:
    try: out.extend(os.read(master,65536))
    except OSError: pass
for action in cfg.get('actions',[]):
  time.sleep(action.get('delayMs',0)/1000)
  if action['type']=='input': os.write(master,action['data'].encode())
  elif action['type']=='resize':
    size(action['columns'],action['rows']); os.killpg(p.pid,signal.SIGWINCH)
  elif action['type']=='signal': os.killpg(p.pid,getattr(signal,action['signal']))
while time.time()<deadline:
  ready,_,_=select.select([master],[],[],0.02)
  if ready:
    try: out.extend(os.read(master,65536))
    except OSError: pass
  if p.poll() is not None:
    while True:
      ready,_,_=select.select([master],[],[],0)
      if not ready: break
      try: out.extend(os.read(master,65536))
      except OSError: break
    break
if p.poll() is None:
  os.killpg(p.pid,signal.SIGKILL); p.wait()
final_flat=attrs(); required=final_flat!=initial_flat
termios.tcsetattr(slave,termios.TCSANOW,initial); restored=attrs()
print(json.dumps({'output':base64.b64encode(out).decode(),'exitCode':p.returncode if p.returncode>=0 else 128-p.returncode,'signal':-p.returncode if p.returncode<0 else None,'initialMode':initial_flat,'finalMode':final_flat,'restoredMode':restored,'restorationRequired':required}))
os.close(master); os.close(slave)
`;

/**
 * Runs a process on an actual POSIX pseudo-terminal and observes bytes, window
 * changes, signals, and termios restoration. No fixture files are created.
 */
export function runInPty(command: string, args: readonly string[] = [], options: PtyRunOptions = {}): Promise<PtyObservation> {
  if (process.platform === "win32") return Promise.reject(new Error("POSIX pseudo-terminals are unsupported on win32"));
  const config = {
    argv: [command, ...args],
    actions: options.actions ?? [],
    columns: options.columns ?? 80,
    rows: options.rows ?? 24,
    timeoutMs: options.timeoutMs ?? 5_000,
    env: options.env ?? {},
    readyText: options.readyText ?? "",
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? "python3", ["-c", PYTHON_FIXTURE, JSON.stringify(config)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`PTY fixture failed (${code}): ${stderr || stdout}`));
      try {
        const parsed = JSON.parse(stdout.trim()) as Omit<PtyObservation, "output"> & { output: string };
        resolve({ ...parsed, output: Buffer.from(parsed.output, "base64").toString("utf8") });
      } catch (error) { reject(new Error(`invalid PTY fixture output: ${stdout}\n${stderr}`, { cause: error })); }
    });
  });
}
