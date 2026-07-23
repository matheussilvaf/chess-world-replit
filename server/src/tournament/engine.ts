import { execFile, spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat, access, constants, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PairingDiagnostics } from './types.js';
import { parsePairingOutput, type ParsedPairingResult } from './trf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPECTED_VERSION = 'v6.0.0';
const TIMEOUT_MS = 10_000;

function getBinaryPath(): string {
  return join(__dirname, '..', '..', 'bin', 'bbpPairings');
}

export interface EngineStatus {
  available: boolean;
  path: string;
  version: string | null;
  dutchSupported: boolean;
  checkerAvailable: boolean;
  error: string | null;
  platform: string;
  arch: string;
}

export interface EngineDiagnosticsDetail {
  platform: string;
  arch: string;
  binaryPath: string;
  fileExists: boolean;
  fileSize: number | null;
  filePermissions: string | null;
  executableBit: boolean;
  spawnError: string | null;
  spawnErrorCode: string | null;
  spawnErrorErrno: number | null;
  spawnErrorSyscall: string | null;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  diagnosis: string;
}

let cachedStatus: EngineStatus | null = null;

const FIXTURE_TRF = `XXR 2
001    1      Player A                          2000                             1.0    1     2 w 1
001    2      Player B                          1900                             0.0    2     1 b 0
001    3      Player C                          1800                             0.5    3     4 w =
001    4      Player D                          1700                             0.5    4     3 b =
`;

