import { describe, expect, it } from "vitest";
import { runInPty } from "gentui-testing";

const interactive = String.raw`
const restore=()=>{process.stdin.setRawMode(false);process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l')};
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.on('resize',()=>process.stdout.write(' SIZE '+process.stdout.columns+'x'+process.stdout.rows));
process.stdin.on('data',b=>{process.stdout.write(' INPUT '+JSON.stringify(b.toString()));if(b.includes(113)){restore();process.exit(0)}});
process.on('SIGINT',()=>{process.stdout.write(' SIGINT');restore();process.exit(0)});
process.on('SIGTERM',()=>{process.stdout.write(' SIGTERM');restore();process.exit(0)});
process.stdout.write('\x1b[?1049h\x1b[?25lREADY '+process.stdout.columns+'x'+process.stdout.rows);
`;

describe.runIf(process.platform !== "win32")("POSIX pseudo-terminal fixtures", () => {
  it("observes stdin, screen/cursor ANSI, resize, and exact terminal-mode restoration", async () => {
    const observed = await runInPty(process.execPath, ["--input-type=module", "-e", interactive], {
      columns: 40, rows: 10, readyText: "READY",
      actions: [
        { type: "resize", columns: 17, rows: 6, delayMs: 100 },
        { type: "input", data: "q", delayMs: 50 },
      ],
    });
    expect(observed.output).toContain("\u001b[?1049h\u001b[?25lREADY 40x10");
    expect(observed.output).toContain("SIZE 17x6");
    expect(observed.output).toContain("INPUT \"q\"");
    expect(observed.output).toContain("\u001b[0m\u001b[?25h\u001b[?1049l");
    expect(observed.finalMode).toEqual(observed.initialMode);
    expect(observed.restoredMode).toEqual(observed.initialMode);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("observes %s and restores the real tty", async (signal) => {
    const observed = await runInPty(process.execPath, ["--input-type=module", "-e", interactive], {
      readyText: "READY",
      actions: [{ type: "signal", signal }],
    });
    expect(observed.output).toContain(signal);
    expect(observed.output).toContain("\u001b[?25h\u001b[?1049l");
    expect(observed.finalMode).toEqual(observed.initialMode);
  });

  it("restores the parent PTY to its recorded safe mode after a subprocess crash", async () => {
    const crash = `process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\\x1b[?1049h\\x1b[?25lCRASH');setInterval(()=>{},1000)`;
    const observed = await runInPty(process.execPath, ["--input-type=module", "-e", crash], {
      readyText: "CRASH",
      actions: [{ type: "signal", signal: "SIGKILL" }],
    });
    expect(observed.exitCode).toBe(137);
    expect(observed.output).toContain("\u001b[?1049h\u001b[?25lCRASH");
    expect(observed.restorationRequired).toBe(true);
    expect(observed.restoredMode).toEqual(observed.initialMode);
  });
});
