/**
 * keychain.js — macOS Keychain storage for provider keys.
 *
 * models.json holds only a `!security find-generic-password …` command, so
 * rotating a key never touches models.json. Mirrors the convention already in
 * use: account = $USER, service = <name>.
 */

import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

const SECURITY = "/usr/bin/security";

export const account = process.env.USER || userInfo().username;

/** The models.json apiKey value that reads `service` back out of the keychain. */
export function keychainSpec(service, acct = account) {
  return `!${SECURITY} find-generic-password -a ${acct} -s ${service} -w`;
}

/** Parse a `!security …` apiKey spec back into { account, service }, or null. */
export function parseKeychainSpec(spec) {
  if (typeof spec !== "string" || !spec.startsWith("!") || !spec.includes("find-generic-password")) return null;
  const argv = spec.slice(1).trim().split(/\s+/);
  const at = argv.indexOf("-a");
  const st = argv.indexOf("-s");
  if (st < 0) return null;
  return { account: at >= 0 ? argv[at + 1] : account, service: argv[st + 1] };
}

/** Write (or overwrite, via -U) a key into the login keychain. */
export function setKey(service, secret, acct = account) {
  if (process.platform !== "darwin") throw new Error("keychain storage is macOS-only");
  execFileSync(SECURITY, ["add-generic-password", "-a", acct, "-s", service, "-w", secret, "-U"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  return keychainSpec(service, acct);
}

/** Read a key back. Returns null when the entry does not exist. */
export function getKey(service, acct = account) {
  try {
    return execFileSync(SECURITY, ["find-generic-password", "-a", acct, "-s", service, "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Suggested keychain service name for a provider. */
export function serviceNameFor(providerName) {
  return `pi-${providerName}`;
}
