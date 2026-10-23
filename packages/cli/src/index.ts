import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createActivationKey,
  generateKeyPair,
  getFingerprint,
  parseSignedLicense,
  signLicense,
  verifyActivationKey,
  verifyLicenseSignature,
  type LicensePayload,
} from "@licensify/core";

const HELP = `Licensify — offline, anti-reverse-engineering software licensing CLI

Usage:
  licensify <command> [options]

Commands:
  keygen        Generate an Ed25519 key pair (vendor signing keys)
  sign          Sign a license payload, producing a signed license
  verify        Verify a signed license signature
  fingerprint   Print this machine's node-locking fingerprint
  issue         Issue a node-locked activation key for a target fingerprint
  activate      Activate an activation key on this machine (offline)

Options (per command):
  keygen        [--out <dir>] [--json]
  sign          --private-key <pem|path|env:NAME> --payload <json> [--payload-file <path>]
  verify        --public-key <pem|path|env:NAME> --license <json> [--license-file <path>]
  fingerprint   [--salt <string>] [--extra <string>]
  issue         --private-key <pem|path|env:NAME> --payload <json> --fingerprint <hex> [--salt <16-byte-hex>]
  activate      --public-key <pem|path|env:NAME> --activation-key <key> [--fingerprint <hex>]

Key values may be an inline PEM, a file path, or an environment variable via
env:NAME. The private key never needs to be written to disk: use env:NAME.

Examples:
  licensify keygen --out ./keys
  licensify fingerprint
  licensify sign --private-key env:LICENSIFY_PRIVATE --payload '{"id":"l1","productId":"p","licensee":"ACME","issuedAt":"2026-01-01T00:00:00Z"}'
  licensify issue --private-key env:LICENSIFY_PRIVATE --payload '{"id":"l1","productId":"p","licensee":"ACME","issuedAt":"2026-01-01T00:00:00Z"}' --fingerprint <hex>
  licensify activate --public-key ./keys/licensify.public.pem --activation-key <key>
`;

interface ParsedArgs {
  command?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      flags["help"] = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (command === undefined) {
      command = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return { command, flags };
}

function flagValue(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function requireFlag(flags: Record<string, string | boolean>, name: string): string {
  const v = flagValue(flags, name);
  if (v === undefined || v === "") {
    throw new Error(`Missing required option --${name}`);
  }
  return v;
}

/** Resolve a key value: inline PEM, file path, or env:NAME. */
function loadKey(raw: string, label: string): string {
  if (raw.startsWith("env:")) {
    const name = raw.slice(4);
    const value = process.env[name];
    if (!value) {
      throw new Error(`${label}: environment variable ${name} is not set`);
    }
    return value;
  }
  if (raw.includes("-----BEGIN")) {
    return raw.replace(/\\n/g, "\n");
  }
  const path = resolve(raw);
  if (existsSync(path)) {
    return readFileSync(path, "utf8").trim();
  }
  throw new Error(`${label}: not an inline PEM, a file (${path}), or env:NAME`);
}

function readJsonInput(flags: Record<string, string | boolean>): string {
  const inline = flagValue(flags, "payload") ?? flagValue(flags, "license");
  const file = flagValue(flags, "payload-file") ?? flagValue(flags, "license-file");
  if (inline !== undefined) {
    return inline;
  }
  if (file !== undefined) {
    return readFileSync(resolve(file), "utf8");
  }
  // Read from stdin as a fallback.
  return readFileSync(0, "utf8");
}

function parsePayload(json: string): LicensePayload {
  const parsed = JSON.parse(json) as LicensePayload;
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.productId !== "string") {
    throw new Error("License payload must include at least { id, productId, licensee, issuedAt }");
  }
  return parsed;
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || flags["help"]) {
    process.stdout.write(HELP);
    return;
  }

  try {
    switch (command) {
      case "keygen": {
        const kp = generateKeyPair();
        if (flags["json"]) {
          printJson(kp);
          return;
        }
        const dir = resolve(flagValue(flags, "out") ?? ".");
        const pubPath = `${dir}/licensify.public.pem`;
        const privPath = `${dir}/licensify.private.pem`;
        writeFileSync(pubPath, kp.publicKeyPem);
        writeFileSync(privPath, kp.privateKeyPem);
        process.stdout.write(
          `Public key  -> ${pubPath}\nPrivate key -> ${privPath}\n\nKeep the private key secret — it signs licenses. Never commit it.\n`,
        );
        return;
      }

      case "sign": {
        const privateKey = loadKey(requireFlag(flags, "private-key"), "private-key");
        const payload = parsePayload(readJsonInput(flags));
        const signed = signLicense(payload, privateKey);
        printJson(signed);
        return;
      }

      case "verify": {
        const publicKey = loadKey(requireFlag(flags, "public-key"), "public-key");
        const signed = parseSignedLicense(readJsonInput(flags));
        try {
          verifyLicenseSignature(signed, publicKey);
        } catch {
          fail("Signature verification failed");
        }
        process.stdout.write("Signature VALID\n");
        printJson(signed.payload);
        return;
      }

      case "fingerprint": {
        const fp = getFingerprint({
          salt: flagValue(flags, "salt"),
          extraSignals: flagValue(flags, "extra") ? [flagValue(flags, "extra")!] : undefined,
        });
        process.stdout.write(`${fp}\n`);
        return;
      }

      case "issue": {
        const privateKey = loadKey(requireFlag(flags, "private-key"), "private-key");
        const payload = parsePayload(readJsonInput(flags));
        const fingerprint = requireFlag(flags, "fingerprint");
        const saltHex = flagValue(flags, "salt");
        const salt = saltHex ? Buffer.from(saltHex, "hex") : undefined;
        const key = createActivationKey(payload, { privateKeyPem: privateKey, fingerprint, salt });
        process.stdout.write(`${key}\n`);
        return;
      }

      case "activate": {
        const publicKey = loadKey(requireFlag(flags, "public-key"), "public-key");
        const activationKey = requireFlag(flags, "activation-key");
        const fingerprint = flagValue(flags, "fingerprint") ?? getFingerprint();
        const result = verifyActivationKey(activationKey, {
          publicKeyPem: publicKey,
          fingerprint,
        });
        process.stdout.write("Activation VALID\n");
        printJson(result.payload);
        return;
      }

      default:
        fail(`Unknown command: ${command}\n\n${HELP}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
