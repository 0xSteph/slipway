/** Entitlements Apple won't put in a free team's profile; xtool drops them (DeveloperServicesCapability.swift). */
export const PAID_ENTITLEMENTS: Record<string, string> = {
  "aps-environment": "Push Notifications",
  "com.apple.security.application-groups": "App Groups",
  "com.apple.developer.associated-domains": "Associated Domains",
  "com.apple.developer.applesignin": "Sign in with Apple",
  "com.apple.developer.networking.networkextension": "Network Extensions",
  "com.apple.developer.networking.multipath": "Multipath",
  "com.apple.networking.vpn.configuration": "Personal VPN",
  "com.apple.developer.siri": "SiriKit",
  "com.apple.developer.wifi-aware": "Wi-Fi Aware",
};

/** Keys xtool doesn't know, so it keeps them and the install fails later on a free team (xtool #352). */
const UNKNOWN_PAID_PREFIXES = [
  "com.apple.developer.icloud",
  "com.apple.developer.ubiquity",
  "com.apple.developer.in-app-payments",
];

export interface EntitlementReport {
  dropped: string[];
  willFail: string[];
}

export function checkFreeTeamEntitlements(keys: string[]): EntitlementReport {
  const dropped: string[] = [];
  const willFail: string[] = [];
  for (const key of keys) {
    if (key in PAID_ENTITLEMENTS) dropped.push(PAID_ENTITLEMENTS[key]);
    else if (UNKNOWN_PAID_PREFIXES.some((prefix) => key.startsWith(prefix))) willFail.push(key);
  }
  return { dropped, willFail };
}

/** Top-level `<key>` names of an XML plist dict. Good enough for entitlements files. */
export function plistTopLevelKeys(xml: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  const token = /<(\/?)(dict|array)\b[^>]*?(\/?)>|<key>([^<]*)<\/key>/g;
  for (const m of xml.matchAll(token)) {
    if (m[4] !== undefined) {
      if (depth === 1) keys.push(m[4]);
    } else if (m[3] === "/") {
      continue;
    } else if (m[1] === "/") {
      depth--;
    } else {
      depth++;
    }
  }
  return keys;
}