async function probeBinary(): Promise<EngineDiagnosticsDetail> {
  const binaryPath = getBinaryPath();
  const detail: EngineDiagnosticsDetail = {
    platform: process.platform,
    arch: process.arch,
    binaryPath,
    fileExists: false,
    fileSize: null,
    filePermissions: null,
    executableBit: false,
    spawnError: null,
    spawnErrorCode: null,
    spawnErrorErrno: null,
    spawnErrorSyscall: null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 0,
    diagnosis: '',
  };

  // Check file existence and stats
  if (!existsSync(binaryPath)) {
    detail.diagnosis = 'ENOENT: binary file does not exist at configured path';
    return detail;
  }
  detail.fileExists = true;

  try {
    const stats = await stat(binaryPath);
    detail.fileSize = stats.size;
    detail.filePermissions = (stats.mode & 0o7777).toString(8).padStart(4, '0');
  } catch (e: any) {
    detail.diagnosis = `Cannot stat file: ${e.message}`;
    return detail;
  }

  // Check executable permission
  try {
    await access(binaryPath, constants.X_OK);
    detail.executableBit = true;
  } catch {
    detail.executableBit = false;
  }

  // Try to fix permission if missing
  if (!detail.executableBit) {
    try {
      await chmod(binaryPath, 0o755);
      detail.executableBit = true;
      detail.filePermissions = '0755';
    } catch (e: any) {
      detail.diagnosis = `EACCES: file exists but lacks execute permission and chmod failed: ${e.message}`;
      return detail;
    }
  }

  // Attempt execution
  const startTime = Date.now();

  try {
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null }>((resolve, reject) => {
      const proc = spawn(binaryPath, [], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('error', (err: any) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      proc.on('close', (code, signal) => {
        if (!settled) {
          settled = true;
          resolve({ stdout, stderr, exitCode: code, signal: signal || null });
        }
      });
    });

    detail.durationMs = Date.now() - startTime;
    detail.stdout = result.stdout.slice(0, 2000);
    detail.stderr = result.stderr.slice(0, 2000);
    detail.exitCode = result.exitCode;
    detail.signal = result.signal;

    if (result.exitCode === null && result.signal === 'SIGTERM') {
      detail.timedOut = true;
      detail.diagnosis = 'TIMEOUT: process was killed after 5s without producing output';
    } else if (result.stdout.length === 0 && result.stderr.length === 0) {
      detail.diagnosis = `EMPTY_OUTPUT: process exited (code=${result.exitCode}, signal=${result.signal}) but produced no output`;
    } else {
      detail.diagnosis = 'OK';
    }
  } catch (e: any) {
    detail.durationMs = Date.now() - startTime;
    detail.spawnError = e.message || String(e);
    detail.spawnErrorCode = e.code || null;
    detail.spawnErrorErrno = e.errno ?? null;
    detail.spawnErrorSyscall = e.syscall || null;

    if (e.code === 'ENOENT') {
      detail.diagnosis = 'ENOENT: file exists but the system cannot find the executable or its interpreter (wrong ELF architecture or missing dynamic linker)';
    } else if (e.code === 'EACCES') {
      detail.diagnosis = 'EACCES: permission denied when attempting to execute';
    } else if (e.code === 'ENOEXEC') {
      detail.diagnosis = 'ENOEXEC: executable format error - binary is incompatible with this platform';
    } else {
      detail.diagnosis = `SPAWN_ERROR: ${e.code || 'unknown'} - ${e.message}`;
    }
  }

  return detail;
}

export async function getEngineDiagnostics(): Promise<EngineDiagnosticsDetail> {
  return probeBinary();
}

export async function getEngineStatus(): Promise<EngineStatus> {
  if (cachedStatus) return cachedStatus;

  const binaryPath = getBinaryPath();
  const baseStatus: EngineStatus = {
    available: false,
    path: binaryPath,
    version: null,
    dutchSupported: false,
    checkerAvailable: false,
    error: null,
    platform: process.platform,
    arch: process.arch,
  };

  const diag = await probeBinary();

  if (diag.diagnosis !== 'OK') {
    baseStatus.error = diag.diagnosis;
    cachedStatus = baseStatus;
    return cachedStatus;
  }

  // Parse version from output
  const combined = diag.stdout + diag.stderr;
  const versionMatch = combined.match(/v\d+\.\d+\.\d+/);
  const version = versionMatch ? versionMatch[0] : null;

  if (!version) {
    baseStatus.error = `Could not parse version from output. stdout=${diag.stdout.slice(0, 200)}, stderr=${diag.stderr.slice(0, 200)}`;
    cachedStatus = baseStatus;
    return cachedStatus;
  }

  if (version !== EXPECTED_VERSION) {
    baseStatus.version = version;
    baseStatus.error = `Expected version ${EXPECTED_VERSION}, found ${version}`;
    cachedStatus = baseStatus;
    return cachedStatus;
  }

  baseStatus.available = true;
  baseStatus.version = version;
  baseStatus.dutchSupported = true;
  baseStatus.checkerAvailable = true;

  cachedStatus = baseStatus;
  return cachedStatus;
}

export interface FixtureTestResult {
  dutchOk: boolean;
  checkerOk: boolean;
  dutchOutput: string;
  checkerOutput: string;
  dutchError: string | null;
  checkerError: string | null;
  durationMs: number;
}

export async function runFixtureTest(): Promise<FixtureTestResult> {
  const result: FixtureTestResult = {
    dutchOk: false,
    checkerOk: false,
    dutchOutput: '',
    checkerOutput: '',
    dutchError: null,
    checkerError: null,
    durationMs: 0,
  };

  const binaryPath = getBinaryPath();
  const startTime = Date.now();

  let tmpDir: string;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'bbp-fixture-'));
  } catch (e: any) {
    result.dutchError = `Cannot create temp dir: ${e.message}`;
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const inputPath = join(tmpDir, 'fixture.trf');
  const outputPath = join(tmpDir, 'output.txt');

  try {
    await writeFile(inputPath, FIXTURE_TRF, 'utf-8');

    // Test Dutch pairing generation
    const dutchResult = await execBinaryRaw(binaryPath, ['--dutch', inputPath, '-p', outputPath]);
    if (dutchResult.error) {
      result.dutchError = dutchResult.error;
    } else {
      try {
        const output = await readFile(outputPath, 'utf-8');
        result.dutchOutput = output.slice(0, 1000);
        result.dutchOk = output.trim().length > 0;
      } catch {
        result.dutchError = 'No output file produced';
      }
    }

    // Test checker
    const checkerResult = await execBinaryRaw(binaryPath, ['--dutch', inputPath, '-c']);
    if (checkerResult.error) {
      result.checkerError = checkerResult.error;
    } else {
      result.checkerOutput = (checkerResult.stdout + checkerResult.stderr).slice(0, 1000);
      result.checkerOk = true;
    }
  } finally {
    result.durationMs = Date.now() - startTime;
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }

  return result;
}

interface RawExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
}

function execBinaryRaw(binaryPath: string, args: string[]): Promise<RawExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(binaryPath, args, {
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err: any) => {
      resolve({ stdout, stderr, exitCode: null, signal: null, error: `${err.code || 'ERROR'}: ${err.message}` });
    });

    proc.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        resolve({ stdout, stderr, exitCode: code, signal: signal || null, error: `Exit code ${code}: ${stderr || stdout}` });
      } else {
        resolve({ stdout, stderr, exitCode: code, signal: signal || null, error: null });
      }
    });
  });
}

export interface PairingRequest {
  trfContent: string;
  roundNumber: number;
}

export interface PairingResponse {
  success: boolean;
  result: ParsedPairingResult | null;
  diagnostics: PairingDiagnostics;
}

export async function generatePairing(request: PairingRequest): Promise<PairingResponse> {
  const status = await getEngineStatus();
  const diagnostics: PairingDiagnostics = {
    engineVersion: status.version || 'unknown',
    roundRequested: request.roundNumber,
    activePlayers: 0,
    expectedPairings: 0,
    expectedByes: 0,
    validationsRun: [],
    violations: [],
    colorWarnings: [],
    floaters: [],
    trfInput: request.trfContent,
    engineOutput: '',
    checkerOutput: '',
    errors: [],
    success: false,
  };

  if (!status.available) {
    diagnostics.errors.push(`Engine unavailable: ${status.error}`);
    return { success: false, result: null, diagnostics };
  }

  let tmpDir: string;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'bbp-'));
  } catch (e: any) {
    diagnostics.errors.push(`Failed to create temp directory: ${e.message}`);
    return { success: false, result: null, diagnostics };
  }

  const inputPath = join(tmpDir, 'input.trf');
  const outputPath = join(tmpDir, 'output.txt');
  const binaryPath = getBinaryPath();

  try {
    await writeFile(inputPath, request.trfContent, 'utf-8');

    const pairResult = await execBinaryRaw(binaryPath, ['--dutch', inputPath, '-p', outputPath]);
    if (pairResult.error) {
      diagnostics.errors.push(`Engine pairing error: ${pairResult.error}`);
      diagnostics.engineOutput = pairResult.stdout + pairResult.stderr;
      return { success: false, result: null, diagnostics };
    }

    let outputContent: string;
    try {
      outputContent = await readFile(outputPath, 'utf-8');
    } catch {
      diagnostics.errors.push('Engine did not produce output file');
      diagnostics.engineOutput = pairResult.stdout + pairResult.stderr;
      return { success: false, result: null, diagnostics };
    }

    diagnostics.engineOutput = outputContent;

    let result: ParsedPairingResult;
    try {
      result = parsePairingOutput(outputContent);
    } catch (e: any) {
      diagnostics.errors.push(`Failed to parse engine output: ${e.message}`);
      return { success: false, result: null, diagnostics };
    }

    // Run checker
    try {
      const checkResult = await execBinaryRaw(binaryPath, ['--dutch', inputPath, '-c']);
      diagnostics.checkerOutput = checkResult.stdout + checkResult.stderr;
    } catch (e: any) {
      diagnostics.colorWarnings.push(`Checker: ${e.message}`);
    }

    diagnostics.success = true;
    return { success: true, result, diagnostics };
  } catch (e: any) {
    diagnostics.errors.push(e.message);
    return { success: false, result: null, diagnostics };
  } finally {
    try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export function resetEngineCache(): void {
  cachedStatus = null;
}
